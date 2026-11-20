// Temporary deploy-preview check. Creates one test postcard and one test
// letter and returns their ids. Refuses every other context and any key
// that is not a test key. The key is never included in the response.
const { json } = require('./_Lib/http');
const lob = require('./_Lib/marketing-lob');

const PIECES = [
  { channel: 'postcard', variantA: 'FORGE test postcard. Nothing is really printed.' },
  { channel: 'letter', variantA: 'FORGE test letter. Nothing is really printed.' },
];

function redact(text, key) {
  const raw = String(text || '');
  return key ? raw.split(key).join('[redacted]') : raw;
}

async function sendLabeled(env, fetchImpl, label, brand, lead) {
  const key = String(env.LOB_API_KEY || '');
  try {
    const result = await lob.sendPieces({
      env: env,
      fetch: fetchImpl,
      brand: brand,
      leads: [lead],
      pieces: PIECES,
    });
    return { label: label, ok: true, ids: result.ids };
  } catch (err) {
    return { label: label, ok: false, detail: redact(err && (err.detail || err.message), key) };
  }
}

async function runProbe(env, fetchImpl) {
  const key = String(env && env.LOB_API_KEY || '');
  if (String(env && env.CONTEXT || '') !== 'deploy-preview') {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  if (!key.startsWith('test_')) {
    const err = new Error('Mail is not configured.');
    err.statusCode = 503;
    throw err;
  }
  const sample = await sendLabeled(env, fetchImpl, 'sample', {
    businessName: 'FORGE Test',
    phone: '555-0100',
    returnAddress: { line1: '123 Sample Street', city: 'Sampletown', state: 'ST', zip: '00000' },
    colors: { primary: '#1F3348', accent: '#C89B3C' },
    disclosure: 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.',
  }, { owner: 'Pat Example', address: '123 Sample Street', city: 'Sampletown', state: 'ST', zip: '00000' });
  if (sample.ok) return { attempts: [sample] };
  const deliverable = await sendLabeled(env, fetchImpl, 'deliverable', {
    businessName: 'FORGE Test',
    phone: '415-555-0100',
    returnAddress: { line1: '185 Berry St Ste 6100', city: 'San Francisco', state: 'CA', zip: '94107' },
    colors: { primary: '#1F3348', accent: '#C89B3C' },
    disclosure: 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.',
  }, { owner: 'Pat Example', address: '210 King St', city: 'San Francisco', state: 'CA', zip: '94107' });
  return { attempts: [sample, deliverable] };
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler() {
    try {
      const body = await runProbe(options.env || process.env, options.fetch || fetch);
      return json(200, body);
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      return json(status, { error: err && err.message ? err.message : 'The test mailing was not accepted.' });
    }
  };
}

exports.createHandler = createHandler;
exports.runProbe = runProbe;
let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
