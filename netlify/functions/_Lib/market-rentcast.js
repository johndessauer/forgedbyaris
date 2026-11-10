// netlify/functions/_Lib/market-rentcast.js
//
// Neighborhood / market radius comps for Market Oracle. Uses the same
// RentCast client, cache keys, monthly budget cap, and a simplified
// arm's-length / outlier screen (the full comp-engine needs a subject
// property; here we only need a market summary).
//
// RentCast is only called when a member is authenticated and a live key
// is present, so this unauthenticated-looking endpoint cannot burn the
// budget on its own.

const core = require('./comps-core');
const { rentcastGet, isRetryable, loadFixture } = require('./rentcast-client');

const CALL_TIMEOUT_MS = 8000;
const MIN_SALE_PRICE = 10000;
const MAX_SALE_PRICE = 2000000;
const MIN_RENT = 200;
const MAX_RENT = 20000;

function pricingFromEnv(env) {
  const plan = String((env && env.COMPS_PLAN) || 'developer').toLowerCase();
  const base = { ...core.planPricing(plan) };
  const num = (v) => (v === undefined || v === null || String(v).trim() === '' ? NaN : Number(v));
  const fee = num(env && env.COMPS_BASE_FEE_USD);
  const inc = num(env && env.COMPS_INCLUDED_REQUESTS);
  const ovg = num(env && env.COMPS_OVERAGE_USD);
  if (Number.isFinite(fee) && fee >= 0) base.baseFee = fee;
  if (Number.isFinite(inc) && inc >= 0) base.included = Math.floor(inc);
  if (Number.isFinite(ovg) && ovg >= 0) base.overage = ovg;
  return { plan, pricing: base };
}

function compsConfig(env) {
  const { plan, pricing } = pricingFromEnv(env || {});
  const cap = Number(env && env.COMPS_MONTHLY_CAP_USD);
  const days = Number(env && env.COMPS_CACHE_DAYS);
  const mode = !(env && env.RENTCAST_API_KEY) && !(env && env.RENTCAST_MOCK)
    ? 'demo'
    : ((env && env.RENTCAST_MOCK) ? 'mock' : 'live');
  return {
    mode,
    plan,
    pricing,
    cap: Number.isFinite(cap) && env.COMPS_MONTHLY_CAP_USD !== '' && env.COMPS_MONTHLY_CAP_USD !== undefined ? cap : 100,
    cacheDays: Number.isFinite(days) && days > 0 ? days : 30,
  };
}

function median(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function filterSales(recs) {
  const raw = Array.isArray(recs) ? recs : [];
  const prices = [];
  const kept = [];
  let discarded = 0;
  for (const r of raw) {
    const price = r.lastSalePrice != null ? Number(r.lastSalePrice) : null;
    const typ = r.propertyType || '';
    if (!price || price < MIN_SALE_PRICE || price > MAX_SALE_PRICE || /land/i.test(typ)) {
      discarded += 1;
      continue;
    }
    prices.push(price);
    kept.push(r);
  }
  const med = median(prices);
  const screened = [];
  for (const r of kept) {
    const price = Number(r.lastSalePrice);
    if (med && (price > 4 * med || price < 0.25 * med)) {
      discarded += 1;
      continue;
    }
    screened.push(r);
  }
  const finalPrices = screened.map((r) => Number(r.lastSalePrice));
  const sqfts = screened.map((r) => r.squareFootage).filter((s) => s > 0);
  const ppsf = screened
    .filter((r) => r.squareFootage > 0 && r.lastSalePrice)
    .map((r) => r.lastSalePrice / r.squareFootage);
  const zips = {};
  for (const r of screened) {
    const z = r.zipCode || 'unknown';
    zips[z] = (zips[z] || 0) + 1;
  }
  const sample = screened.slice(0, 6).map((r) => ({
    address: r.formattedAddress || r.addressLine1 || null,
    zip: r.zipCode || null,
    type: r.propertyType || null,
    beds: r.bedrooms != null ? r.bedrooms : null,
    sqft: r.squareFootage || null,
    yearBuilt: r.yearBuilt || null,
    lastSalePrice: r.lastSalePrice,
    lastSaleDate: r.lastSaleDate || null,
  }));
  return {
    pulled: raw.length,
    counted: screened.length,
    discardedOutliers: discarded,
    medianSalePrice: median(finalPrices),
    minSalePrice: finalPrices.length ? Math.min(...finalPrices) : null,
    maxSalePrice: finalPrices.length ? Math.max(...finalPrices) : null,
    medianSqft: median(sqfts),
    medianPpsf: median(ppsf) != null ? Math.round(median(ppsf)) : null,
    zipBreakdown: zips,
    sample,
  };
}

function filterRentals(recs) {
  const raw = Array.isArray(recs) ? recs : [];
  const kept = [];
  let discarded = 0;
  for (const r of raw) {
    const price = r.price != null ? Number(r.price) : (r.rent != null ? Number(r.rent) : null);
    if (!price || price < MIN_RENT || price > MAX_RENT) {
      discarded += 1;
      continue;
    }
    kept.push({ ...r, _rent: price });
  }
  const prices = kept.map((r) => r._rent);
  const med = median(prices);
  const screened = kept.filter((r) => !med || (r._rent <= 4 * med && r._rent >= 0.25 * med));
  discarded += kept.length - screened.length;
  const finalPrices = screened.map((r) => r._rent);
  const sample = screened.slice(0, 6).map((r) => ({
    address: r.formattedAddress || r.addressLine1 || null,
    zip: r.zipCode || null,
    type: r.propertyType || null,
    beds: r.bedrooms != null ? r.bedrooms : null,
    sqft: r.squareFootage || null,
    rent: r._rent,
    daysOnMarket: r.daysOnMarket != null ? r.daysOnMarket : null,
  }));
  return {
    pulled: raw.length,
    counted: screened.length,
    discardedOutliers: discarded,
    medianRent: median(finalPrices),
    minRent: finalPrices.length ? Math.min(...finalPrices) : null,
    maxRent: finalPrices.length ? Math.max(...finalPrices) : null,
    sample,
  };
}

async function cachedGet(spec, ctx) {
  const { store, cfg, env, memberId, now, fetchImpl, mockResponse } = ctx;
  const { endpoint, fixtureId, params, normAddress } = spec;
  const keyParams = { ...params };
  const key = core.cacheKey((cfg.mode === 'mock' ? 'mock:' : '') + endpoint, normAddress, keyParams);

  if (cfg.mode === 'demo') {
    return { ok: true, data: loadFixture(fixtureId, now()), cached: false, fetchedAt: now().toISOString(), key: null, status: 200 };
  }

  const hit = await store.getCache(key, now());
  if (hit) {
    try {
      await store.logCall({
        memberstack_id: memberId, created_at: now().toISOString(),
        endpoint, cache_hit: true, cost_usd: 0, http_status: 200, key,
        address_hash: core.addressHash(normAddress),
      });
    } catch (e) { /* logging is non-fatal */ }
    return { ok: true, data: hit.response, cached: true, fetchedAt: hit.fetched_at, key, status: 200 };
  }

  let reservation;
  try {
    reservation = await store.reserveCall({
      month: core.monthKey(now()), cap: cfg.cap,
      baseFee: cfg.pricing.baseFee, included: cfg.pricing.included, overage: cfg.pricing.overage,
    });
  } catch (e) {
    return { ok: false, status: 503, error: 'budget_check_failed' };
  }
  if (!reservation.allowed) {
    try {
      await store.logCall({
        memberstack_id: memberId, created_at: now().toISOString(),
        endpoint, cache_hit: false, cost_usd: 0, http_status: 402, key,
        address_hash: core.addressHash(normAddress),
      });
    } catch (e) { /* non-fatal */ }
    return { ok: false, status: 402, error: 'budget_cap' };
  }

  let result;
  if (cfg.mode === 'mock') {
    const mocked = mockResponse ? mockResponse(fixtureId, params) : null;
    result = mocked || { ok: true, status: 200, data: loadFixture(fixtureId, now()) };
  } else {
    result = await rentcastGet({ endpoint, params, apiKey: env.RENTCAST_API_KEY, fetchImpl, timeoutMs: CALL_TIMEOUT_MS });
    if (!result.ok && isRetryable(result.status)) {
      await new Promise((r) => setTimeout(r, 400));
      result = await rentcastGet({ endpoint, params, apiKey: env.RENTCAST_API_KEY, fetchImpl, timeoutMs: CALL_TIMEOUT_MS });
    }
  }

  if (!result.ok) {
    try { await store.releaseCall({ month: core.monthKey(now()), cost: reservation.cost }); } catch (e) { /* non-fatal */ }
    try {
      await store.logCall({
        memberstack_id: memberId, created_at: now().toISOString(),
        endpoint, cache_hit: false, cost_usd: 0, http_status: result.status, key,
        address_hash: core.addressHash(normAddress),
      });
    } catch (e) { /* non-fatal */ }
    return { ok: false, status: result.status, error: result.error };
  }

  const fetchedAt = now().toISOString();
  try {
    await store.logCall({
      memberstack_id: memberId, created_at: now().toISOString(),
      endpoint, cache_hit: false, cost_usd: reservation.cost, http_status: result.status, key,
      address_hash: core.addressHash(normAddress),
    });
  } catch (e) { /* non-fatal */ }
  try {
    await store.putCache({
      key, endpoint, norm_address: normAddress, params, response: result.data,
      fetched_at: fetchedAt,
      expires_at: new Date(now().getTime() + cfg.cacheDays * 86400000).toISOString(),
    });
  } catch (e) { /* cache write is non-fatal */ }
  return { ok: true, data: result.data, cached: false, fetchedAt, key, status: result.status };
}

async function loadRadiusComps(geography, deps) {
  const lat = geography && geography.lat;
  const lng = geography && geography.lng;
  const radius = (geography && geography.radiusMiles) || 0.5;
  if (lat == null || lng == null) {
    return { status: 'skipped', reason: 'no_centroid', message: 'No map point available for a radius comps pull.' };
  }
  if (!(deps && deps.memberId)) {
    return { status: 'skipped', reason: 'not_authenticated', message: 'Sign in to load recent sale and rental comps for this area.' };
  }
  const env = deps.env || {};
  const cfg = compsConfig(env);
  if (cfg.mode === 'live' && !(deps.store)) {
    return { status: 'skipped', reason: 'store_unavailable', message: 'Comps cache is not available right now.' };
  }
  // Demo mode (no key) still returns fixture-shaped summaries so the UI can
  // be exercised, clearly labeled as demo.
  const store = deps.store;
  if (cfg.mode !== 'demo' && !store) {
    return { status: 'skipped', reason: 'store_unavailable', message: 'Comps cache is not available right now.' };
  }
  const now = deps.now || (() => new Date());
  const ctx = {
    store: store || { getCache: async () => null, putCache: async () => {}, reserveCall: async () => ({ allowed: true, cost: 0 }), releaseCall: async () => {}, logCall: async () => {} },
    cfg,
    env,
    memberId: deps.memberId,
    now,
    fetchImpl: deps.fetch,
    mockResponse: deps.mockResponse,
  };
  const normAddress = `RADIUS ${lat.toFixed(5)},${lng.toFixed(5)} r${radius}`;
  const params = {
    latitude: Number(lat).toFixed(6),
    longitude: Number(lng).toFixed(6),
    radius,
    limit: 50,
  };

  const [soldRes, rentRes] = await Promise.all([
    cachedGet({
      endpoint: 'properties',
      fixtureId: 'properties:sold',
      params: { ...params, saleDateRange: 365 },
      normAddress,
    }, ctx),
    cachedGet({
      endpoint: 'listings/rental/long-term',
      fixtureId: 'listings/rental/long-term',
      params,
      normAddress,
    }, ctx),
  ]);

  const errors = [];
  if (!soldRes.ok) errors.push(soldRes.error || 'sold_unavailable');
  if (!rentRes.ok) errors.push(rentRes.error || 'rentals_unavailable');
  if (!soldRes.ok && !rentRes.ok) {
    const reason = soldRes.error === 'budget_cap' || rentRes.error === 'budget_cap' ? 'budget_cap' : 'rentcast_unavailable';
    return {
      status: reason,
      radiusMiles: radius,
      message: reason === 'budget_cap'
        ? 'The monthly comps budget has been reached, so live sale/rental comps were not pulled.'
        : 'Live comps were not available for this area.',
    };
  }

  const sold = soldRes.ok ? filterSales(soldRes.data) : null;
  const rentals = rentRes.ok ? filterRentals(rentRes.data) : null;
  return {
    status: cfg.mode === 'live' ? 'ok' : 'demo',
    radiusMiles: radius,
    lookbackDays: 365,
    cached: !!(soldRes.cached && (rentRes.ok ? rentRes.cached : true)),
    sold,
    rentals,
    errors: errors.length ? errors : undefined,
    note: `Recorded sales within ${radius} mile and 365 days of the area center, after dropping land, sub-$10k / over-$2M prices, and extreme outliers. This circle can overlap adjacent neighborhoods.`,
  };
}

module.exports = {
  compsConfig,
  filterSales,
  filterRentals,
  median,
  loadRadiusComps,
  MIN_SALE_PRICE,
  MAX_SALE_PRICE,
};
