// Cache for county document images and the recorded-document list.
//
// Images are stored once per document so a second view does not export
// the image again. The member purchase row is per member and document:
// the same member's repeat view is free; another member still confirms
// their own price, then receives the cached image with no new export.
//
// Blobs are required in production. A missing blob context must not fall
// back to a process-local map, or a second invocation would charge again
// and export again. Tests pass a memory store.

const STORE_NAME = 'loan-doc-records';

function resetMemory() {
  // Kept so a caller can drop a shared fallback. Test stores are isolated.
}

function isStoreUnavailable(err) {
  const msg = String((err && err.message) || err || '');
  return /not been configured|Missing Blobs|Cannot find module|blobs context|No such module/i.test(msg);
}

function memoryStore() {
  const local = new Map();
  return {
    async get(key) {
      return local.has(key) ? local.get(key) : null;
    },
    async set(key, value) {
      local.set(key, value);
    },
    async del(key) {
      local.delete(key);
    },
  };
}

function wrapBlobStore(store) {
  return {
    async get(key) {
      const value = await store.get(key, { type: 'json' });
      return value && typeof value === 'object' ? value : null;
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
    async del(key) {
      if (typeof store.delete === 'function') await store.delete(key);
      else await store.setJSON(key, { deleted: true });
    },
  };
}

function openStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    return wrapBlobStore(getStore(STORE_NAME));
  } catch (err) {
    if (isStoreUnavailable(err)) {
      const error = new Error('store_unavailable');
      error.code = 'store_unavailable';
      throw error;
    }
    throw err;
  }
}

function safeId(value, max) {
  const text = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max || 40);
  return text;
}

function listKey(radarId) {
  return 'list:' + safeId(radarId, 40);
}

function imageKey(documentId) {
  return 'img:' + safeId(documentId, 40);
}

function purchaseKey(memberId, documentId) {
  return 'buy:' + safeId(memberId, 80) + ':' + safeId(documentId, 40);
}

module.exports = {
  STORE_NAME,
  resetMemory,
  memoryStore,
  openStore,
  isStoreUnavailable,
  listKey,
  imageKey,
  purchaseKey,
  safeId,
};
