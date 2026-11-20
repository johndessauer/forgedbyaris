// Per-member Marketing storage. Production uses the Netlify Blobs store
// "marketing". Tests pass a memory store with the same get/set/delete/list shape.
const STORE_NAME = 'marketing';

function memberKey(memberId) {
  const clean = String(memberId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) {
    const err = new Error('Missing member id');
    err.statusCode = 401;
    throw err;
  }
  return clean;
}

function createMemoryBlobStore() {
  const files = new Map();
  return {
    files: files,
    async set(key, value, options) {
      const body = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value));
      files.set(key, { body: body, metadata: (options && options.metadata) || {} });
    },
    async setJSON(key, value) {
      await this.set(key, JSON.stringify(value));
    },
    async get(key, options) {
      const row = files.get(key);
      if (!row) return null;
      const type = options && options.type;
      if (type === 'arrayBuffer') {
        return row.body.buffer.slice(row.body.byteOffset, row.body.byteOffset + row.body.byteLength);
      }
      if (type === 'stream') return row.body;
      return row.body.toString('utf8');
    },
    async delete(key) {
      files.delete(key);
    },
    async list(options) {
      const prefix = (options && options.prefix) || '';
      const blobs = [];
      for (const key of files.keys()) {
        if (String(key).startsWith(prefix)) blobs.push({ key: key });
      }
      return { blobs: blobs };
    },
  };
}

// These functions use the Lambda-compatible handler(event) signature.
// @netlify/blobs does not configure itself in that mode. connectLambda
// reads the site id and token Netlify already puts on the event, so no
// API token or site id has to be set as an environment variable.
function openBlobStore(event, deps) {
  const options = deps || {};
  if (options.connectLambda || options.getNamedStore) {
    if (options.connectLambda) options.connectLambda(event);
    if (!options.getNamedStore) {
      const err = new Error('Brand Kit storage is not available.');
      err.statusCode = 503;
      throw err;
    }
    return options.getNamedStore(STORE_NAME);
  }
  const blobs = require('@netlify/blobs');
  if (event && typeof blobs.connectLambda === 'function') blobs.connectLambda(event);
  return blobs.getStore(STORE_NAME);
}

async function readJson(store, key) {
  const raw = await store.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (err) { return null; }
}

module.exports = {
  STORE_NAME: STORE_NAME,
  memberKey: memberKey,
  createMemoryBlobStore: createMemoryBlobStore,
  openBlobStore: openBlobStore,
  readJson: readJson,
};
