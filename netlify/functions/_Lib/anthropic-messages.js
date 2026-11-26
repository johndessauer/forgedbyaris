// CommonJS copy of netlify/edge-functions/lib/anthropic-messages.js.
// The edge runtime cannot require this file. Keep the function body
// identical. tests/anthropic-messages.test.js runs the same fixtures
// through both.
//
// Call this after storage paths and Docs/Sheets links have been turned
// into model content. History rows from aris_messages carry id and
// created_at. Anthropic rejects those extra keys. Only role and content
// are sent. String content stays a string.

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeCacheControl(value) {
  if (!isPlainObject(value) || value.type !== 'ephemeral') return null;
  const out = { type: 'ephemeral' };
  if (value.ttl === '5m' || value.ttl === '1h') out.ttl = value.ttl;
  return out;
}

function sanitizeBlocks(blocks, nested) {
  const out = [];
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    const clean = sanitizeBlock(block, nested);
    if (clean) out.push(clean);
  }
  return out;
}

function sanitizeSource(source) {
  if (!isPlainObject(source) || typeof source.type !== 'string') return null;
  if (source.type === 'base64') {
    if (typeof source.media_type !== 'string' || !source.media_type) return null;
    if (typeof source.data !== 'string' || !source.data) return null;
    return { type: 'base64', media_type: source.media_type, data: source.data };
  }
  if (source.type === 'url') {
    if (typeof source.url !== 'string' || !source.url) return null;
    return { type: 'url', url: source.url };
  }
  if (source.type === 'text') {
    if (typeof source.data !== 'string') return null;
    const out = { type: 'text', data: source.data };
    if (typeof source.media_type === 'string' && source.media_type) out.media_type = source.media_type;
    return out;
  }
  if (source.type === 'content') {
    if (typeof source.content === 'string') return { type: 'content', content: source.content };
    if (Array.isArray(source.content)) {
      const content = sanitizeBlocks(source.content, true);
      if (!content.length) return null;
      return { type: 'content', content };
    }
  }
  return null;
}

function sanitizeBlock(block, nested) {
  if (!isPlainObject(block) || typeof block.type !== 'string') return null;
  const cache = sanitizeCacheControl(block.cache_control);
  if (block.type === 'text') {
    if (typeof block.text !== 'string') return null;
    const out = { type: 'text', text: block.text };
    if (cache) out.cache_control = cache;
    return out;
  }
  if (block.type === 'image') {
    const source = sanitizeSource(block.source);
    if (!source) return null;
    const out = { type: 'image', source };
    if (cache) out.cache_control = cache;
    return out;
  }
  if (nested) return null;
  if (block.type === 'document') {
    const source = sanitizeSource(block.source);
    if (!source) return null;
    const out = { type: 'document', source };
    if (typeof block.title === 'string' && block.title) out.title = block.title;
    if (typeof block.context === 'string' && block.context) out.context = block.context;
    if (isPlainObject(block.citations) && typeof block.citations.enabled === 'boolean') {
      out.citations = { enabled: block.citations.enabled };
    }
    if (cache) out.cache_control = cache;
    return out;
  }
  if (block.type === 'tool_use') {
    if (typeof block.id !== 'string' || !block.id) return null;
    if (typeof block.name !== 'string' || !block.name) return null;
    const out = {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: isPlainObject(block.input) ? Object.assign({}, block.input) : {},
    };
    if (cache) out.cache_control = cache;
    return out;
  }
  if (block.type === 'tool_result') {
    if (typeof block.tool_use_id !== 'string' || !block.tool_use_id) return null;
    const out = { type: 'tool_result', tool_use_id: block.tool_use_id };
    if (typeof block.content === 'string') out.content = block.content;
    else if (Array.isArray(block.content)) {
      const content = sanitizeBlocks(block.content, true);
      if (content.length) out.content = content;
    }
    if (typeof block.is_error === 'boolean') out.is_error = block.is_error;
    if (cache) out.cache_control = cache;
    return out;
  }
  return null;
}

function sanitizeAnthropicMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const message of messages) {
    if (!isPlainObject(message)) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    const content = sanitizeBlocks(message.content, false);
    if (!content.length) continue;
    out.push({ role: message.role, content });
  }
  return out;
}

module.exports = { sanitizeAnthropicMessages };
