// netlify/functions/aris-quote.js
//
// One-shot ARIS completions for member pages: the Dashboard daily quote,
// Deal Analyzer, Market Oracle, Capital Radar and Deal Network.
//
// Locked down Oct 13, 2026. Before this, the function forwarded ANY request
// body to Anthropic with FORGE's API key and no login check, so anyone who
// found /api/aris-quote could spend on the account (a CORS header does not
// stop server-to-server calls). Now:
//   - a valid Memberstack member token is required (Authorization: Bearer)
//   - the model is fixed server-side; a client-sent `model` is ignored
//   - max_tokens is capped at MAX_TOKENS_CAP
//   - only `system` (string) and `messages` (array) are passed through
// The response shape is unchanged (Anthropic's JSON), so every caller keeps
// working once it sends the member token.

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_CAP = 2000;
const DEFAULT_MAX_TOKENS = 1000;
const MAX_SYSTEM_CHARS = 40000;
const MAX_MESSAGES = 40;

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://forgedbyaris.com',
};

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

function createHandler(deps) {
  return async function handler(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

    const env = deps.env || process.env;
    const API_KEY = env.ANTHROPIC_API_KEY;
    if (!API_KEY) return reply(500, { error: 'API key not configured' });

    try {
      await deps.verifyMember(event);
    } catch (e) {
      return reply(e.statusCode || 401, { error: 'session_expired', message: 'Please log in again.' });
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Invalid JSON body' }); }

    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > MAX_MESSAGES) {
      return reply(400, { error: 'messages must be a non-empty array' });
    }
    if (body.system !== undefined && typeof body.system !== 'string') return reply(400, { error: 'system must be a string' });
    if (body.system && body.system.length > MAX_SYSTEM_CHARS) return reply(400, { error: 'system prompt too long' });

    const requested = Number(body.max_tokens);
    const maxTokens = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_TOKENS_CAP) : DEFAULT_MAX_TOKENS;

    try {
      const response = await deps.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          ...(body.system ? { system: body.system } : {}),
          messages: body.messages,
        }),
      });
      const data = await response.json();
      // Same as before: always 200 with Anthropic's JSON, so callers that
      // read data.content / data.error keep working unchanged.
      return reply(200, data);
    } catch (err) {
      return reply(500, { error: 'Function error' });
    }
  };
}

exports.createHandler = createHandler;
// Production wiring is lazy so tests can load this file without Memberstack.
let prod = null;
exports.handler = (event, context) => {
  if (!prod) prod = createHandler({ verifyMember: require('./_Lib/verify-member').verifyMember, fetch: (...a) => fetch(...a) });
  return prod(event, context);
};
exports._limits = { MODEL, MAX_TOKENS_CAP, DEFAULT_MAX_TOKENS };
