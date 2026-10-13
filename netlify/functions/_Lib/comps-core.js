// netlify/functions/_Lib/comps-core.js
//
// Pure helpers for the RentCast comping engine: address normalization,
// cache keys, plan pricing and budget math. No I/O, so it is unit-tested
// directly (tests/comps-core.test.js) and shared by rentcast-comps.js.

const crypto = require('crypto');

// RentCast plans, confirmed in the dashboard Oct 12, 2026 (Build Brief §2).
// baseFee is charged once per month; calls beyond `included` cost `overage`.
const PLAN_PRICING = Object.freeze({
  developer:  { baseFee: 0,   included: 50,    overage: 0.20 },
  foundation: { baseFee: 74,  included: 1000,  overage: 0.06 },
  growth:     { baseFee: 199, included: 5000,  overage: 0.03 },
  scale:      { baseFee: 449, included: 25000, overage: 0.015 },
});

function planPricing(planName) {
  return PLAN_PRICING[String(planName || '').toLowerCase()] || PLAN_PRICING.developer;
}

// Cost of the next call given how many calls this month already happened.
// Mirrors the SQL in reserve_rentcast_call() — keep the two in step.
function nextCallCost(planName, callsSoFar) {
  const p = planPricing(planName);
  return callsSoFar >= p.included ? p.overage : 0;
}

// Total spend for N calls in a month, base fee included.
function monthSpend(planName, calls) {
  const p = planPricing(planName);
  return round2(p.baseFee + Math.max(0, calls - p.included) * p.overage);
}

function round2(x) { return Math.round(x * 100) / 100; }

// 'YYYY-MM' in UTC.
function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return d.toISOString().slice(0, 7);
}

// Which alert thresholds a spend/calls level has crossed (brief §5.2).
function thresholdsCrossed({ spend, cap, calls }) {
  return {
    pct80: cap > 0 && spend >= 0.8 * cap,
    pct100: cap > 0 && spend >= cap,
    calls1000: calls >= 1000,
  };
}

// ── Address normalization (brief §5.2.1) ──────────────────────────────────
// Uppercase, collapse whitespace, standardize suffixes, strip unit
// punctuation, 5-digit zip. "123 Main St." and "123 MAIN STREET" normalize
// to the same string, so they share one cache entry.
const SUFFIXES = {
  STREET: 'ST', STR: 'ST', 'ST.': 'ST',
  AVENUE: 'AVE', AV: 'AVE', AVEN: 'AVE',
  DRIVE: 'DR', DRV: 'DR',
  ROAD: 'RD',
  LANE: 'LN',
  COURT: 'CT', CRT: 'CT',
  BOULEVARD: 'BLVD', BOUL: 'BLVD', BLV: 'BLVD',
  PLACE: 'PL', TERRACE: 'TER', CIRCLE: 'CIR', PARKWAY: 'PKWY', HIGHWAY: 'HWY',
};
const DIRECTIONS = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const UNIT_WORDS = { APARTMENT: 'APT', APT: 'APT', UNIT: 'UNIT', SUITE: 'STE', STE: 'STE', '#': 'UNIT' };

function normalizeAddress(input) {
  if (!input) return '';
  let s = String(input).toUpperCase();
  s = s.replace(/(\d{5})-\d{4}\b/g, '$1');          // ZIP+4 → 5-digit zip
  s = s.replace(/#\s*/g, ' UNIT ');                  // "#4B" → "UNIT 4B"
  s = s.replace(/[.]/g, '');                          // "St." → "ST"
  s = s.replace(/\s*,\s*/g, ', ');                    // tidy commas
  s = s.replace(/\s+/g, ' ').trim();

  // Normalize word by word inside each comma-separated part.
  const parts = s.split(', ').map(part => part.split(' ').map((w, i, arr) => {
    if (SUFFIXES[w]) return SUFFIXES[w];
    if (DIRECTIONS[w]) return DIRECTIONS[w];
    if (UNIT_WORDS[w] && i < arr.length - 1) return UNIT_WORDS[w];
    return w.replace(/[^A-Z0-9-]/g, '');
  }).filter(Boolean).join(' '));

  // Drop a trailing country.
  if (parts.length && /^(USA|US|UNITED STATES)$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(', ');
}

function zipFromAddress(input) {
  const m = String(input || '').match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  return m ? m[1] : null;
}

function sortedParams(params) {
  const out = {};
  Object.keys(params || {}).sort().forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') out[k] = typeof v === 'number' ? v : String(v);
  });
  return out;
}

// sha256(endpoint + normalizedAddress + sortedParams). Lat/lng are rounded
// to 5 decimals (~1 m) so float noise never splits the cache.
function cacheKey(endpoint, normAddress, params) {
  const p = { ...(params || {}) };
  ['latitude', 'longitude'].forEach(k => { if (p[k] !== undefined && p[k] !== null && p[k] !== '') p[k] = Number(Number(p[k]).toFixed(5)); });
  const material = `${endpoint}|${normAddress || ''}|${JSON.stringify(sortedParams(p))}`;
  return crypto.createHash('sha256').update(material).digest('hex');
}

function addressHash(normAddress) {
  return crypto.createHash('sha256').update(String(normAddress || '')).digest('hex').slice(0, 16);
}

module.exports = {
  PLAN_PRICING, planPricing, nextCallCost, monthSpend, monthKey, thresholdsCrossed,
  normalizeAddress, zipFromAddress, sortedParams, cacheKey, addressHash,
};
