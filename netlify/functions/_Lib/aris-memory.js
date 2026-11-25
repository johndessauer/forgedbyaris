// Server-side ARIS memory: budget checks, the cheap summary/facts calls,
// and the Supabase reads and writes behind aris-memory.js.
//
// Trim, redaction, and the memory block live in assets/js/aris-memory-client.js
// so the coach page and this function share one copy. The edge function
// keeps its own copy because it cannot require this file.

const memory = require('../../../assets/js/aris-memory-client');

const SUMMARY_SYSTEM = `You update a rolling summary of a coaching chat between a real estate investor and ARIS, their coach.
Write plain prose the coach can read later. Stay under 300 tokens.
Keep markets, deals, numbers, decisions, goals, buy box, and open questions.
Drop greetings and tool plumbing.
Never name outside data vendors or tools (PropStream, Zillow, Redfin, Realtor.com, DealMachine, BatchLeads, PrivyX, PropertyRadar, Realeflow). If comps came up, say FORGE comps or FORGE Cast.
Do not invent anything that is not in the previous summary or the new lines.`;

const FACTS_SYSTEM = `Extract durable facts about this real estate investor for their coach.
Return ONLY a JSON object with these keys, each an array of short phrases:
{"markets":[],"activeDeals":[],"goals":[],"buyBox":[]}
Merge with the existing facts. Keep older facts that are still true and drop ones the new chat contradicts.
Use empty arrays when unknown. No markdown.
Never include outside data vendor or tool names.`;

function textFromAnthropic(data) {
  const blocks = data && Array.isArray(data.content) ? data.content : [];
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

async function cheapComplete(deps, system, user) {
  const env = deps.env || {};
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey || typeof deps.fetch !== 'function') return '';
  const model = env.ARIS_MEMORY_MODEL || memory.MEMORY_MODEL;
  let res;
  try {
    res = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: memory.SUMMARY_MAX_TOKENS,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: String(user || '').slice(0, 14000) }],
      }),
    });
  } catch (err) {
    console.error('aris-memory model call failed');
    return '';
  }
  if (!res || !res.ok) {
    console.error('aris-memory model call status', res && res.status);
    return '';
  }
  try {
    return textFromAnthropic(await res.json());
  } catch (err) {
    console.error('aris-memory model response was not JSON');
    return '';
  }
}

async function loadMessages(supabase, conversationId) {
  const { data, error } = await supabase
    .from('aris_messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

async function refreshSummary(deps, conversation, messages) {
  const olderCount = Math.max(0, messages.length - memory.RECENT_TURN_LIMIT);
  const covered = conversation.summary_message_count || 0;
  const fresh = messages.slice(covered, olderCount);
  const transcript = memory.transcriptForSummary(fresh);
  const previous = conversation.rolling_summary ? memory.redactVendors(conversation.rolling_summary) : '';
  if (!transcript && !previous) return;
  const user = 'Previous summary:\n' + (previous || '(none)') + '\n\nNew lines to fold in:\n' + (transcript || '(none)');
  const text = memory.capToTokens(memory.redactVendors(await cheapComplete(deps, SUMMARY_SYSTEM, user)), memory.SUMMARY_MAX_TOKENS);
  if (!text) return;
  const { error } = await deps.supabase
    .from('aris_conversations')
    .update({
      rolling_summary: text,
      summary_message_count: olderCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
    .eq('memberstack_id', conversation.memberstack_id);
  if (error) throw error;
}

async function extractFacts(deps, conversation, messages) {
  const { data: existingRow, error: readError } = await deps.supabase
    .from('aris_member_facts')
    .select('facts')
    .eq('memberstack_id', conversation.memberstack_id)
    .maybeSingle();
  if (readError) throw readError;
  const existing = existingRow && existingRow.facts ? existingRow.facts : {};
  const transcript = memory.transcriptForSummary(messages).slice(0, 8000);
  const user = 'Existing facts:\n' + JSON.stringify(existing) + '\n\nThis conversation:\n' + transcript;
  const parsed = memory.parseFacts(await cheapComplete(deps, FACTS_SYSTEM, user));
  if (!parsed) return;
  const facts = memory.mergeFacts(existing, parsed);
  const { error: saveError } = await deps.supabase
    .from('aris_member_facts')
    .upsert({
      memberstack_id: conversation.memberstack_id,
      facts,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'memberstack_id' });
  if (saveError) throw saveError;
  const { error: markError } = await deps.supabase
    .from('aris_conversations')
    .update({ facts_extracted: true })
    .eq('id', conversation.id)
    .eq('memberstack_id', conversation.memberstack_id);
  if (markError) throw markError;
}

// Best-effort. A failed summary or fact call must not fail the save.
async function maintainConversation(deps, conversation) {
  if (!conversation || !conversation.id) return;
  let messages;
  try {
    messages = await loadMessages(deps.supabase, conversation.id);
  } catch (err) {
    console.error('aris-memory could not reload messages');
    return;
  }
  const jobs = [];
  if (memory.shouldRefreshSummary({
    messageCount: messages.length,
    summaryMessageCount: conversation.summary_message_count,
  })) {
    jobs.push(refreshSummary(deps, conversation, messages).catch((err) => {
      console.error('aris-memory summary failed');
    }));
  }
  if (memory.shouldExtractFacts({ factsExtracted: conversation.facts_extracted, messages })) {
    jobs.push(extractFacts(deps, conversation, messages).catch((err) => {
      console.error('aris-memory facts failed');
    }));
  }
  await Promise.all(jobs);
}

module.exports = {
  ...memory,
  SUMMARY_SYSTEM,
  FACTS_SYSTEM,
  textFromAnthropic,
  cheapComplete,
  loadMessages,
  maintainConversation,
};
