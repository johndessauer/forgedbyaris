// Gated book download. Membership comes from enforceMembership (the same
// Memberstack plan check as the other member functions). The education
// level comes from education-badges.js, the same badge rule as
// education-data.js: every published topic passed at that tier.
//
// Real Estate H2O requires Rookie or higher.
// Apartment Confidential requires Investor or higher.
// Mogul counts as both.
//
// The PDF bytes are not in the repo. They are read from the Netlify Blobs
// store "forge-books" (keys real-estate-h2o.pdf and apartment-confidential.pdf).
// A missing blob is a friendly 404, not a stack trace.
//
// The Investor coaching link is returned only from ?part=coaching, and only
// to a member who has Investor or higher. It is not embedded in public pages
// or public scripts.

const { enforceMembership } = require('./_Lib/membership');
const { json, preflight } = require('./_Lib/http');
const {
  BOOK_STORE,
  BOOKS,
  badgesFromProgress,
  meetsLevel,
  denialMessage,
  missingMessage,
} = require('./_Lib/education-badges');

const COACHING_BOOKING_URL = 'https://calendar.app.google/eyhEYt8ApK1DAQWY6';

function defaultGetStore(name) {
  const { getStore } = require('@netlify/blobs');
  return getStore(name);
}

async function defaultLoadBadges(memberId) {
  const { supabase } = require('./_Lib/supabase-client');
  const { data: modules, error: moduleError } = await supabase
    .from('education_modules')
    .select('id')
    .eq('published', true);
  if (moduleError) throw moduleError;
  const { data: progress, error: progressError } = await supabase
    .from('education_progress')
    .select('module_id, tier, passed')
    .eq('memberstack_id', memberId);
  if (progressError) throw progressError;
  return badgesFromProgress(modules, progress);
}

async function readBlobBody(body) {
  if (!body) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(Buffer.from(step.value));
    }
    return Buffer.concat(chunks);
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  return null;
}

function pdfResponse(book, bytes) {
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${book.filename}"`,
      'Cache-Control': 'private, no-store',
    },
    body: bytes.toString('base64'),
  };
}

function createHandler(deps) {
  const options = deps || {};
  const enforce = options.enforceMembership || enforceMembership;
  const loadBadges = options.loadBadges || defaultLoadBadges;
  const openStore = options.getStore || defaultGetStore;

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      return json(405, { error: 'Method not allowed' });
    }

    const gate = await enforce(event);
    if (gate.response) return gate.response;

    const params = event.queryStringParameters || {};
    const book = BOOKS[params.book];
    if (!book) return json(400, { error: 'Unknown book.' });

    let badges;
    try {
      badges = await loadBadges(gate.access.memberId);
    } catch (err) {
      console.error('book-download badge lookup failed:', err);
      return json(500, { error: 'Could not check your level. Try again in a moment.' });
    }

    if (!meetsLevel(badges, book.minLevel)) {
      return json(403, { error: denialMessage(book) });
    }

    if (params.part === 'coaching') {
      if (book.id !== 'apartment-confidential') {
        return json(404, { error: 'This book does not include coaching calls.' });
      }
      return json(200, {
        url: COACHING_BOOKING_URL,
        callsUsed: 0,
        callsTotal: 3,
        callsNote: 'Placeholder. This count is not tracked.',
      });
    }
    if (params.part) return json(400, { error: 'Unknown book request.' });

    let store;
    try {
      store = openStore(BOOK_STORE);
    } catch (err) {
      console.error('book-download store failed:', err);
      return json(404, { error: missingMessage(book) });
    }

    let raw;
    try {
      raw = await store.get(book.blobKey, { type: 'stream' });
    } catch (err) {
      console.error('book-download read failed:', err);
      return json(404, { error: missingMessage(book) });
    }
    if (!raw) return json(404, { error: missingMessage(book) });

    let bytes;
    try {
      bytes = await readBlobBody(raw);
    } catch (err) {
      console.error('book-download stream failed:', err);
      return json(404, { error: missingMessage(book) });
    }
    if (!bytes || !bytes.length) return json(404, { error: missingMessage(book) });

    if (event.httpMethod === 'HEAD') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${book.filename}"`,
          'Cache-Control': 'private, no-store',
        },
        body: '',
      };
    }
    return pdfResponse(book, bytes);
  };
}

module.exports = {
  handler: createHandler(),
  createHandler,
  COACHING_BOOKING_URL,
  readBlobBody,
};
