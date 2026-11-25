// Turns storage paths and Docs/Sheets links into model content before the
// coach stream calls the model. The bytes are read by the Node function.
// This file never fetches an arbitrary URL.

const LEGACY_INLINE_MAX_BYTES = 4 * 1024 * 1024;

function base64DecodedBytes(data) {
  const s = String(data || '').replace(/\s/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : (s.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

export function collectUploads(messages) {
  const files = [];
  const links = [];
  if (!Array.isArray(messages)) return { files, links };
  messages.forEach((message) => {
    if (!message || !Array.isArray(message.content)) return;
    message.content.forEach((block) => {
      if (!block || typeof block !== 'object') return;
      if (block.type === 'forge_file' && block.path) {
        files.push({ path: String(block.path), mediaType: String(block.mediaType || ''), name: String(block.name || '') });
      } else if (block.type === 'forge_link' && block.url) {
        links.push({ url: String(block.url) });
      }
    });
  });
  return { files, links };
}

export function oversizedInline(messages) {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const data = block && block.source && block.source.type === 'base64' ? block.source.data : '';
      if (data && base64DecodedBytes(data) > LEGACY_INLINE_MAX_BYTES) return true;
    }
  }
  return false;
}

export function applyResolvedBlocks(messages, resolved) {
  const files = new Map((resolved && resolved.files || []).map((item) => [item.path, item.block]));
  const links = new Map((resolved && resolved.links || []).map((item) => [item.url, item.block]));
  return (messages || []).map((message) => {
    if (!message || !Array.isArray(message.content)) return message;
    return Object.assign({}, message, {
      content: message.content.map((block) => {
        if (block && block.type === 'forge_file' && files.has(block.path)) return files.get(block.path);
        if (block && block.type === 'forge_link' && links.has(block.url)) return links.get(block.url);
        return block;
      }),
    });
  });
}

export async function resolveUploadBlocks(messages, request, fetchImpl) {
  const found = collectUploads(messages);
  if (!found.files.length && !found.links.length) return messages;
  const fetcher = fetchImpl || fetch;
  const origin = new URL(request.url).origin;
  const res = await fetcher(origin + '/.netlify/functions/storage-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: request.headers.get('authorization') || '',
    },
    body: JSON.stringify({ action: 'materialize', files: found.files, links: found.links }),
  });
  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }
  if (!res.ok) {
    const err = new Error(body.message || 'Could not read that file.');
    err.status = res.status || 400;
    err.code = body.code || body.error || '';
    throw err;
  }
  return applyResolvedBlocks(messages, body);
}
