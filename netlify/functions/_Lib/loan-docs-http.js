// County document images. Off unless LOAN_DOCS_ENABLED is true.
// There is no default member price: LOAN_DOC_MEMBER_PRICE_CENTS must be a
// positive integer or nothing is quoted and nothing is exported.
//
// A confirmed purchase records the member price, then asks for DocImage.
// The same member and document is free after that. The image bytes are
// cached per document so a later purchase does not export the image again.
// The transaction list is a separate export (one per returned document),
// cached per property, and it is not a member charge.
//
// Card collection is not attached. The ledger row is the spend record.
// Leave LOAN_DOCS_ENABLED unset until a collector replaces chargeDocument.

const { json, preflight } = require('./http');
const storeLib = require('./loan-docs-store');
const vendor = require('./loan-docs-vendor');

const COMING_SOON = 'County document images are coming soon.';
const NOT_PRICED = 'County document images are not available yet.';
const NOT_CHARGED = 'That document image could not be loaded. You were not charged.';
const EMPIRE = 'Empire membership required.';
const UNAVAILABLE = 'Document images are temporarily unavailable.';
const NOT_FOR_LISTING = 'Document images are not available for this listing.';

function imageOk(image) {
  if (!image || typeof image.dataUrl !== 'string') return false;
  if (!/^data:(application\/pdf|image\/(?:png|jpeg|gif|webp));base64,[A-Za-z0-9+/=]+$/i.test(image.dataUrl)) return false;
  if (/propertyradar/i.test(image.contentType || '')) return false;
  return true;
}

function imageBody(documentId, image, chargedCents, cached) {
  return {
    documentId: documentId,
    cached: !!cached,
    chargedCents: chargedCents,
    contentType: image.contentType || 'application/pdf',
    imageDataUrl: image.dataUrl,
  };
}

async function loadStore(options) {
  if (options.store) return options.store;
  return storeLib.openStore();
}

async function markPurchased(store, memberId, documents) {
  const out = [];
  for (const doc of documents) {
    const row = await store.get(storeLib.purchaseKey(memberId, doc.documentId));
    out.push(Object.assign({}, doc, { purchased: !!(row && row.pending !== true) }));
  }
  return out;
}

async function releasePurchase(store, memberId, documentId) {
  await store.del(storeLib.purchaseKey(memberId, documentId));
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const env = options.env || process.env;
    const enforce = options.enforceMembership || function (ev, opts) {
      return require('./membership').enforceMembership(ev, opts);
    };
    const gate = await enforce(event, { need: 'member' });
    if (gate.response) return gate.response;
    const access = gate.access;
    const memberId = access.memberId;

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }

    const on = vendor.enabled(env);
    const price = vendor.memberPriceCents(env);
    const action = body.action || 'status';

    if (action === 'status') {
      const showPrice = on && !!access.empire && price != null;
      return json(200, {
        enabled: on,
        comingSoon: !on,
        empire: !!access.empire,
        priced: showPrice,
        priceCents: showPrice ? price : null,
      });
    }

    if (action !== 'list' && action !== 'purchase') return json(400, { error: 'Unknown action' });

    if (!on) return json(200, { enabled: false, comingSoon: true, error: COMING_SOON });
    if (!access.empire) return json(403, { error: EMPIRE });
    if (price == null) return json(200, { enabled: true, priced: false, error: NOT_PRICED });
    if (!vendor.validRadarId(body.radarId)) return json(400, { error: NOT_FOR_LISTING });

    let store;
    try { store = await loadStore(options); }
    catch (err) { return json(503, { error: UNAVAILABLE }); }

    if (action === 'list') return listDocuments(options, env, store, memberId, body, price);
    return purchaseDocument(options, env, store, memberId, body, price);
  };
}

async function listDocuments(options, env, store, memberId, body, price) {
  if (body.confirm !== true) {
    return json(200, {
      quote: true,
      needsConfirm: true,
      enabled: true,
      priced: true,
      priceCents: price,
      costCents: 0,
      cached: false,
    });
  }

  const key = storeLib.listKey(body.radarId);
  const cached = await store.get(key);
  if (cached && Array.isArray(cached.documents)) {
    return json(200, {
      cached: true,
      priceCents: price,
      documents: await markPurchased(store, memberId, cached.documents),
    });
  }

  if (!vendor.apiKey(env)) return json(503, { error: UNAVAILABLE });
  let listed;
  try {
    listed = await vendor.fetchTransactionList({
      env: env,
      fetch: options.fetch || fetch,
      radarId: body.radarId,
    });
  } catch (err) {
    console.error('loan document list failed:', err && err.message);
    return json(502, { error: UNAVAILABLE });
  }
  if (!listed.ok) return json(listed.code === 'unconfigured' ? 503 : 502, { error: UNAVAILABLE });

  const documents = listed.documents.slice(0, vendor.LIST_LIMIT);
  try {
    await store.set(key, { documents: documents, at: new Date().toISOString() });
  } catch (err) {
    console.error('loan document list cache failed:', err && err.message);
  }
  return json(200, {
    cached: false,
    priceCents: price,
    documents: await markPurchased(store, memberId, documents),
  });
}

async function purchaseDocument(options, env, store, memberId, body, price) {
  if (!vendor.validDocumentId(body.documentId)) return json(400, { error: NOT_FOR_LISTING });
  const documentId = String(body.documentId);
  const buyKey = storeLib.purchaseKey(memberId, documentId);
  const existing = await store.get(buyKey);
  const storedImage = await store.get(storeLib.imageKey(documentId));
  const picture = imageOk(storedImage) ? storedImage : null;
  const settled = !!(existing && existing.pending !== true);
  const pending = !!(existing && existing.pending === true);

  if (body.confirm !== true) {
    return json(200, {
      quote: true,
      enabled: true,
      priced: true,
      priceCents: price,
      costCents: settled || pending ? 0 : price,
      cached: settled && !!picture,
      pending: pending,
      documentId: documentId,
    });
  }

  if (settled && picture) {
    return json(200, imageBody(documentId, picture, 0, true));
  }

  // Refuse before any charge when the image is not cached and the export
  // key is missing. A cached image can still be sold without a new export.
  if (!picture && !vendor.apiKey(env)) {
    return json(503, { error: UNAVAILABLE });
  }

  let chargedNow = false;
  if (!settled && !pending) {
    const charge = options.charge || null;
    if (charge) {
      let verdict;
      try {
        verdict = await charge({
          memberId: memberId,
          documentId: documentId,
          radarId: body.radarId,
          cents: price,
        });
      } catch (err) {
        console.error('loan document charge failed:', err && err.message);
        return json(402, { error: 'Document image was not charged. Nothing was purchased.', priceCents: price });
      }
      if (!verdict || verdict.ok === false) {
        return json(402, {
          error: (verdict && verdict.error) || 'Document image was not charged. Nothing was purchased.',
          priceCents: price,
        });
      }
    }
    try {
      await store.set(buyKey, {
        chargedCents: price,
        radarId: body.radarId,
        pending: true,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('loan document charge record failed:', err && err.message);
      return json(503, { error: UNAVAILABLE });
    }
    chargedNow = true;
  }

  async function undoCharge() {
    if (!(chargedNow || pending)) return;
    await releasePurchase(store, memberId, documentId);
    if (typeof options.release !== 'function') return;
    try {
      await options.release({ memberId: memberId, documentId: documentId, radarId: body.radarId });
    } catch (err) {
      console.error('loan document release failed:', err && err.message);
    }
  }

  let image = picture;
  if (!image) {
    if (!vendor.apiKey(env)) {
      await undoCharge();
      return json(503, { error: chargedNow || pending ? NOT_CHARGED : UNAVAILABLE });
    }
    let fetched;
    try {
      fetched = await vendor.fetchDocumentImage({
        env: env,
        fetch: options.fetch || fetch,
        radarId: body.radarId,
        documentId: documentId,
      });
    } catch (err) {
      console.error('loan document image failed:', err && err.message);
      fetched = { ok: false };
    }
    if (!fetched.ok || !imageOk(fetched.image)) {
      await undoCharge();
      return json(502, { error: chargedNow || pending ? NOT_CHARGED : UNAVAILABLE });
    }
    image = { dataUrl: fetched.image.dataUrl, contentType: fetched.image.contentType || 'application/pdf' };
    try { await store.set(storeLib.imageKey(documentId), image); }
    catch (err) { console.error('loan document image cache failed:', err && err.message); }
  }

  const row = await store.get(buyKey);
  try {
    await store.set(buyKey, Object.assign({}, row || {}, {
      chargedCents: row && row.chargedCents != null ? row.chargedCents : price,
      radarId: body.radarId,
      pending: false,
      at: (row && row.at) || new Date().toISOString(),
    }));
  } catch (err) {
    console.error('loan document settle failed:', err && err.message);
  }
  return json(200, imageBody(documentId, image, chargedNow ? price : 0, false));
}

module.exports = {
  createHandler,
  COMING_SOON,
  NOT_PRICED,
  NOT_CHARGED,
  EMPIRE,
  UNAVAILABLE,
};
