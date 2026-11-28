// Live factual research for the ARIS coach.
//
// The coach already calls Anthropic's Messages API. That API has a
// server-side web_search tool, so a researched turn stays on the same
// vendor and the same API key. No second search vendor is called.
//
// web_search_20250305 is the basic server tool (no code-execution
// filter). max_uses caps the searches on one research call. Anthropic
// bills each search on the existing key; a failed search is not billed.
//
// The coach stream decides before it calls the model. A pure coaching
// or math turn is not searched. A question that would otherwise be
// answered with "I don't have that, go look it up" is searched first.
// The status line is emitted before the search, so Talk Mode can speak
// it while the lookup runs.

export const RESEARCH_STATUS = 'Let me research that';
export const RESEARCH_TIMEOUT_MS = 15000;
export const RESEARCH_MAX_SEARCHES = 2;
export const RESEARCH_TOOL_TYPE = 'web_search_20250305';

const OUTSIDE_FACT = [
  /\b(rail|rails|railroad|train|transit|metro|streetcar|amtrak|commuter|south shore|bus (?:line|route|service)|train station|rail station)\b/i,
  /\b(schools?|school district)\b/i,
  /\b(employers?|headquarters|unemployment|workforce|job growth|jobs report)\b/i,
  /\b(zoning|rezon\w*|ordinance|moratorium|variance|land use|building permits?)\b/i,
  /\b(crime|crime stats?|crime rate|police report)\b/i,
  /\b(population|census|demographics)\b/i,
  /\b(new development|developments|groundbreaking|annexation)\b/i,
  /\b(mayor|city council|governor|statute|homestead exemption|property tax rate|millage)\b/i,
  /\b(is there|are there|is it true|look (?:this |it )?up|fact[- ]check|confirm whether|double-check)\b/i,
  /\b(nearest|how far|drive time|minutes away)\b/i,
  /\b(flood zone|fema flood|wetlands?)\b/i,
  /\b(current|latest|today'?s|right now)\b.{0,48}\b(rate|law|rule|ordinance|tax|exemption|news)\b/i,
  /\b(just (?:opened|approved|passed|built|announced)|breaking news)\b/i,
  /\b(hospital|university|college)\b/i,
  /\bi heard that\b/i,
];

const COACHING_OR_FORGE = [
  /^\s*(hi|hey|hello|thanks|thank you|good morning|good afternoon|yo)\b[.!\s]*$/i,
  /\b(what should i say|what should i|how should i|should i|what would you|would you|talking points|script|walk me through|how do i (?:talk|negotiate|structure|wholesale|find deals|raise|calculate)|explain (?:the |how |a |an )?)\b/i,
  /\b(this seller|the seller|this deal|my deal|motivated seller)\b/i,
  /\b(70\s*%|seventy percent rule|\bmao\b|cash[- ]on[- ]cash|cap rate|\bdscr\b|\bnoi\b|calculate|run the numbers|my offer|what'?s my (?:offer|mao|spread|cash flow))\b/i,
  /\b(should i (?:wholesale|flip|hold|assign|pass|walk)|subject-?to|lease option|brrrr)\b/i,
  /\bwhat about (?:this|the|my) (?:deal|duplex|property|house|offer|seller|contract|rent)\b/i,
  /\b(my pipeline|my deals|my contacts|under contract|stale deals?|follow[- ]up)\b/i,
  /\b(comps?|after[- ]repair|\barv\b|rent estimate|property search|absentee|pre-?foreclos|lead list|good market|buy box|market score|home values?)\b/i,
  /\bwhere (?:is|do i find) the (?:deal analyzer|document vault|market oracle|capital radar)\b/i,
  /\bhow long\b.{0,40}\b(hold|flip|rehab|close|wholesale|deal)\b/i,
  /\bwhat(?:'s| is| are) (?:a |an |the )?(?:difference|70%|mao|cap rate|noi|dscr|subject-?to|lease option|wholesale|brrrr|assignment fee|land trust)\b/i,
];

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === 'string') parts.push(block);
    else if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === 'user') return message;
  }
  return null;
}

function previousUserText(messages, latest) {
  if (!Array.isArray(messages)) return '';
  let seenLatest = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    if (!seenLatest) {
      seenLatest = true;
      continue;
    }
    if (message === latest) continue;
    const text = contentToText(message.content).trim();
    if (text) return text;
  }
  return '';
}

export function isToolResultTurn(content) {
  if (!Array.isArray(content) || !content.length) return false;
  return content.every((block) => block && block.type === 'tool_result');
}

export function latestUserText(messages) {
  const message = lastUserMessage(messages);
  if (!message || isToolResultTurn(message.content)) return '';
  return contentToText(message.content).replace(/\s+/g, ' ').trim();
}

// The search query can include the previous user turn so a short
// follow-up ("and the schools?") still has a place. Classification
// uses only the latest turn, so a tool result cannot trigger a search.
export function researchQuestion(messages) {
  const latest = latestUserText(messages);
  if (!latest) return '';
  if (latest.length >= 80) return latest.slice(0, 2000);
  const prev = previousUserText(messages, lastUserMessage(messages));
  if (!prev) return latest.slice(0, 2000);
  return `${prev}\n${latest}`.slice(0, 2000);
}

export function classifyResearch(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 8) return 'skip';
  const outside = OUTSIDE_FACT.some((re) => re.test(raw));
  const coaching = COACHING_OR_FORGE.some((re) => re.test(raw));
  if (outside && !coaching) return 'research';
  if (outside && coaching) {
    // A deal-math question that also asks for an outside fact still
    // needs the fact. A market-score question does not: FORGE answers it.
    if (/\b(good market|market score|comps?|rent estimate|\barv\b|buy box)\b/i.test(raw)
      && !/\b(rail|school|crime|zoning|employer|population|ordinance|transit)\b/i.test(raw)) {
      return 'skip';
    }
    return 'research';
  }
  if (coaching) return 'skip';
  // Only a real outside fact is searched. A general question, including
  // "am I able to ask you about that", is coaching and must not show
  // "Let me research that".
  return 'skip';
}

export function classifyMessages(messages) {
  const message = lastUserMessage(messages);
  if (!message || isToolResultTurn(message.content)) return 'skip';
  return classifyResearch(latestUserText(messages));
}

export function webResearchEnabled(readEnv) {
  const read = typeof readEnv === 'function' ? readEnv : () => '';
  const raw = String(read('ARIS_WEB_RESEARCH') || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'off', 'false', 'no'].includes(raw);
}

export function webSearchTool() {
  return {
    type: RESEARCH_TOOL_TYPE,
    name: 'web_search',
    max_uses: RESEARCH_MAX_SEARCHES,
  };
}

const RESEARCH_SYSTEM = `You research one factual question for a real estate coach. Use the web_search tool before you answer. Then report only facts the results support. Name each source. If the results do not settle the question, say "Nothing solid found" and name what you checked. Do not give investing advice. Do not invent numbers, station names, drive times, employers, dates, or laws. Do not tell the reader to look it up.`;

export function researchRequestBody({ model, question }) {
  return {
    model: model || 'claude-sonnet-4-6',
    max_tokens: 900,
    stream: false,
    tools: [webSearchTool()],
    system: RESEARCH_SYSTEM,
    messages: [{ role: 'user', content: String(question || '').slice(0, 2000) }],
  };
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (err) {
    return 'source';
  }
}

function addSource(sources, seen, title, url) {
  const href = String(url || '').trim();
  if (!/^https?:\/\//i.test(href)) return;
  if (seen.has(href)) return;
  seen.add(href);
  const name = String(title || '').trim() || hostName(href);
  sources.push({ title: name.slice(0, 140), url: href });
}

function linksInText(text, sources, seen) {
  const linked = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match = linked.exec(text);
  while (match) {
    addSource(sources, seen, match[1], match[2]);
    match = linked.exec(text);
  }
}

export function parseResearchMessage(payload) {
  const content = payload && Array.isArray(payload.content) ? payload.content : [];
  const sources = [];
  const seen = new Set();
  const texts = [];
  let searchError = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim();
      if (text) texts.push(text);
      const citations = Array.isArray(block.citations) ? block.citations : [];
      for (const cite of citations) {
        if (cite && (cite.type === 'web_search_result_location' || cite.url)) {
          addSource(sources, seen, cite.title, cite.url);
        }
      }
      linksInText(text, sources, seen);
    }
    if (block.type === 'web_search_tool_result') {
      if (block.content && !Array.isArray(block.content) && block.content.type === 'web_search_tool_result_error') {
        searchError = String(block.content.error_code || 'search_error');
      }
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        if (item && item.type === 'web_search_result') addSource(sources, seen, item.title, item.url);
      }
    }
  }
  const findingsText = texts.join('\n').slice(0, 4000);
  const nothing = /nothing solid found/i.test(findingsText) && sources.length === 0;
  const ok = !searchError && !nothing && (sources.length > 0 || findingsText.length > 40);
  return {
    ok,
    reason: searchError || (nothing || !ok ? 'empty' : ''),
    findingsText,
    sources: sources.slice(0, 5),
    stopReason: payload && payload.stop_reason ? payload.stop_reason : '',
    content,
  };
}

export function researchSystemBlock(result) {
  const failed = !result || result.ok === false;
  if (failed) {
    const reason = result && result.reason ? result.reason : 'unavailable';
    return `\n\nLIVE RESEARCH:\nThe live web search did not return usable sourced results (${reason}). Do not invent the fact. In one sentence, say you could not confirm it from a live source. Then answer what you can from coaching and end with **Your Move:** or one sharp question. Do not tell the member to look it up, check a website, or open a map.\n`;
  }
  const lines = result.sources.map((source) => `- [${source.title}](${source.url})`).join('\n');
  const sourceBlock = lines ? `\nSources:\n${lines}\n` : '\n';
  return `\n\nLIVE RESEARCH FINDINGS (looked up just now; these are the only outside facts you may state):\n${result.findingsText || 'The search returned sources but no extra summary.'}\n${sourceBlock}Cite each fact you use with the site name and its markdown link. Do not add a station, employer, statute, drive time, or number that is not supported above. If a point is missing, say you could not confirm that part. Then tie the fact back to the member's deal, tenants, exit, or buy box, and end with **Your Move:** or one sharp question.\n`;
}

export function researchStatusEvent(text) {
  const line = text || RESEARCH_STATUS;
  return `data: ${JSON.stringify({ type: 'aris_status', status: 'research', text: line })}\n\n`;
}

export function fallbackAnswerEvents(text) {
  const line = text || "I couldn't confirm that from a live source. Tell me the city and the fact you need and I'll try once more. If this is about a property's value or rent, open it in Property Search and use FORGE Cast.";
  return [
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: line } })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`,
  ].join('');
}

export async function runWebResearch(options) {
  const opts = options || {};
  const fetchImpl = opts.fetch;
  const question = String(opts.question || '').trim();
  if (!fetchImpl || !question) {
    return { ok: false, reason: 'skipped', findingsText: '', sources: [] };
  }
  const timeoutMs = opts.timeoutMs || RESEARCH_TIMEOUT_MS;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const started = Date.now();
  try {
    const body = researchRequestBody({ model: opts.model, question });
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
    if (controller) init.signal = controller.signal;
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', init);
    if (!res || !res.ok) {
      return { ok: false, reason: 'http_' + (res && res.status ? res.status : 0), findingsText: '', sources: [] };
    }
    const json = await res.json();
    if (json && json.stop_reason === 'pause_turn' && !opts.continued && Array.isArray(json.content)) {
      const elapsed = Date.now() - started;
      const remaining = timeoutMs - elapsed;
      if (remaining > 1500) {
        return continuePausedResearch(opts, json.content, question, remaining);
      }
    }
    return parseResearchMessage(json);
  } catch (err) {
    const name = err && err.name ? err.name : '';
    const reason = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'error';
    return { ok: false, reason, findingsText: '', sources: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function continuePausedResearch(opts, assistantContent, question, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const body = researchRequestBody({ model: opts.model, question });
    body.messages = [
      { role: 'user', content: question },
      { role: 'assistant', content: assistantContent },
    ];
    const init = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
    if (controller) init.signal = controller.signal;
    const res = await opts.fetch('https://api.anthropic.com/v1/messages', init);
    if (!res || !res.ok) {
      return { ok: false, reason: 'http_' + (res && res.status ? res.status : 0), findingsText: '', sources: [] };
    }
    return parseResearchMessage(await res.json());
  } catch (err) {
    const name = err && err.name ? err.name : '';
    return { ok: false, reason: name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'error', findingsText: '', sources: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
