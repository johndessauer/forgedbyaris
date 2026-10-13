// netlify/functions/_Lib/rentcast-client.js
//
// Thin RentCast client. Auth is the X-Api-Key header from
// process.env.RENTCAST_API_KEY — never logged, never returned.
//
// Endpoints, params and response shapes follow developers.rentcast.io
// (read Oct 12, 2026):
//   - /properties supports address + radius (miles) for a circular search,
//     and saleDateRange (days) for sold properties.
//   - /avm/value and /avm/rent/long-term take address (needed for
//     lookupSubjectAttributes), compCount 5–25, maxRadius, daysOld.
//   - /markets takes zipCode, dataType, historyRange (months).
// UNVERIFIED against a live FORGE call until Phase 5 — see the dated
// verification comment block in rentcast-comps.js.

const path = require('path');
const fs = require('fs');

const RENTCAST_BASE = 'https://api.rentcast.io/v1';

const FIXTURE_FILES = {
  'properties:subject': 'properties-subject.json',
  'properties:sold': 'properties-sold.json',
  'avm/value': 'avm-value.json',
  'avm/rent/long-term': 'avm-rent.json',
  'markets': 'markets.json',
  'listings/sale': 'listings-sale.json',
  'listings/rental/long-term': 'listings-rental.json',
};

const FIXTURE_DIR = path.join(__dirname, '..', '__fixtures__', 'rentcast');

// Fixture dates are anchored here. Loading with `now` shifts every date
// field forward by (now − anchor), so demo sales stay "recent".
const FIXTURE_ANCHOR = Date.parse('2026-10-12T00:00:00.000Z');

function shiftDates(value, deltaMs, key) {
  if (Array.isArray(value)) return value.map(v => shiftDates(v, deltaMs));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = shiftDates(value[k], deltaMs, k); });
    return out;
  }
  if (typeof value === 'string' && key && (/Date$/.test(key) || key === 'date') && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(Date.parse(value) + deltaMs).toISOString();
  }
  return value;
}

function loadFixture(fixtureId, now) {
  const file = FIXTURE_FILES[fixtureId];
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
  if (!now) return data;
  const delta = Math.max(0, (now instanceof Date ? now.getTime() : Number(now)) - FIXTURE_ANCHOR);
  // Whole days only, so the shifted dates stay on midnight boundaries.
  return delta ? shiftDates(data, Math.floor(delta / 86400000) * 86400000) : data;
}

function buildUrl(endpoint, params) {
  const url = new URL(`${RENTCAST_BASE}/${endpoint}`);
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  return url.toString();
}

// Returns { ok, status, data, error, durationMs }. Never throws for HTTP or
// network errors, so the orchestrator can return partial results.
async function rentcastGet({ endpoint, params, apiKey, fetchImpl, timeoutMs = 8000 }) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (fetchImpl || fetch)(buildUrl(endpoint, params), {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
      signal: controller.signal,
    });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? data : null,
      error: res.ok ? null : ((data && (data.message || data.error)) || `HTTP ${res.status}`),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return { ok: false, status: timedOut ? 504 : 0, data: null, error: timedOut ? 'timeout' : 'network error', durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(status) {
  return status === 429 || status >= 500 || status === 0;
}

module.exports = { RENTCAST_BASE, buildUrl, rentcastGet, isRetryable, loadFixture, shiftDates, FIXTURE_FILES, FIXTURE_ANCHOR };
