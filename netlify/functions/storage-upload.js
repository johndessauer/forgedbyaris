// Signed upload URLs for member files, plus a small "read this file" step
// the coach stream uses so a large PDF never travels through the edge function.
//
// POST { action: 'sign', purpose, filename, contentType, size }
//   -> { bucket, path, signedUrl, token, contentType, upsert }
// POST { action: 'materialize', files: [{ path, mediaType, name }], links: [{ url }] }
//   -> { files: [{ path, block }], links: [{ url, block }] }
//
// The member token is checked before any path is issued or any object is read.
// Paths are always created here and always start with that member's id.

const { json, preflight } = require('./_Lib/http');
const uploads = require('./_Lib/member-uploads');

function storageFromSupabase(supabase) {
  return {
    async sign(bucket, path, upsert) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: !!upsert });
      if (error || !data || !data.signedUrl) {
        const err = new Error('Could not start the upload.');
        err.statusCode = 502;
        throw err;
      }
      return data;
    },
    async download(bucket, path) {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) return null;
      const buffer = Buffer.from(await data.arrayBuffer());
      return { buffer, contentType: data.type || '', size: buffer.length };
    },
    async info(bucket, path) {
      const api = supabase.storage.from(bucket);
      if (typeof api.info !== 'function') return null;
      const { data, error } = await api.info(path);
      if (error || !data) return null;
      const meta = data.metadata || {};
      return {
        size: Number(data.size != null ? data.size : meta.size),
        contentType: data.contentType || meta.mimetype || meta.contentType || '',
      };
    },
    async signedDownload(bucket, path, expiresIn) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
      if (error || !data) return '';
      return data.signedUrl || data.signedURL || '';
    },
    async remove(bucket, paths) {
      await supabase.storage.from(bucket).remove(paths);
    },
  };
}

function defaultStorage() {
  const { supabase } = require('./_Lib/supabase-client');
  return storageFromSupabase(supabase);
}

function createHandler(deps) {
  const gate = deps.enforceMembership || ((event) => require('./_Lib/membership').enforceMembership(event));
  const getStorage = deps.getStorage || defaultStorage;
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const auth = await gate(event);
    if (auth.response) return auth.response;
    const memberId = auth.access && auth.access.memberId;
    if (!memberId) return json(401, { error: 'Sign in again, then retry the upload.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid JSON body' }); }

    try {
      if (body.action === 'sign') {
        const plan = uploads.planUpload(memberId, body, deps.nonce);
        const storage = await Promise.resolve(getStorage());
        const signed = await storage.sign(plan.bucket, plan.path, plan.upsert);
        return json(200, {
          bucket: plan.bucket,
          path: plan.path,
          signedUrl: uploads.absoluteSignedUrl(signed.signedUrl, env.SUPABASE_URL),
          token: signed.token || '',
          contentType: plan.contentType,
          upsert: plan.upsert,
        });
      }

      if (body.action === 'materialize') {
        const files = Array.isArray(body.files) ? body.files : [];
        const links = Array.isArray(body.links) ? body.links : [];
        const storage = files.length ? await Promise.resolve(getStorage()) : null;
        const messages = [{
          role: 'user',
          content: files.map((file) => ({
            type: 'forge_file',
            path: file && file.path,
            mediaType: file && file.mediaType,
            name: file && file.name,
          })).concat(links.map((link) => ({ type: 'forge_link', url: link && link.url }))),
        }];
        const resolved = await uploads.resolveMessages(messages, {
          memberId,
          binaryMax: uploads.RESPONSE_BINARY_MAX_BYTES,
          fetchImpl,
          loadObject: async (path) => {
            const obj = await storage.download(uploads.PRIVATE_BUCKET, path);
            if (obj) return obj;
            return storage.download(uploads.AVATAR_BUCKET, path);
          },
        });
        const blocks = resolved[0].content;
        const fileBlocks = blocks.slice(0, files.length);
        const linkBlocks = blocks.slice(files.length);
        return json(200, {
          files: files.map((file, index) => ({ path: file.path, block: fileBlocks[index] })),
          links: links.map((link, index) => ({ url: link.url, block: linkBlocks[index] })),
        });
      }

      return json(400, { error: 'Unknown action' });
    } catch (err) {
      if (err && err.statusCode) {
        return json(err.statusCode, { error: err.code || 'upload', message: err.message, code: err.code || '' });
      }
      console.error('storage-upload error');
      return json(500, { error: 'Could not finish that upload.' });
    }
  };
}

exports.createHandler = createHandler;
exports.storageFromSupabase = storageFromSupabase;
let prod = null;
exports.handler = (event, context) => {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
