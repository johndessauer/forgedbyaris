// netlify/functions/aris-memory.js
//
// Persistent ARIS coach chats for the signed-in member.
// Every request must carry a valid Memberstack Bearer token.
// The member id comes only from that token. A client-supplied
// memberstack_id is ignored, so one member cannot read or write
// another member's chats.
//
// Routes:
//   GET  ?action=list                         -> this member's chats, newest first
//   GET  ?action=load&id=<uuid>               -> one chat and its messages
//   GET  ?action=latest                       -> the newest chat and its messages
//   POST { action: 'append', conversationId?, messages, idempotencyKey? }
//   POST { action: 'delete', id }
//
// Append stores the turns, then (when the thread is past the budget)
// updates the rolling summary with a short model call. Facts are
// extracted at most once per conversation. Those calls are best-effort:
// a model failure still returns the saved chat.

const { enforceMembership } = require('./_Lib/membership');
const { json, preflight } = require('./_Lib/http');
const memory = require('./_Lib/aris-memory');

const LIST_LIMIT = 40;
const LOAD_LIMIT = 500;
const APPEND_LIMIT = 40;

function createHandler(deps) {
  const gate = deps.enforceMembership || enforceMembership;
  const getSupabase = () => deps.supabase || require('./_Lib/supabase-client').supabase;
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || ((...args) => fetch(...args));

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();

    const result = await gate(event);
    if (result.response) return result.response;
    const memberId = result.access.memberId;
    const supabase = getSupabase();

    try {
      if (event.httpMethod === 'GET') {
        const params = event.queryStringParameters || {};
        if (params.action === 'list') return json(200, { conversations: await listConversations(supabase, memberId) });
        if (params.action === 'latest') return json(200, await loadLatest(supabase, memberId));
        if (params.action === 'load') {
          if (!memory.isUuid(params.id)) return json(400, { error: 'id is required' });
          const loaded = await loadConversation(supabase, memberId, params.id);
          if (!loaded) return json(404, { error: 'Conversation not found' });
          return json(200, loaded);
        }
        return json(400, { error: 'Unknown action' });
      }

      if (event.httpMethod === 'POST') {
        let payload;
        try { payload = JSON.parse(event.body || '{}'); } catch (err) { return json(400, { error: 'Invalid JSON body' }); }
        if (payload.action === 'delete') return deleteConversation(supabase, memberId, payload.id);
        if (payload.action === 'append') {
          return appendMessages(supabase, memberId, payload, { env, fetch: fetchImpl, supabase });
        }
        return json(400, { error: 'Unknown action' });
      }

      return json(405, { error: 'Method not allowed' });
    } catch (err) {
      console.error('aris-memory error');
      return json(500, { error: 'Server error' });
    }
  };
}

async function listConversations(supabase, memberId) {
  const { data, error } = await supabase
    .from('aris_conversations')
    .select('id, title, updated_at, created_at')
    .eq('memberstack_id', memberId)
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    title: row.title || 'Chat',
    updated_at: row.updated_at,
    created_at: row.created_at,
  }));
}

async function loadConversation(supabase, memberId, id) {
  const { data: conversation, error } = await supabase
    .from('aris_conversations')
    .select('id, title, rolling_summary, summary_message_count, facts_extracted, created_at, updated_at, memberstack_id, last_append_key')
    .eq('id', id)
    .eq('memberstack_id', memberId)
    .maybeSingle();
  if (error) throw error;
  if (!conversation) return null;
  const { data: messages, error: messageError } = await supabase
    .from('aris_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(LOAD_LIMIT);
  if (messageError) throw messageError;
  const safe = { ...conversation };
  delete safe.memberstack_id;
  delete safe.last_append_key;
  return { conversation: safe, messages: messages || [] };
}

async function loadLatest(supabase, memberId) {
  const conversations = await listConversations(supabase, memberId);
  if (!conversations.length) return { conversation: null, messages: [] };
  return loadConversation(supabase, memberId, conversations[0].id);
}

function normalizeIncoming(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > APPEND_LIMIT) return null;
  const clean = [];
  for (const message of messages) {
    const stored = memory.sanitizeMessageForStorage(message);
    if (!stored) return null;
    clean.push(stored);
  }
  return clean;
}

async function appendMessages(supabase, memberId, payload, deps) {
  const incoming = normalizeIncoming(payload.messages);
  if (!incoming) return json(400, { error: 'messages must be a short list of user and assistant turns' });
  const idempotencyKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.slice(0, 160) : '';

  let conversation = null;
  if (payload.conversationId) {
    if (!memory.isUuid(payload.conversationId)) return json(400, { error: 'conversationId is invalid' });
    const { data, error } = await supabase
      .from('aris_conversations')
      .select('id, title, rolling_summary, summary_message_count, facts_extracted, memberstack_id, last_append_key')
      .eq('id', payload.conversationId)
      .eq('memberstack_id', memberId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json(404, { error: 'Conversation not found' });
    conversation = data;
    if (idempotencyKey && conversation.last_append_key === idempotencyKey) {
      return json(200, { conversationId: conversation.id, title: conversation.title || 'Chat', duplicate: true });
    }
  } else if (idempotencyKey) {
    const { data, error } = await supabase
      .from('aris_conversations')
      .select('id, title, rolling_summary, summary_message_count, facts_extracted, memberstack_id, last_append_key')
      .eq('memberstack_id', memberId)
      .eq('last_append_key', idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    if (data) return json(200, { conversationId: data.id, title: data.title || 'Chat', duplicate: true });
  }

  if (!conversation) {
    const { data, error } = await supabase
      .from('aris_conversations')
      .insert({
        memberstack_id: memberId,
        title: memory.titleFromMessages(incoming),
        summary_message_count: 0,
        facts_extracted: false,
      })
      .select('id, title, rolling_summary, summary_message_count, facts_extracted, memberstack_id, last_append_key')
      .single();
    if (error) throw error;
    conversation = data;
  }

  const now = Date.now();
  const rows = incoming.map((message, index) => ({
    conversation_id: conversation.id,
    role: message.role,
    content: message.content,
    created_at: new Date(now + index).toISOString(),
  }));
  const { error: insertError } = await supabase.from('aris_messages').insert(rows);
  if (insertError) throw insertError;

  const updates = {
    updated_at: new Date().toISOString(),
    last_append_key: idempotencyKey || null,
  };
  if (!conversation.title || conversation.title === 'Chat') {
    const title = memory.titleFromMessages(incoming);
    if (title && title !== 'Chat') updates.title = title;
  }
  const { error: updateError } = await supabase
    .from('aris_conversations')
    .update(updates)
    .eq('id', conversation.id)
    .eq('memberstack_id', memberId);
  if (updateError) throw updateError;

  await memory.maintainConversation(deps, {
    ...conversation,
    title: updates.title || conversation.title,
    memberstack_id: memberId,
  });

  return json(200, {
    conversationId: conversation.id,
    title: updates.title || conversation.title || 'Chat',
  });
}

async function deleteConversation(supabase, memberId, id) {
  if (!memory.isUuid(id)) return json(400, { error: 'id is required' });
  const { data, error } = await supabase
    .from('aris_conversations')
    .delete()
    .eq('id', id)
    .eq('memberstack_id', memberId)
    .select('id');
  if (error) throw error;
  return json(200, { deleted: !!(data && data.length) });
}

exports.createHandler = createHandler;
let prod = null;
exports.handler = (event, context) => {
  if (!prod) {
    prod = createHandler({
      enforceMembership,
      supabase: require('./_Lib/supabase-client').supabase,
      fetch: (...args) => fetch(...args),
      env: process.env,
    });
  }
  return prod(event, context);
};
