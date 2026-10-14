// netlify/functions/rentcast-comps.js
//
// FORGE Comping Engine backend — RentCast-powered comps, ARV, rent, market.
// Mirrors property-search.js: preflight → verifyMember → action switch,
// wrapped in try/catch, returning json().
//
// ── Modes ────────────────────────────────────────────────────────────────
//   live     RENTCAST_API_KEY set, RENTCAST_MOCK not set. Real calls, behind
//            cache + budget + logging.
//   mock     RENTCAST_MOCK=1. Fixtures from __fixtures__/rentcast served
//            THROUGH the full cache/budget/log pipeline, for development and
//            tests. Cache keys are prefixed "mock:" so they never mix with
//            real data. Responses carry demo: true.
//   demo     No RENTCAST_API_KEY. Fixtures served directly; cache, budget and
//            call log are NOT touched (so demo traffic can never use up the
//            free allowance). Responses carry demo: true.
//
// ── Cost rules (Simon, brief §5.2) ───────────────────────────────────────
//   - Every response is cached for COMPS_CACHE_DAYS (default 30), shared
//     across members. Cache hits cost $0. "Refresh" is the only bypass.
//   - Before every live call, reserve_rentcast_call() does an atomic
//     check-and-reserve against COMPS_MONTHLY_CAP_USD (default 100, all-in,
//     plan base fee included). Refused → 402 { error: 'budget_cap' }.
//     If the budget check itself errors → fail closed, no RentCast call.
//   - Errors are not billed by RentCast: the reservation is released, but
//     the call is still logged.
//   - Alerts at 80%, 100% and 1,000 calls, once each per month.
//
// ── One wide pull instead of many small ones ─────────────────────────────
// RentCast bills one call per request regardless of response size. So the
// sold-comps pull asks for a 2 mi / 365-day radius (limit 500) once, and
// the client filters down to the 1 mi / 90-day default. Expansion steps up
// to 2 mi and 365 days are then free; only going past that costs a lookup.
//
// ── Routes ───────────────────────────────────────────────────────────────
//   POST { action:'comp', address, overrides?, refresh? }        up to 3 calls
//   POST { action:'rent', reportId }                              1 call (lazy)
//   POST { action:'market', reportId }                            1 call (lazy)
//   POST { action:'expand', reportId, radius, soldWithinDays }    1 call
//   POST { action:'update', reportId, selection }                 0 calls
//   POST { action:'share', reportId } / { action:'revoke', reportId }
//   POST { action:'best-use', reportId, equity?, refresh? }        0 lookups (1 ARIS call, cached)
//   POST { action:'save-crm', ... }                               Phase 4 (501)
//   GET  ?action=listings&reportId=&type=sale|rental              1 call
//   GET  ?action=report&token=        PUBLIC, read-only, never calls RentCast
//   GET  ?action=usage                admin only
//   GET  ?action=budget               remaining budget for the UI
//
// ── Field verification log ───────────────────────────────────────────────
// Oct 12, 2026: field names taken from RentCast's documented example
// responses (property-data, property-valuation, market-data pages). NOT yet
// confirmed against a live FORGE call. Phase 5 replaces this line with what
// the first live responses actually returned, dated.

const crypto = require('crypto');
const { json, preflight } = require('./_Lib/http');
const core = require('./_Lib/comps-core');
const engine = require('../../assets/js/comp-engine');
const { rentcastGet, isRetryable, loadFixture } = require('./_Lib/rentcast-client');
const { sendAlert } = require('./_Lib/comps-alerts');
const { hasCompsAccess } = require('./_Lib/plans');
const bestUse = require('./_Lib/comps-best-use');

// Same admin allowlist as education-admin.js / lab-admin.js, plus any
// extra addresses in COMPS_ADMIN_EMAILS (e.g. Simon) for the usage view.
const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];

// The wide sold-comps pull (see header).
const PULL = Object.freeze({ radius: 2, soldWithinDays: 365, limit: 500 });
const MAX_EXPAND_RADIUS = 5;
const PHASE_ONE_DEADLINE_MS = 20000; // function timeout is raised to 26s in netlify.toml (default would be ~10s)
const CALL_TIMEOUT_MS = 8000;

class HttpError extends Error {
  constructor(statusCode, body) { super(body && body.error); this.statusCode = statusCode; this.body = body; }
}

// Plan pricing comes from COMPS_PLAN; any of COMPS_BASE_FEE_USD,
// COMPS_INCLUDED_REQUESTS, COMPS_OVERAGE_USD override one field, so a plan
// upgrade (or a RentCast price change) is a Netlify env change, not a deploy.
function pricingFromEnv(plan, env) {
  const base = { ...core.planPricing(plan) };
  const num = (v) => (v === undefined || v === null || String(v).trim() === '' ? NaN : Number(v));
  const fee = num(env.COMPS_BASE_FEE_USD), inc = num(env.COMPS_INCLUDED_REQUESTS), ovg = num(env.COMPS_OVERAGE_USD);
  if (Number.isFinite(fee) && fee >= 0) base.baseFee = fee;
  if (Number.isFinite(inc) && inc >= 0) base.included = Math.floor(inc);
  if (Number.isFinite(ovg) && ovg >= 0) base.overage = ovg;
  return base;
}

function config(env) {
  const plan = String(env.COMPS_PLAN || 'developer').toLowerCase();
  const cap = Number(env.COMPS_MONTHLY_CAP_USD);
  const days = Number(env.COMPS_CACHE_DAYS);
  const limit = Number(env.COMPS_MEMBER_MONTHLY_LIMIT);
  const mode = !env.RENTCAST_API_KEY && !env.RENTCAST_MOCK ? 'demo' : (env.RENTCAST_MOCK ? 'mock' : 'live');
  return {
    mode,
    plan,
    pricing: pricingFromEnv(plan, env),
    cap: Number.isFinite(cap) && env.COMPS_MONTHLY_CAP_USD !== '' && env.COMPS_MONTHLY_CAP_USD !== undefined ? cap : 100,
    cacheDays: Number.isFinite(days) && days > 0 ? days : 30,
    memberLimit: Number.isFinite(limit) && limit > 0 ? limit : null,   // blank/0 = no per-member limit
    adminEmails: ADMIN_EMAILS.concat(String(env.COMPS_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch layer: cache → member limit → budget → RentCast (or fixture) → log
// ─────────────────────────────────────────────────────────────────────────
function makeFetcher(ctx) {
  const { store, cfg, env, memberId, now, deps } = ctx;
  // Per-member monthly limit (COMPS_MEMBER_MONTHLY_LIMIT; blank = off).
  // The member's count is read once per request and shared by the parallel
  // sections; each live call takes a slot synchronously, so three parallel
  // sections can never overshoot the limit together.
  let memberCountPromise = null;
  let slotsTaken = 0;
  const alertsToSend = new Set();

  async function takeMemberSlot() {
    if (!cfg.memberLimit) return true;
    if (!memberCountPromise) {
      const monthStart = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1)).toISOString();
      memberCountPromise = store.countMemberLiveCalls(memberId, monthStart);
    }
    const used = await memberCountPromise;
    if (used + slotsTaken >= cfg.memberLimit) return false;
    slotsTaken += 1;
    return true;
  }
  const giveBackSlot = () => { if (cfg.memberLimit && slotsTaken > 0) slotsTaken -= 1; };

  async function log(row) {
    try { await store.logCall({ memberstack_id: memberId, created_at: now().toISOString(), ...row }); }
    catch (e) { console.error('rentcast-comps: call log write failed', e && e.message); }
  }

  // spec: { section, endpoint, fixtureId, params, normAddress, refresh }
  // Returns { ok, data, cached, fetchedAt, key, status, error }
  async function fetchSection(spec) {
    const { section, endpoint, fixtureId, params, normAddress, refresh } = spec;
    const addrHash = core.addressHash(normAddress);

    if (cfg.mode === 'demo') {
      return { ok: true, data: loadFixture(fixtureId, now()), cached: false, fetchedAt: now().toISOString(), key: null, status: 200 };
    }

    // The raw address is left out of the key (the normalized address is
    // already in it), so "123 Main St." and "123 MAIN STREET" share a row.
    const keyParams = { ...params };
    delete keyParams.address;
    const key = core.cacheKey((cfg.mode === 'mock' ? 'mock:' : '') + endpoint + (fixtureId.includes(':') ? '#' + fixtureId.split(':')[1] : ''), normAddress, keyParams);

    if (!refresh) {
      const hit = await store.getCache(key, now());
      if (hit) {
        await log({ endpoint, cache_hit: true, cost_usd: 0, http_status: 200, key, address_hash: addrHash });
        return { ok: true, data: hit.response, cached: true, fetchedAt: hit.fetched_at, key, status: 200 };
      }
    }

    if (!(await takeMemberSlot())) {
      return { ok: false, status: 429, error: 'member_limit', section };
    }

    // Fail closed: if the reservation errors, no RentCast call is made.
    let reservation;
    try {
      reservation = await store.reserveCall({
        month: core.monthKey(now()), cap: cfg.cap,
        baseFee: cfg.pricing.baseFee, included: cfg.pricing.included, overage: cfg.pricing.overage,
      });
    } catch (e) {
      console.error('rentcast-comps: budget check failed — failing closed', e && e.message);
      giveBackSlot();
      return { ok: false, status: 503, error: 'budget_check_failed', section };
    }
    if (reservation.alert80) alertsToSend.add('pct80');
    if (reservation.alert100) alertsToSend.add('pct100');
    if (reservation.alert1000) alertsToSend.add('calls1000');
    if (!reservation.allowed) {
      giveBackSlot();
      await log({ endpoint, cache_hit: false, cost_usd: 0, http_status: 402, key, address_hash: addrHash });
      return { ok: false, status: 402, error: 'budget_cap', section };
    }
    let result;
    if (cfg.mode === 'mock') {
      const mocked = deps.mockResponse ? deps.mockResponse(fixtureId, params) : null;
      result = mocked || { ok: true, status: 200, data: loadFixture(fixtureId, now()) };
    } else {
      result = await rentcastGet({ endpoint, params, apiKey: env.RENTCAST_API_KEY, fetchImpl: deps.fetch, timeoutMs: CALL_TIMEOUT_MS });
      // One retry on 429/5xx, only because the budget is already reserved,
      // and only if there is time left before the function deadline.
      if (!result.ok && isRetryable(result.status) && (Date.now() - ctx.startedAt) < PHASE_ONE_DEADLINE_MS - CALL_TIMEOUT_MS / 2) {
        await new Promise(r => setTimeout(r, 400));
        result = await rentcastGet({ endpoint, params, apiKey: env.RENTCAST_API_KEY, fetchImpl: deps.fetch, timeoutMs: Math.max(1000, PHASE_ONE_DEADLINE_MS - (Date.now() - ctx.startedAt)) });
      }
    }

    if (!result.ok) {
      giveBackSlot();
      // RentCast does not bill errors — give the reservation back.
      try { await store.releaseCall({ month: core.monthKey(now()), cost: reservation.cost }); }
      catch (e) { console.error('rentcast-comps: release failed', e && e.message); }
      await log({ endpoint, cache_hit: false, cost_usd: 0, http_status: result.status, key, address_hash: addrHash });
      return { ok: false, status: result.status, error: result.error, section };
    }

    await log({ endpoint, cache_hit: false, cost_usd: reservation.cost, http_status: result.status, key, address_hash: addrHash });
    const fetchedAt = now().toISOString();
    try {
      await store.putCache({
        key, endpoint, norm_address: normAddress, params, response: result.data,
        fetched_at: fetchedAt,
        expires_at: new Date(now().getTime() + cfg.cacheDays * 86400000).toISOString(),
      });
    } catch (e) { console.error('rentcast-comps: cache write failed', e && e.message); }
    return { ok: true, data: result.data, cached: false, fetchedAt, key, status: result.status };
  }

  // Alerts raised by reservations during this request; the handler sends
  // them once, after the sections settle.
  fetchSection.alerts = alertsToSend;
  return fetchSection;
}

async function flushAlerts(fetcherCtx, kinds) {
  for (const kind of kinds) {
    try { await sendAlert(kind, { env: fetcherCtx.env, fetchImpl: fetcherCtx.deps.fetch }); }
    catch (e) { console.error('rentcast-comps: alert failed', kind, e && e.message); }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Report assembly
// ─────────────────────────────────────────────────────────────────────────
function firstRecord(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function propertySection(rec) {
  if (!rec) return null;
  return {
    owner: rec.owner || null,
    ownerOccupied: rec.ownerOccupied === undefined ? null : rec.ownerOccupied,
    taxAssessments: rec.taxAssessments || null,
    propertyTaxes: rec.propertyTaxes || null,
    history: rec.history || null,
    features: rec.features || null,
    lastSalePrice: rec.lastSalePrice || null,
    lastSaleDate: rec.lastSaleDate || null,
  };
}

function assemble({ subjectRec, soldData, valueData, overrides, normAddress, selection, asOf }) {
  const avmSubject = valueData && valueData.subjectProperty;
  const subject = engine.subjectFromRecord(subjectRec || avmSubject || null, overrides);
  if (!subject.address) subject.address = (overrides && overrides.address) || null;
  // Where each fact came from, so the member can tell a lead's number from
  // the public record: 'lead' (PropertyRadar / typed in), 'record' (public
  // record), 'forgecast' (FORGE Cast valuation's subject lookup).
  const baseSource = subjectRec ? 'record' : (avmSubject ? 'forgecast' : null);
  const o = overrides || {};
  subject.factSources = {};
  ['beds', 'baths', 'sqft', 'yearBuilt', 'propertyType'].forEach(k => {
    const has = o[k] !== undefined && o[k] !== null && o[k] !== '';
    subject.factSources[k] = has ? 'lead' : (subject[k] !== null && subject[k] !== undefined ? baseSource : null);
  });
  // Public-record facts kept separately when a lead's numbers override them.
  if (subjectRec) {
    subject.recordFacts = { beds: subjectRec.bedrooms ?? null, baths: subjectRec.bathrooms ?? null, sqft: subjectRec.squareFootage ?? null, yearBuilt: subjectRec.yearBuilt ?? null };
  }

  const recorded = (Array.isArray(soldData) ? soldData : [])
    .filter(r => core.normalizeAddress(r.formattedAddress) !== normAddress)   // never comp the subject against itself
    .map(r => engine.fromPropertyRecord(r, subject));
  const listings = ((valueData && valueData.comparables) || []).map(engine.fromAvmComparable);
  const comps = engine.mergeComps(recorded, listings);

  const sel = selection || {};
  const report = engine.buildReport({
    subject, comps,
    filters: sel.filters, ladder: sel.ladder, adjustments: sel.adjustments, manual: sel.manual,
    asOf, pulled: sel.pulled || { radius: PULL.radius, soldWithinDays: PULL.soldWithinDays, listings: true },
  });

  const leadOverrides = {};
  ['beds', 'baths', 'sqft', 'yearBuilt', 'propertyType', 'lat', 'lng'].forEach(k => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') leadOverrides[k] = o[k]; });
  return {
    subject,
    leadOverrides,
    comps,
    avm: valueData ? { price: valueData.price ?? null, low: valueData.priceRangeLow ?? null, high: valueData.priceRangeHigh ?? null } : null,
    report,
  };
}

function reportRow(memberId, normAddress, built, sources, selection, property) {
  return {
    memberstack_id: memberId,
    norm_address: normAddress,
    subject: { ...built.subject, property, leadOverrides: built.leadOverrides || null },
    selection: selection || {},
    sources,
    arv: built.report.arv,
    arv_low: built.report.arvLow,
    arv_high: built.report.arvHigh,
    avm: built.avm ? built.avm.price : null,
    comp_count: built.report.compCount,
    confidence: built.report.confidence,
  };
}

// Strip owner, tax and history data for share links (brief §3.4).
function publicSnapshot(row, built) {
  const subject = { ...(row.subject || {}) };
  delete subject.property;
  return {
    address: subject.address,
    subject,
    avm: built ? built.avm : (row.avm ? { price: Number(row.avm) } : null),
    report: built ? built.report : null,
    rent: row.rent === null || row.rent === undefined ? null : Number(row.rent),
    // Best use is computed from numbers only (no owner data) — safe to share.
    bestUse: row.best_use && row.best_use.result ? row.best_use.result : null,
    createdAt: row.created_at || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Handler factory (deps injected so tests run without network or Supabase)
// ─────────────────────────────────────────────────────────────────────────
function createHandler(deps) {
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    const env = deps.env || process.env;
    const cfg = config(env);
    const now = deps.now || (() => new Date());
    const startedAt = Date.now();

    try {
      const isGet = event.httpMethod === 'GET';
      const isPost = event.httpMethod === 'POST';
      if (!isGet && !isPost) return json(405, { error: 'Method not allowed' });
      const q = event.queryStringParameters || {};
      let body = {};
      if (isPost) { try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid JSON body' }); } }
      const action = isGet ? q.action : body.action;

      // ── PUBLIC: shared read-only report. Never calls RentCast. ─────────
      if (isGet && action === 'report') {
        if (!q.token) return json(400, { error: 'token is required' });
        const row = await deps.store.getReportByToken(q.token);
        if (!row || !row.snapshot) return json(404, { error: 'report_not_found' });
        return json(200, { shared: true, report: row.snapshot });
      }

      // ── Everything else: verified member, Empire (not FORGE Zero) ───────
      let memberId;
      try { memberId = await deps.verifyMember(event); }
      catch (e) { return json(e.statusCode || 401, { error: 'session_expired', message: e.message }); }

      const member = await deps.getMember(memberId);
      const email = String((member && member.auth && member.auth.email) || '').toLowerCase();
      const isAdmin = cfg.adminEmails.includes(email);

      if (isGet && action === 'usage') {
        if (!isAdmin) return json(403, { error: 'admin_only' });
        return json(200, await usage(deps.store, cfg, now()));
      }

      // Admins pass the tier gate so John can test while the panel is
      // admin-only (Phase 2–4) — his own account may be on FORGE Zero.
      if (!isAdmin && !hasCompsAccess(member && member.planConnections)) {
        return json(403, { error: 'not_empire', message: 'Comp lookups are an Empire feature.' });
      }

      const ctx = { store: deps.store, cfg, env, memberId, now, deps, startedAt };
      const fetchSection = makeFetcher(ctx);

      // Every route that can call RentCast sends any alerts its reservations
      // raised, once, after the work is done.
      const run = async (fn) => {
        try { return await fn(); }
        finally { if (fetchSection.alerts.size) await flushAlerts(ctx, fetchSection.alerts); }
      };

      if (isGet && action === 'budget') {
        return json(200, await budgetView(deps.store, cfg, now()));
      }

      if (isPost && action === 'comp') return await run(() => compAction(ctx, fetchSection, body));
      if (isPost && (action === 'rent' || action === 'market')) return await run(() => lazySection(ctx, fetchSection, body, action));
      if (isPost && action === 'expand') return await run(() => expandAction(ctx, fetchSection, body));
      if (isGet && action === 'listings') return await run(() => listingsAction(ctx, fetchSection, q));
      if (isPost && action === 'update') return await updateAction(ctx, body);
      if (isPost && action === 'share') return await shareAction(ctx, body);
      if (isPost && action === 'revoke') return await revokeAction(ctx, body);
      if (isPost && action === 'best-use') return await bestUseAction(ctx, body);
      if (isPost && action === 'retry-record') return await run(() => retryRecordAction(ctx, fetchSection, body));
      if (isPost && action === 'link-crm') return await linkCrmAction(ctx, body);
      // GHL push (admin-only) stays off until John creates the GHL custom
      // fields (Build Brief §7.3) and sets GHL_COMPS_ENABLED=1.
      if (isPost && action === 'save-crm') {
        if (!isAdmin) return json(403, { error: 'admin_only' });
        return json(501, { error: 'ghl_not_configured', message: 'GoHighLevel push is off until its custom fields are set up.' });
      }

      return json(400, { error: 'Unknown action' });
    } catch (err) {
      if (err instanceof HttpError) return json(err.statusCode, err.body);
      console.error('rentcast-comps error:', err && err.message);
      return json(500, { error: 'Server error' });
    }
  };
}

// ── comp: subject + sold comps + value, in parallel ──────────────────────
async function compAction(ctx, fetchSection, body) {
  const address = String(body.address || '').trim();
  if (!address) return json(400, { error: 'address is required' });
  const normAddress = core.normalizeAddress(address);
  const overrides = { ...(body.overrides || {}), address };
  const refresh = body.refresh || null;   // 'subject' | 'sold' | 'value' — one section, 1 lookup

  const avmParams = { address, compCount: 25 };
  ['propertyType', 'bedrooms', 'bathrooms', 'squareFootage'].forEach(k => {
    const map = { bedrooms: 'beds', bathrooms: 'baths', squareFootage: 'sqft', propertyType: 'propertyType' };
    if (overrides[map[k]] !== undefined && overrides[map[k]] !== null && overrides[map[k]] !== '') avmParams[k] = overrides[map[k]];
  });

  const specs = [
    { section: 'subject', endpoint: 'properties', fixtureId: 'properties:subject', params: { address }, normAddress, refresh: refresh === 'subject' },
    { section: 'sold', endpoint: 'properties', fixtureId: 'properties:sold', params: { address, radius: PULL.radius, saleDateRange: PULL.soldWithinDays, limit: PULL.limit }, normAddress, refresh: refresh === 'sold' },
    { section: 'value', endpoint: 'avm/value', fixtureId: 'avm/value', params: avmParams, normAddress, refresh: refresh === 'value' },
  ];

  const settled = await Promise.allSettled(specs.map(fetchSection));
  const results = {};
  const sectionErrors = {};
  const noRecord = {};
  settled.forEach((s, i) => {
    const name = specs[i].section;
    if (s.status === 'rejected') {
      if (s.reason instanceof HttpError) throw s.reason;
      sectionErrors[name] = { status: 500, error: 'server_error' };
    } else if (!s.value.ok && name === 'subject' && s.value.status === 404) {
      // RentCast has no public-record entry for this address (common for new
      // construction / unrecorded parcels). Not a failure: AVM + sold comps
      // still work, and the UI says "no public record on file".
      noRecord.subject = true;
    } else if (!s.value.ok) {
      sectionErrors[name] = { status: s.value.status, error: s.value.error };
    } else {
      results[name] = s.value;
    }
  });

  if (!results.subject && !results.sold && !results.value) {
    const errs = Object.values(sectionErrors);
    if (noRecord.subject && !errs.length) return json(404, { error: 'address_not_found' });
    if (errs.some(e => e.error === 'budget_cap')) return json(402, { error: 'budget_cap', message: 'Comp lookups are paused for this month; cached reports still work.' });
    if (errs.some(e => e.error === 'member_limit')) return json(429, { error: 'member_limit', message: `Monthly comp lookup limit reached (${ctx.cfg.memberLimit}). Cached reports still work.` });
    if (errs.some(e => e.error === 'budget_check_failed')) return json(503, { error: 'budget_check_failed', message: 'Comp lookups are temporarily unavailable.' });
    if (errs.every(e => e.status === 404)) return json(404, { error: 'address_not_found' });
    if (errs.some(e => e.status === 429)) return json(429, { error: 'rate_limited' });
    return json(502, { error: 'rentcast_unavailable', sectionErrors });
  }

  const subjectRec = results.subject ? firstRecord(results.subject.data) : null;
  if (results.subject && !subjectRec && !results.value) return json(404, { error: 'address_not_found' });

  const asOf = ctx.now();
  const built = assemble({ subjectRec, soldData: results.sold && results.sold.data, valueData: results.value && results.value.data, overrides, normAddress, asOf });
  const sources = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.key]).filter(([, v]) => v));
  const property = propertySection(subjectRec);

  let reportId = null;
  if (ctx.cfg.mode !== 'demo') {
    const row = await ctx.store.insertReport(reportRow(ctx.memberId, normAddress, built, sources, {}, property));
    reportId = row.id;
  }

  const dates = Object.values(results).map(r => r.fetchedAt).filter(Boolean).sort();
  return json(200, {
    demo: ctx.cfg.mode !== 'live',
    reportId,
    address,
    normAddress,
    cached: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, !!v.cached])),
    dataAsOf: dates[0] || null,
    pulled: { radius: PULL.radius, soldWithinDays: PULL.soldWithinDays, listings: true },
    subject: built.subject,
    property,                 // owner/tax/history — only for the member who pulled it
    avm: built.avm,
    comps: built.comps,
    report: built.report,
    sectionErrors,
    crmDealId: null,
    shareToken: null,
    noPublicRecord: !!noRecord.subject,
    // FORGE Cast found the property under a different spelling: offer a
    // 1-lookup retry of the public-record search with that address.
    suggestedAddress: suggestedAddressFor(noRecord.subject, results.value && results.value.data, normAddress),
    budget: ctx.cfg.mode === 'demo' ? null : await budgetView(ctx.store, ctx.cfg, ctx.now()).catch(() => null),
  });
}

async function loadOwnReport(ctx, reportId) {
  if (!reportId) throw new HttpError(400, { error: 'reportId is required' });
  const row = await ctx.store.getReport(reportId, ctx.memberId);
  if (!row) throw new HttpError(404, { error: 'report_not_found' });
  return row;
}

// ── rent / market: fetched only when the member opens that tab ───────────
async function lazySection(ctx, fetchSection, body, which) {
  if (ctx.cfg.mode === 'demo') {
    const data = loadFixture(which === 'rent' ? 'avm/rent/long-term' : 'markets', ctx.now());
    return json(200, { demo: true, cached: false, [which]: data });
  }
  const row = await loadOwnReport(ctx, body.reportId);
  const address = row.subject && row.subject.address;
  let spec;
  if (which === 'rent') {
    spec = { section: 'rent', endpoint: 'avm/rent/long-term', fixtureId: 'avm/rent/long-term', params: { address, compCount: 25 }, normAddress: row.norm_address, refresh: !!body.refresh };
  } else {
    const zip = core.zipFromAddress(address);
    if (!zip) return json(400, { error: 'no_zip', message: 'This address has no 5-digit zip code.' });
    spec = { section: 'market', endpoint: 'markets', fixtureId: 'markets', params: { zipCode: zip, dataType: 'All', historyRange: 12 }, normAddress: 'ZIP ' + zip, refresh: !!body.refresh };
  }
  const r = await fetchSection(spec);
  if (!r.ok) return sectionErrorResponse(r);
  const patch = { sources: { ...(row.sources || {}), [which]: r.key } };
  if (which === 'rent' && r.data && r.data.rent !== undefined) patch.rent = r.data.rent;
  await ctx.store.updateReport(row.id, ctx.memberId, patch);
  return json(200, { demo: ctx.cfg.mode !== 'live', cached: r.cached, dataAsOf: r.fetchedAt, [which]: r.data });
}

// ── expand: one more sold-comps pull, wider than the default envelope ────
async function expandAction(ctx, fetchSection, body) {
  const radius = Math.min(MAX_EXPAND_RADIUS, Math.max(PULL.radius, Number(body.radius) || PULL.radius));
  const soldWithinDays = Math.max(PULL.soldWithinDays, Number(body.soldWithinDays) || PULL.soldWithinDays);
  if (radius <= PULL.radius && soldWithinDays <= PULL.soldWithinDays) {
    return json(400, { error: 'not_needed', message: 'That range is already covered by the comps on hand — no lookup needed.' });
  }
  if (ctx.cfg.mode === 'demo') return json(200, { demo: true, pulled: { radius, soldWithinDays, listings: true }, sold: loadFixture('properties:sold', ctx.now()) });
  const row = await loadOwnReport(ctx, body.reportId);
  const address = row.subject && row.subject.address;
  const r = await fetchSection({ section: 'sold', endpoint: 'properties', fixtureId: 'properties:sold', params: { address, radius, saleDateRange: soldWithinDays, limit: PULL.limit }, normAddress: row.norm_address, refresh: false });
  if (!r.ok) return sectionErrorResponse(r);
  await ctx.store.updateReport(row.id, ctx.memberId, { sources: { ...(row.sources || {}), sold: r.key }, selection: { ...(row.selection || {}), pulled: { radius, soldWithinDays, listings: true } } });
  const subject = row.subject || {};
  return json(200, { demo: ctx.cfg.mode !== 'live', cached: r.cached, pulled: { radius, soldWithinDays, listings: true }, comps: (Array.isArray(r.data) ? r.data : []).map(rec => engine.fromPropertyRecord(rec, subject)) });
}

// ── listings: active sale / rental competition, on demand ────────────────
async function listingsAction(ctx, fetchSection, q) {
  const type = q.type === 'rental' ? 'rental' : 'sale';
  const endpoint = type === 'rental' ? 'listings/rental/long-term' : 'listings/sale';
  if (ctx.cfg.mode === 'demo') return json(200, { demo: true, type, listings: loadFixture(endpoint, ctx.now()) });
  const row = await loadOwnReport(ctx, q.reportId);
  const address = row.subject && row.subject.address;
  const radius = Math.min(MAX_EXPAND_RADIUS, Number(q.radius) || 1);
  const r = await fetchSection({ section: 'listings-' + type, endpoint, fixtureId: endpoint, params: { address, radius, status: 'Active', limit: 50 }, normAddress: row.norm_address, refresh: false });
  if (!r.ok) return sectionErrorResponse(r);
  return json(200, { demo: ctx.cfg.mode !== 'live', cached: r.cached, type, listings: r.data });
}

// ── update: persist the member's selection; recompute server-side ────────
// Rebuilds from the cached responses this report was built from (0 calls),
// so the stored ARV always matches the stored selection.
async function updateAction(ctx, body) {
  const row = await loadOwnReport(ctx, body.reportId);
  const selection = sanitizeSelection(body.selection);
  const built = await rebuildFromCache(ctx, row, selection);
  if (!built) return json(409, { error: 'cache_expired', message: 'The data behind this report has expired. Run the comp again to refresh it.' });
  const updated = await ctx.store.updateReport(row.id, ctx.memberId, {
    selection, arv: built.report.arv, arv_low: built.report.arvLow, arv_high: built.report.arvHigh,
    comp_count: built.report.compCount, confidence: built.report.confidence,
    ...(row.share_token ? { snapshot: publicSnapshot(row, built) } : {}),
  });
  return json(200, { reportId: row.id, report: built.report, saved: !!updated });
}

function sanitizeSelection(sel) {
  const s = sel || {};
  const manual = {};
  Object.keys(s.manual || {}).slice(0, 600).forEach(k => { manual[String(k)] = !!s.manual[k]; });
  const ladder = (s.ladder || []).filter(id => engine.LADDER.some(st => st.id === id));
  const f = s.filters || {};
  const filters = {};
  ['radius', 'soldWithinDays', 'bedsTol', 'bathsTol', 'sqftTolPct', 'compCount'].forEach(k => { if (f[k] !== undefined && Number.isFinite(Number(f[k]))) filters[k] = Number(f[k]); });
  if (f.propertyType) filters.propertyType = String(f.propertyType).slice(0, 40);
  if (f.includeListings !== undefined) filters.includeListings = !!f.includeListings;
  const a = s.adjustments || {};
  const adjustments = { adjRate: engine.clampAdjRate(a.adjRate) };
  ['perBed', 'perBath'].forEach(k => { if (Number.isFinite(Number(a[k]))) adjustments[k] = Number(a[k]); });
  if (a.extras && typeof a.extras === 'object') {
    adjustments.extras = {};
    Object.keys(a.extras).slice(0, 100).forEach(id => {
      const e = a.extras[id] || {};
      adjustments.extras[String(id)] = { garage: Number(e.garage) || 0, pool: Number(e.pool) || 0, condition: Number(e.condition) || 0 };
    });
  }
  const out = { manual, ladder, filters, adjustments };
  if (s.pulled) out.pulled = { radius: Number(s.pulled.radius) || PULL.radius, soldWithinDays: Number(s.pulled.soldWithinDays) || PULL.soldWithinDays, listings: true };
  return out;
}

async function rebuildFromCache(ctx, row, selection, sourcesOverride) {
  const src = { ...(row.sources || {}), ...(sourcesOverride || {}) };
  const get = async key => {
    if (!key) return null;
    const hit = await ctx.store.getCache(key, ctx.now());
    return hit ? hit.response : undefined;
  };
  const [subjectData, soldData, valueData] = await Promise.all([get(src.subject), get(src.sold), get(src.value)]);
  if (subjectData === undefined || soldData === undefined || valueData === undefined) return null;
  const overrides = { address: row.subject && row.subject.address };
  if (row.subject && row.subject.leadOverrides) Object.assign(overrides, row.subject.leadOverrides);
  else ['lat', 'lng', 'sqft', 'beds', 'baths', 'yearBuilt', 'propertyType'].forEach(k => { if (row.subject && row.subject[k] !== undefined) overrides[k] = row.subject[k]; });
  const merged = { ...(row.selection || {}), ...(selection || {}) };
  return assemble({ subjectRec: firstRecord(subjectData), soldData, valueData, overrides, normAddress: row.norm_address, selection: merged, asOf: new Date(row.created_at || ctx.now()) });
}

// ── best-use: ARIS ranks Wholesale / Flip / Rental / STR / Hold ───────
// Sends only the computed summary (see _Lib/comps-best-use.js). Cached on
// comp_reports.best_use with a hash of the summary; `refresh: true` asks
// again (e.g. once rent and market data have loaded). Costs no RentCast
// lookup — one small Anthropic call, only on a cache miss.
async function bestUseAction(ctx, body) {
  const apiKey = ctx.env.ANTHROPIC_API_KEY;
  let summary;
  let row = null;
  if (body.reportId) {
    row = await loadOwnReport(ctx, body.reportId);
    let market = null;
    const marketKey = row.sources && row.sources.market;
    if (marketKey) { const hit = await ctx.store.getCache(marketKey, ctx.now()); market = hit ? hit.response : null; }
    summary = bestUse.buildSummary({ row, market, extra: { equity: body.equity } });
  } else if (ctx.cfg.mode === 'demo') {
    summary = bestUse.sanitizeSummary(body.summary);   // demo has no stored report
  } else {
    return json(400, { error: 'reportId is required' });
  }
  if (!summary.arv && !summary.forgeCastValue) return json(409, { error: 'no_value', message: 'Best use needs an ARV or a FORGE Cast value first.' });

  const hash = bestUse.summaryHash(summary);
  const cached = row && row.best_use;
  if (cached && cached.hash === hash && !body.refresh) return json(200, { cached: true, ...cached });

  if (!apiKey) return json(503, { error: 'aris_unavailable', message: 'ARIS is not configured.' });
  const r = await bestUse.askAris(summary, { apiKey, fetchImpl: ctx.deps.fetch });
  if (!r.ok) return json(502, { error: 'best_use_unavailable', message: 'ARIS could not rank this property right now. Try again in a minute.' });

  const record = { hash, result: r.result, summary, model: bestUse.MODEL, createdAt: ctx.now().toISOString() };
  if (row) {
    try { await ctx.store.updateReport(row.id, ctx.memberId, { best_use: record }); }
    catch (e) { console.error('rentcast-comps: best_use save failed', e && e.message); }
  }
  return json(200, { cached: false, ...record });
}

function suggestedAddressFor(noRecord, valueData, normAddress) {
  const fa = noRecord && valueData && valueData.subjectProperty && valueData.subjectProperty.formattedAddress;
  if (!fa) return null;
  return core.normalizeAddress(fa) !== normAddress ? fa : null;
}

// ── retry-record: one public-record lookup with FORGE Cast's spelling ────
// Used when the first record search missed but the valuation found the
// property under a different address. 1 lookup. Rebuilds the report from
// cache with the new record (sold comps and valuation are reused).
async function retryRecordAction(ctx, fetchSection, body) {
  const row = await loadOwnReport(ctx, body.reportId);
  const address = String(body.address || '').trim();
  if (!address) return json(400, { error: 'address is required' });
  if (ctx.cfg.mode === 'demo') return json(400, { error: 'not_available_in_demo' });
  const r = await fetchSection({ section: 'subject', endpoint: 'properties', fixtureId: 'properties:subject', params: { address }, normAddress: core.normalizeAddress(address), refresh: false });
  if (!r.ok) {
    if (r.status === 404) return json(404, { error: 'no_record', message: 'FORGE Cast has no public record under that spelling either.' });
    return sectionErrorResponse(r);
  }
  const rec = firstRecord(r.data);
  if (!rec) return json(404, { error: 'no_record', message: 'FORGE Cast has no public record under that spelling either.' });
  const built = await rebuildFromCache(ctx, row, row.selection, { subject: r.key });
  if (!built) return json(409, { error: 'cache_expired', message: 'The data behind this report has expired. Run the comp again to refresh it.' });
  const property = propertySection(rec);
  await ctx.store.updateReport(row.id, ctx.memberId, {
    subject: { ...built.subject, property, leadOverrides: (row.subject && row.subject.leadOverrides) || built.leadOverrides || null },
    sources: { ...(row.sources || {}), subject: r.key },
    arv: built.report.arv, arv_low: built.report.arvLow, arv_high: built.report.arvHigh,
    comp_count: built.report.compCount, confidence: built.report.confidence,
  });
  return json(200, { reportId: row.id, cached: r.cached, subject: built.subject, property, comps: built.comps, report: built.report });
}

// ── link-crm: remember which native CRM deal this report was saved to ───
// The member's own CRM (crm-deals / crm-notes / deal-documents) does the
// saving; this just stores the deal id so a second save updates the same
// deal instead of creating a duplicate.
async function linkCrmAction(ctx, body) {
  const row = await loadOwnReport(ctx, body.reportId);
  const dealId = String(body.dealId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return json(400, { error: 'dealId must be a deal id' });
  await ctx.store.updateReport(row.id, ctx.memberId, { crm_deal_id: dealId });
  return json(200, { reportId: row.id, crmDealId: dealId });
}

async function shareAction(ctx, body) {
  const row = await loadOwnReport(ctx, body.reportId);
  const built = await rebuildFromCache(ctx, row, row.selection);
  const token = row.share_token || crypto.randomBytes(18).toString('base64url');
  await ctx.store.updateReport(row.id, ctx.memberId, { share_token: token, snapshot: publicSnapshot(row, built) });
  return json(200, { reportId: row.id, token, url: `/comp-report.html?t=${encodeURIComponent(token)}` });
}

async function revokeAction(ctx, body) {
  const row = await loadOwnReport(ctx, body.reportId);
  await ctx.store.updateReport(row.id, ctx.memberId, { share_token: null, snapshot: null });
  return json(200, { reportId: row.id, revoked: true });
}

function sectionErrorResponse(r) {
  if (r.error === 'budget_cap') return json(402, { error: 'budget_cap', message: 'Comp lookups are paused for this month; cached reports still work.' });
  if (r.error === 'budget_check_failed') return json(503, { error: 'budget_check_failed', message: 'Comp lookups are temporarily unavailable.' });
  if (r.error === 'member_limit') return json(429, { error: 'member_limit', message: 'Monthly comp lookup limit reached. Cached reports still work.' });
  if (r.status === 404) return json(404, { error: 'not_found' });
  if (r.status === 429) return json(429, { error: 'rate_limited' });
  if (r.status === 504) return json(504, { error: 'timeout' });
  return json(502, { error: 'rentcast_unavailable' });
}

// ── budget + usage views ─────────────────────────────────────────────────
async function budgetView(store, cfg, now) {
  const month = core.monthKey(now);
  const b = await store.getBudget(month);
  const calls = b ? Number(b.calls) : 0;
  const spend = b ? Number(b.spend_usd) : cfg.pricing.baseFee;
  // Free lookups are the plan's included requests; paid lookups are what the
  // remaining cap dollars buy at the overage rate. Reported separately so the
  // UI doesn't show e.g. "548 left" on a 50-request plan.
  const freeLeft = Math.max(0, cfg.pricing.included - calls);
  const dollarsLeft = Math.max(0, cfg.cap - spend);
  const paidLeft = cfg.pricing.overage > 0 ? Math.floor(dollarsLeft / cfg.pricing.overage + 1e-9) : null;
  const remaining = spend >= cfg.cap && freeLeft === 0 ? 0 : (paidLeft === null ? null : freeLeft + paidLeft);
  return {
    month, plan: cfg.plan, calls, spend: Math.round(spend * 100) / 100, cap: cfg.cap,
    included: cfg.pricing.included, overage: cfg.pricing.overage,
    freeLookupsLeft: freeLeft, paidLookupsLeft: paidLeft,
    remainingLookups: remaining, paused: remaining === 0,
  };
}

async function usage(store, cfg, now) {
  const month = core.monthKey(now);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [budget, calls] = await Promise.all([budgetView(store, cfg, now), store.listCallsSince(since)]);
  const hits = calls.filter(c => c.cache_hit).length;
  const byMember = {};
  calls.forEach(c => {
    const m = byMember[c.memberstack_id] || (byMember[c.memberstack_id] = { memberId: c.memberstack_id, lookups: 0, liveCalls: 0, cacheHits: 0, cost: 0 });
    m.lookups += 1;
    if (c.cache_hit) m.cacheHits += 1; else m.liveCalls += 1;
    m.cost += Number(c.cost_usd) || 0;
  });
  const topMembers = Object.values(byMember).sort((a, b) => b.liveCalls - a.liveCalls).slice(0, 10)
    .map(m => ({ ...m, cost: Math.round(m.cost * 100) / 100 }));
  return {
    month,
    budget,
    lookups: calls.length,
    liveCalls: calls.length - hits,
    cacheHits: hits,
    cacheHitRate: calls.length ? Math.round(hits / calls.length * 1000) / 10 : null,
    errors: calls.filter(c => c.http_status && c.http_status >= 400 && c.http_status !== 402).length,
    refusedByCap: calls.filter(c => c.http_status === 402).length,
    topMembers,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Production wiring (lazy, so tests never load Supabase or Memberstack)
// ─────────────────────────────────────────────────────────────────────────
let prodHandler = null;
function getProdHandler() {
  if (prodHandler) return prodHandler;
  const { verifyMember } = require('./_Lib/verify-member');
  const { supabase } = require('./_Lib/supabase-client');
  const { createSupabaseStore } = require('./_Lib/comps-store');
  const memberstack = require('@memberstack/admin').init(process.env.MEMBERSTACK_SECRET_KEY);
  prodHandler = createHandler({
    store: createSupabaseStore(supabase),
    verifyMember,
    getMember: async (id) => { const { data } = await memberstack.members.retrieve({ id }); return data || null; },
    fetch: (...args) => fetch(...args),
  });
  return prodHandler;
}

exports.handler = (event, context) => getProdHandler()(event, context);
exports.createHandler = createHandler;
exports._internals = { config, assemble, sanitizeSelection, publicSnapshot, budgetView, usage, PULL };
