// Brand Kit. One folder of blobs per member, keyed by the Memberstack id
// from the verified token. A student can only read and write their own kit.
//
// Foundation: 1 brand. Empire: up to 3. Logo, colors, and text only.
// Name, return address, and phone are required before mail copy is exported.
const { json, preflight } = require('./_Lib/http');
const { loadMarketingGate } = require('./_Lib/marketing-access');
const { memberKey, openBlobStore, readJson } = require('./_Lib/marketing-store');
const images = require('./_Lib/marketing-images');
const catalog = require('../../assets/js/marketing-catalog.js');

const FORBIDDEN_KEYS = ['font', 'fonts', 'fontFamily', 'fontSize', 'layout', 'template', 'templateId'];

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeAddress(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    line1: cleanText(src.line1, 120),
    line2: cleanText(src.line2, 120),
    city: cleanText(src.city, 80),
    state: cleanText(src.state, 40),
    zip: cleanText(src.zip, 20),
  };
}

function normalizeBrand(input, existing) {
  const src = input && typeof input === 'object' ? input : {};
  FORBIDDEN_KEYS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      const err = new Error('Students customize the logo, the colors, and the text. Fonts and layouts stay on the template.');
      err.statusCode = 400;
      throw err;
    }
  });
  const primary = images.normalizeHex(src.colors && src.colors.primary);
  const accent = images.normalizeHex(src.colors && src.colors.accent);
  if ((src.colors && src.colors.primary && !primary) || (src.colors && src.colors.accent && !accent)) {
    const err = new Error('Colors must be hex values, such as #1F3348.');
    err.statusCode = 400;
    throw err;
  }
  const prior = existing || {};
  const disclosure = Object.prototype.hasOwnProperty.call(src, 'disclosure')
    ? cleanText(src.disclosure, 400)
    : (prior.disclosure || catalog.DISCLOSURE_DEFAULT);
  return {
    id: prior.id || '',
    label: cleanText(src.label, 60) || prior.label || '',
    businessName: cleanText(src.businessName, 120),
    phone: cleanText(src.phone, 40),
    website: cleanText(src.website, 200),
    email: cleanText(src.email, 200),
    signOff: cleanText(src.signOff, 160),
    tagline: cleanText(src.tagline, 160),
    disclosure: disclosure,
    returnAddress: normalizeAddress(src.returnAddress),
    colors: {
      primary: primary || (prior.colors && prior.colors.primary) || '',
      accent: accent || (prior.colors && prior.colors.accent) || '',
      textOnPrimary: images.readableTextColor(primary || (prior.colors && prior.colors.primary) || '#1F3348'),
    },
    logo: prior.logo || null,
    headshot: prior.headshot || null,
    updatedAt: new Date().toISOString(),
  };
}

function mailReadiness(brand) {
  const row = brand || {};
  const missing = [];
  if (!cleanText(row.businessName, 120)) missing.push('business name');
  const digits = String(row.phone || '').replace(/\D/g, '');
  if (digits.length < 7) missing.push('phone');
  const addr = row.returnAddress || {};
  if (!cleanText(addr.line1, 120)) missing.push('return address');
  if (!cleanText(addr.city, 80)) missing.push('return city');
  if (!cleanText(addr.state, 40)) missing.push('return state');
  if (!cleanText(addr.zip, 20)) missing.push('return ZIP');
  return { ready: missing.length === 0, missing: missing };
}

function publicBrand(brand) {
  const copy = Object.assign({}, brand);
  delete copy.memberId;
  return copy;
}

function brandsKey(memberId) {
  return 'brands/' + memberKey(memberId) + '.json';
}

function assetKey(memberId, brandId, kind) {
  return 'assets/' + memberKey(memberId) + '/' + brandId + '/' + kind;
}

function rightsKey(memberId) {
  return 'rights/' + memberKey(memberId) + '.json';
}

function newId() {
  return 'brand_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function loadBrands(store, memberId) {
  const doc = await readJson(store, brandsKey(memberId));
  const brands = doc && Array.isArray(doc.brands) ? doc.brands : [];
  return brands;
}

async function saveBrands(store, memberId, brands) {
  await store.setJSON(brandsKey(memberId), { brands: brands });
}

function createHandler(deps) {
  const options = deps || {};
  const env = options.env || process.env;

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const gate = await loadMarketingGate(event, {
      requireMembership: options.requireMembership,
      getMember: options.getMember,
      env: env,
      context: options.context,
    });
    if (gate.response) return gate.response;
    if (!gate.flag.allowed) return json(403, { error: 'Marketing is not available on this account yet.' });

    let store;
    try { store = options.getStore ? options.getStore() : openBlobStore(); }
    catch (err) { return json(503, { error: 'Brand Kit storage is not available.' }); }

    const memberId = gate.access.memberId;
    const params = event.queryStringParameters || {};

    if (event.httpMethod === 'POST' && params.action === 'upload') {
      const headers = event.headers || {};
      const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
      if (!/application\/json/i.test(contentType)) {
        const bytes = event.isBase64Encoded
          ? Buffer.from(event.body || '', 'base64')
          : Buffer.from(event.body || '', 'latin1');
        try {
          return await uploadAsset(store, memberId, {
            kind: params.kind,
            brandId: params.brandId,
            fileName: params.fileName,
            rightsAccepted: params.rights === '1',
            bytes: bytes,
          });
        } catch (err) {
          return uploadError(err);
        }
      }
    }

    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.asset && params.brandId) {
        const kind = params.asset === 'headshot' ? 'headshot' : 'logo';
        const raw = await store.get(assetKey(memberId, params.brandId, kind), { type: 'arrayBuffer' });
        if (!raw) return json(404, { error: 'That file is not in your Brand Kit.' });
        const brands = await loadBrands(store, memberId);
        const brand = brands.find(function (row) { return row.id === params.brandId; });
        const meta = brand && brand[kind];
        const bytes = Buffer.from(raw);
        return {
          statusCode: 200,
          isBase64Encoded: true,
          headers: {
            'Content-Type': (meta && meta.contentType) || 'application/octet-stream',
            'Cache-Control': 'private, no-store',
            'Access-Control-Allow-Origin': '*',
          },
          body: bytes.toString('base64'),
        };
      }
      const brands = await loadBrands(store, memberId);
      return json(200, {
        brands: brands.map(publicBrand),
        brandLimit: gate.flag.brandLimit,
        empire: gate.flag.empire,
        disclosureDefault: catalog.DISCLOSURE_DEFAULT,
        rightsText: catalog.RIGHTS_TEXT,
      });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }
    const action = String(body.action || 'save');

    try {
      if (action === 'save') return await saveBrand(store, memberId, gate.flag, body.brand);
      if (action === 'upload') return await uploadAsset(store, memberId, body);
      if (action === 'delete-asset') return await deleteAsset(store, memberId, body);
      if (action === 'delete') return await deleteBrand(store, memberId, body.brandId);
      if (action === 'suggest') return json(200, suggestColors(body.samples));
      if (action === 'review-list') return await reviewList(store, gate.flag);
      if (action === 'review-resolve') return await reviewResolve(store, gate.flag, body.id);
      return json(400, { error: 'Unknown Brand Kit action.' });
    } catch (err) {
      return uploadError(err);
    }
  };
}

function uploadError(err) {
  const status = err && err.statusCode ? err.statusCode : 500;
  if (status >= 500) console.error('marketing-brand failed:', err);
  const storage = /blobs|not been configured|Missing Blobs/i.test(String(err && err.message || ''));
  const message = storage
    ? 'Brand Kit storage is not available. Nothing was saved.'
    : (status >= 500 ? 'Brand Kit could not be saved.' : err.message);
  return json(storage ? 503 : status, { error: message });
}

function suggestColors(samples) {
  const swatches = images.pickSwatches(samples);
  return {
    swatches: swatches,
    textOnPrimary: images.readableTextColor(swatches[0] || '#1F3348'),
  };
}

async function saveBrand(store, memberId, flag, input) {
  const brands = await loadBrands(store, memberId);
  const requestedId = input && input.id ? String(input.id) : '';
  const index = brands.findIndex(function (row) { return row.id === requestedId; });
  if (!requestedId && brands.length >= flag.brandLimit) {
    const err = new Error(flag.empire
      ? 'Empire members can save up to 3 brands.'
      : 'Foundation includes one Brand Kit. A second brand is part of Empire.');
    err.statusCode = 403;
    throw err;
  }
  if (requestedId && index === -1) {
    const err = new Error('That brand was not found on your account.');
    err.statusCode = 404;
    throw err;
  }
  const next = normalizeBrand(input, index === -1 ? null : brands[index]);
  if (!next.id) {
    next.id = newId();
    next.label = next.label || next.businessName || 'Brand ' + (brands.length + 1);
    brands.push(next);
  } else {
    next.label = next.label || brands[index].label || next.businessName || 'Brand';
    brands[index] = next;
  }
  const flagged = images.looksAlikeBrand(next.businessName) || images.looksAlikeBrand(next.tagline);
  if (flagged) await queueReview(store, memberId, { brandId: next.id, reason: 'name', text: next.businessName });
  await saveBrands(store, memberId, brands);
  return json(200, {
    brand: publicBrand(next),
    mail: mailReadiness(next),
    flagged: flagged,
    brandLimit: flag.brandLimit,
  });
}

async function uploadAsset(store, memberId, body) {
  if (body.rightsAccepted !== true) {
    const err = new Error('Check the box that you own this logo or image, or you have permission to use it.');
    err.statusCode = 400;
    throw err;
  }
  const kind = body.kind === 'headshot' ? 'headshot' : 'logo';
  const brandId = String(body.brandId || '');
  const brands = await loadBrands(store, memberId);
  const index = brands.findIndex(function (row) { return row.id === brandId; });
  if (index === -1) {
    const err = new Error('Save the Brand Kit before you upload a file.');
    err.statusCode = 404;
    throw err;
  }
  const image = images.validateImage({
    kind: kind,
    fileName: body.fileName,
    dataBase64: body.dataBase64,
    bytes: body.bytes,
  });
  try {
    await store.set(assetKey(memberId, brandId, kind), image.bytes, {
      metadata: { contentType: image.contentType },
    });
  } catch (err) {
    const wrapped = new Error('Brand Kit storage is not available. Nothing was saved.');
    wrapped.statusCode = 503;
    throw wrapped;
  }
  brands[index][kind] = {
    fileName: image.fileName,
    contentType: image.contentType,
    width: image.width,
    height: image.height,
    warnings: image.warnings,
    flagged: image.flagged,
    updatedAt: new Date().toISOString(),
  };
  brands[index].updatedAt = brands[index][kind].updatedAt;
  if (kind === 'logo' && image.swatches.length && !(brands[index].colors && brands[index].colors.primary)) {
    brands[index].colors = {
      primary: image.swatches[0] || '',
      accent: image.swatches[1] || image.swatches[0] || '',
      textOnPrimary: images.readableTextColor(image.swatches[0] || '#1F3348'),
    };
  }
  await saveBrands(store, memberId, brands);
  const rights = await readJson(store, rightsKey(memberId)) || [];
  rights.push({
    memberId: memberId,
    brandId: brandId,
    kind: kind,
    fileName: image.fileName,
    at: new Date().toISOString(),
    text: catalog.RIGHTS_TEXT,
  });
  await store.setJSON(rightsKey(memberId), rights);
  let reviewId = '';
  if (image.flagged) {
    reviewId = await queueReview(store, memberId, {
      brandId: brandId,
      reason: 'logo',
      fileName: image.fileName,
    });
  }
  return json(200, {
    brand: publicBrand(brands[index]),
    warnings: image.warnings,
    swatches: image.swatches,
    flagged: image.flagged,
    reviewId: reviewId,
  });
}

async function deleteAsset(store, memberId, body) {
  const kind = body.kind === 'headshot' ? 'headshot' : 'logo';
  const brands = await loadBrands(store, memberId);
  const index = brands.findIndex(function (row) { return row.id === body.brandId; });
  if (index === -1) return json(404, { error: 'That brand was not found on your account.' });
  await store.delete(assetKey(memberId, body.brandId, kind));
  brands[index][kind] = null;
  brands[index].updatedAt = new Date().toISOString();
  await saveBrands(store, memberId, brands);
  return json(200, { brand: publicBrand(brands[index]) });
}

async function deleteBrand(store, memberId, brandId) {
  const brands = await loadBrands(store, memberId);
  const next = brands.filter(function (row) { return row.id !== brandId; });
  if (next.length === brands.length) return json(404, { error: 'That brand was not found on your account.' });
  await store.delete(assetKey(memberId, brandId, 'logo'));
  await store.delete(assetKey(memberId, brandId, 'headshot'));
  await saveBrands(store, memberId, next);
  return json(200, { brands: next.map(publicBrand) });
}

async function queueReview(store, memberId, info) {
  const id = 'review_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const row = {
    id: id,
    memberId: memberId,
    brandId: info.brandId || '',
    reason: info.reason || 'logo',
    fileName: info.fileName || '',
    text: info.text || '',
    at: new Date().toISOString(),
    status: 'open',
    notification: {
      to: 'john@thedessauergroup.com',
      status: 'not-sent',
      reason: 'Email notification is stubbed in this step. Nothing is sent.',
    },
  };
  await store.setJSON('review-queue/' + id + '.json', row);
  return id;
}

async function reviewList(store, flag) {
  if (!flag.reviewer) {
    const err = new Error('Only John can open the review queue.');
    err.statusCode = 403;
    throw err;
  }
  const listed = await store.list({ prefix: 'review-queue/' });
  const blobs = (listed && listed.blobs) || [];
  const items = [];
  for (const blob of blobs) {
    const row = await readJson(store, blob.key);
    if (row && row.status !== 'resolved') items.push(row);
  }
  items.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  return json(200, { items: items });
}

async function reviewResolve(store, flag, id) {
  if (!flag.reviewer) {
    const err = new Error('Only John can open the review queue.');
    err.statusCode = 403;
    throw err;
  }
  const key = 'review-queue/' + String(id || '') + '.json';
  const row = await readJson(store, key);
  if (!row) return json(404, { error: 'That review was not found.' });
  row.status = 'resolved';
  row.resolvedAt = new Date().toISOString();
  await store.setJSON(key, row);
  return json(200, { item: row });
}

exports.createHandler = createHandler;
exports.normalizeBrand = normalizeBrand;
exports.mailReadiness = mailReadiness;
exports.publicBrand = publicBrand;

let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
