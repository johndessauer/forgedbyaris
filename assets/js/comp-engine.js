// assets/js/comp-engine.js
//
// FORGE Comping Engine — pure ARV math. No DOM, no fetch, no globals beyond
// the export. Loaded by property-search.html in the browser (window.ForgeCompEngine)
// and by Node (require) for unit tests and the rentcast-comps function.
//
// Rules come from John's appraisal guide (Comping Engine Build Brief §4):
//   - 3–5 sold comps, within 1 mile, sold in the last 90 days, same property
//     type, beds ±1, baths ±1, sqft ±20%.
//   - Size adjustment = (subjectSqft − compSqft) × adjRate, adjRate $30–$50/sqft
//     (default $40).
//   - FORGE ARV = median of included adjusted prices (mean when ≤3 comps).
//   - Expansion is member-controlled, one step at a time, never automatic.
//
// Comp objects used throughout (normalized from RentCast by the mappers below):
//   { id, address, lat, lng, distance, price, date, sqft, beds, baths,
//     yearBuilt, propertyType, source: 'recorded' | 'listing', status,
//     correlation, daysOnMarket }
//   `source: 'recorded'` = a recorded sale from /properties (lastSalePrice).
//   `source: 'listing'`  = an AVM comparable from /avm/value. These are
//   LISTINGS (Active/Inactive, list price), not confirmed closed sales.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForgeCompEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Defaults ─────────────────────────────────────────────────────────────
  const DEFAULT_FILTERS = Object.freeze({
    radius: 1,            // miles
    soldWithinDays: 90,
    bedsTol: 1,
    bathsTol: 1,
    sqftTolPct: 20,
    propertyType: null,   // null = same as subject
    compCount: 5,         // auto-include the top N
    includeListings: false,
  });

  const ADJ_RATE_MIN = 30;
  const ADJ_RATE_MAX = 50;
  const ADJ_RATE_DEFAULT = 40;

  // Similarity weights (brief §4.1). Correlation from RentCast, when present
  // on a matched comp, is blended in at CORRELATION_BLEND.
  const WEIGHTS = Object.freeze({ distance: 0.40, sqft: 0.25, bedBath: 0.15, yearBuilt: 0.10, recency: 0.10 });
  const CORRELATION_BLEND = 0.25;
  const YEAR_BUILT_SPAN = 30;     // years; a 30+ year gap scores 0 on that factor
  const MIN_ARMS_LENGTH_PRICE = 10000;

  // Expansion ladder (brief §4.3). The order members see.
  const LADDER = Object.freeze([
    { id: 'loosen',   label: 'Loosen tolerances (beds ±2, sqft ±30%)', apply: f => ({ ...f, bedsTol: Math.max(f.bedsTol, 2), sqftTolPct: Math.max(f.sqftTolPct, 30) }) },
    { id: 'radius15', label: 'Radius 1.5 mi', apply: f => ({ ...f, radius: Math.max(f.radius, 1.5) }) },
    { id: 'radius2',  label: 'Radius 2 mi',   apply: f => ({ ...f, radius: Math.max(f.radius, 2) }) },
    { id: 'days180',  label: 'Sold within 180 days', apply: f => ({ ...f, soldWithinDays: Math.max(f.soldWithinDays, 180) }) },
    { id: 'days365',  label: 'Sold within 365 days', apply: f => ({ ...f, soldWithinDays: Math.max(f.soldWithinDays, 365) }) },
    { id: 'listings', label: 'Include listing comps (unverified sales)', apply: f => ({ ...f, includeListings: true }) },
  ]);

  // ── Small helpers ────────────────────────────────────────────────────────
  const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const round = (x, d = 0) => { const p = Math.pow(10, d); return Math.round(x * p) / p; };

  function median(values) {
    const v = values.filter(x => x !== null && Number.isFinite(x)).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function mean(values) {
    const v = values.filter(x => x !== null && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  function stdDev(values) {
    const v = values.filter(x => x !== null && Number.isFinite(x));
    if (v.length < 2) return 0;
    const m = mean(v);
    return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1));
  }

  // Great-circle distance in miles. /properties records carry no `distance`
  // field, so recorded-sale comps get theirs computed here.
  function haversineMiles(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(x => num(x) === null)) return null;
    const R = 3958.8;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function daysBetween(isoDate, asOf) {
    const t = Date.parse(isoDate);
    if (!Number.isFinite(t)) return null;
    return (asOf.getTime() - t) / 86400000;
  }

  function sameType(a, b) {
    if (!a || !b) return true; // unknown type never excludes on its own
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  // ── Mappers: RentCast → normalized comp ─────────────────────────────────
  // Field names match RentCast's documented examples (developers.rentcast.io,
  // read Oct 12, 2026). UNVERIFIED against a live FORGE response until Phase 5.
  function fromPropertyRecord(rec, subject) {
    const lat = num(rec.latitude), lng = num(rec.longitude);
    return {
      id: rec.id || rec.formattedAddress,
      address: rec.formattedAddress || [rec.addressLine1, rec.city, rec.state, rec.zipCode].filter(Boolean).join(', '),
      lat, lng,
      distance: subject ? haversineMiles(subject.lat, subject.lng, lat, lng) : null,
      price: num(rec.lastSalePrice),
      date: rec.lastSaleDate || null,
      sqft: num(rec.squareFootage),
      beds: num(rec.bedrooms),
      baths: num(rec.bathrooms),
      yearBuilt: num(rec.yearBuilt),
      propertyType: rec.propertyType || null,
      source: 'recorded',
      status: 'Sold',
      correlation: null,
      daysOnMarket: null,
    };
  }

  function fromAvmComparable(c) {
    return {
      id: c.id || c.formattedAddress,
      address: c.formattedAddress || [c.addressLine1, c.city, c.state, c.zipCode].filter(Boolean).join(', '),
      lat: num(c.latitude), lng: num(c.longitude),
      distance: num(c.distance),
      price: num(c.price),
      // Inactive listings: removedDate is the closest thing to a "sold" date,
      // but it may be a withdrawal. Active listings: use the listed date.
      date: c.removedDate || c.listedDate || null,
      sqft: num(c.squareFootage),
      beds: num(c.bedrooms),
      baths: num(c.bathrooms),
      yearBuilt: num(c.yearBuilt),
      propertyType: c.propertyType || null,
      source: 'listing',
      status: c.status || null,
      correlation: num(c.correlation),
      daysOnMarket: num(c.daysOnMarket),
    };
  }

  function subjectFromRecord(rec, overrides) {
    const o = overrides || {};
    return {
      address: rec ? (rec.formattedAddress || null) : (o.address || null),
      lat: num(o.lat) ?? (rec ? num(rec.latitude) : null),
      lng: num(o.lng) ?? (rec ? num(rec.longitude) : null),
      sqft: num(o.sqft) ?? (rec ? num(rec.squareFootage) : null),
      beds: num(o.beds) ?? (rec ? num(rec.bedrooms) : null),
      baths: num(o.baths) ?? (rec ? num(rec.bathrooms) : null),
      yearBuilt: num(o.yearBuilt) ?? (rec ? num(rec.yearBuilt) : null),
      propertyType: o.propertyType || (rec ? rec.propertyType : null) || null,
      lastSalePrice: rec ? num(rec.lastSalePrice) : null,
      lastSaleDate: rec ? (rec.lastSaleDate || null) : null,
    };
  }

  // Merge recorded + listing comps, dropping a listing that duplicates a
  // recorded sale (same RentCast id), but carrying its correlation across.
  function mergeComps(recorded, listings) {
    const byId = new Map();
    (recorded || []).forEach(c => byId.set(c.id, { ...c }));
    (listings || []).forEach(c => {
      if (byId.has(c.id)) {
        const r = byId.get(c.id);
        if (r.correlation === null && c.correlation !== null) r.correlation = c.correlation;
      } else {
        byId.set(c.id, { ...c });
      }
    });
    return Array.from(byId.values());
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  // Returns each comp with { eligible, reasons[] }. Nothing is dropped, so the
  // UI can show why a comp is out.
  function evaluateComps(comps, subject, filters, asOf) {
    const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
    const now = asOf instanceof Date ? asOf : new Date(asOf || Date.now());
    const targetType = f.propertyType || subject.propertyType;

    // Non-arm's-length / outlier screen on recorded sales only (brief §4.1).
    const recordedPpsf = comps
      .filter(c => c.source === 'recorded' && c.price >= MIN_ARMS_LENGTH_PRICE && c.sqft > 0)
      .map(c => c.price / c.sqft);
    const ppsfMedian = median(recordedPpsf);
    const ppsfSd = stdDev(recordedPpsf);
    const outlierCheck = recordedPpsf.length >= 4 && ppsfSd > 0;

    return comps.map(c => {
      const reasons = [];
      const ageDays = c.date ? daysBetween(c.date, now) : null;
      const ppsf = (c.price && c.sqft) ? c.price / c.sqft : null;

      if (c.source === 'listing' && !f.includeListings) reasons.push('listing');
      if (c.price === null || c.price <= 0) reasons.push('no-price');
      else if (c.source === 'recorded' && c.price < MIN_ARMS_LENGTH_PRICE) reasons.push('non-arms-length');
      if (outlierCheck && c.source === 'recorded' && c.price >= MIN_ARMS_LENGTH_PRICE && ppsf !== null && Math.abs(ppsf - ppsfMedian) > 2 * ppsfSd) reasons.push('ppsf-outlier');
      if (c.distance === null || c.distance > f.radius) reasons.push('radius');
      if (c.source === 'recorded' && (ageDays === null || ageDays > f.soldWithinDays)) reasons.push('sale-date');
      if (!sameType(c.propertyType, targetType)) reasons.push('property-type');
      if (subject.beds !== null && c.beds !== null && Math.abs(c.beds - subject.beds) > f.bedsTol) reasons.push('beds');
      if (subject.baths !== null && c.baths !== null && Math.abs(c.baths - subject.baths) > f.bathsTol) reasons.push('baths');
      if (subject.sqft && c.sqft && Math.abs(c.sqft - subject.sqft) / subject.sqft * 100 > f.sqftTolPct) reasons.push('sqft');

      return { ...c, ppsf, ageDays, eligible: reasons.length === 0, reasons };
    });
  }

  // ── Similarity (brief §4.1) ──────────────────────────────────────────────
  function similarity(subject, comp, filters) {
    const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
    const dScore = comp.distance === null ? 0 : clamp01(1 - comp.distance / Math.max(f.radius, 0.01));
    const sqftScore = (subject.sqft && comp.sqft)
      ? clamp01(1 - Math.abs(comp.sqft - subject.sqft) / (subject.sqft * Math.max(f.sqftTolPct, 1) / 100))
      : 0.5;
    const matchScore = (a, b) => (a === null || b === null) ? 0.5 : (a === b ? 1 : (Math.abs(a - b) <= 1 ? 0.5 : 0));
    const bbScore = (matchScore(subject.beds, comp.beds) + matchScore(subject.baths, comp.baths)) / 2;
    const ybScore = (subject.yearBuilt && comp.yearBuilt) ? clamp01(1 - Math.abs(comp.yearBuilt - subject.yearBuilt) / YEAR_BUILT_SPAN) : 0.5;
    const recScore = (comp.ageDays === null || comp.ageDays === undefined) ? 0.5 : clamp01(1 - comp.ageDays / Math.max(f.soldWithinDays, 1));

    let score = WEIGHTS.distance * dScore + WEIGHTS.sqft * sqftScore + WEIGHTS.bedBath * bbScore
              + WEIGHTS.yearBuilt * ybScore + WEIGHTS.recency * recScore;
    if (comp.correlation !== null && comp.correlation !== undefined) {
      score = (1 - CORRELATION_BLEND) * score + CORRELATION_BLEND * clamp01(comp.correlation);
    }
    return round(score, 4);
  }

  // ── Adjustments (brief §4.2) ─────────────────────────────────────────────
  function clampAdjRate(rate) {
    const r = num(rate);
    if (r === null) return ADJ_RATE_DEFAULT;
    return Math.max(ADJ_RATE_MIN, Math.min(ADJ_RATE_MAX, r));
  }

  // adjustments: { adjRate, perBed, perBath, extras: { [compId]: { garage, pool, condition } } }
  function adjustComp(comp, subject, adjustments) {
    const a = adjustments || {};
    const rate = clampAdjRate(a.adjRate);
    const size = (subject.sqft && comp.sqft) ? (subject.sqft - comp.sqft) * rate : 0;
    const bed = (num(a.perBed) && subject.beds !== null && comp.beds !== null) ? (subject.beds - comp.beds) * num(a.perBed) : 0;
    const bath = (num(a.perBath) && subject.baths !== null && comp.baths !== null) ? (subject.baths - comp.baths) * num(a.perBath) : 0;
    const ex = (a.extras && a.extras[comp.id]) || {};
    const extras = (num(ex.garage) || 0) + (num(ex.pool) || 0) + (num(ex.condition) || 0);
    const total = size + bed + bath + extras;
    return {
      adjRate: rate,
      lines: { size: round(size), bed: round(bed), bath: round(bath), extras: round(extras) },
      totalAdjustment: round(total),
      adjustedPrice: comp.price === null ? null : round(comp.price + total),
    };
  }

  // ── ARV (brief §4.2) ─────────────────────────────────────────────────────
  function computeArv(adjustedPrices, subjectSqft) {
    const v = adjustedPrices.filter(x => x !== null && Number.isFinite(x));
    if (!v.length) return { arv: null, low: null, high: null, method: null, pricePerSqft: null, count: 0 };
    const method = v.length <= 3 ? 'mean' : 'median';
    const arv = round(method === 'mean' ? mean(v) : median(v));
    return {
      arv,
      low: Math.min(...v),
      high: Math.max(...v),
      method,
      pricePerSqft: subjectSqft ? round(arv / subjectSqft, 2) : null,
      count: v.length,
    };
  }

  // ── Confidence (brief §4.4) ──────────────────────────────────────────────
  // High:   ≥3 recorded sales within the default 1 mi / 90 days (no expansion
  //         used, no listing comps) and every adjusted price within ±10% of
  //         the median.
  // Medium: ≥3 comps, at most one expansion step used, spread within ±20%.
  // Low:    anything else.
  function confidence(included, expansionsUsed) {
    const prices = included.map(c => c.adjustedPrice).filter(x => x !== null);
    if (prices.length < 3) return { level: 'Low', maxDeviationPct: null };
    const m = median(prices);
    const maxDev = Math.max(...prices.map(p => Math.abs(p - m) / m));
    const recorded = included.filter(c => c.source === 'recorded').length;
    const listings = included.length - recorded;
    const devPct = round(maxDev * 100, 1);
    if (expansionsUsed === 0 && listings === 0 && recorded >= 3 && maxDev <= 0.10) return { level: 'High', maxDeviationPct: devPct };
    if (expansionsUsed <= 1 && maxDev <= 0.20) return { level: 'Medium', maxDeviationPct: devPct };
    return { level: 'Low', maxDeviationPct: devPct };
  }

  // ── Expansion ladder (brief §4.3) ────────────────────────────────────────
  // `pulled` describes what the server already fetched in one call:
  // { radius, soldWithinDays, listings: boolean }. A step is free when the
  // data it needs is already in hand; otherwise it costs one lookup.
  function ladderSteps(appliedIds, pulled) {
    const applied = new Set(appliedIds || []);
    const p = pulled || { radius: DEFAULT_FILTERS.radius, soldWithinDays: DEFAULT_FILTERS.soldWithinDays, listings: false };
    return LADDER.map(step => {
      const probe = step.apply({ ...DEFAULT_FILTERS });
      let costsLookup = false;
      if (step.id.startsWith('radius')) costsLookup = probe.radius > p.radius;
      if (step.id.startsWith('days')) costsLookup = probe.soldWithinDays > p.soldWithinDays;
      if (step.id === 'listings') costsLookup = !p.listings;
      return { id: step.id, label: step.label, applied: applied.has(step.id), costsLookup };
    });
  }

  function applyLadder(filters, appliedIds) {
    let f = { ...DEFAULT_FILTERS, ...(filters || {}) };
    LADDER.forEach(step => { if ((appliedIds || []).includes(step.id)) f = step.apply(f); });
    return f;
  }

  // True when the requested filters reach beyond what was pulled, so a new
  // (paid) call is required. The UI must show an explicit button for that.
  function requiresNewPull(filters, pulled) {
    const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
    if (!pulled) return true;
    return f.radius > pulled.radius || f.soldWithinDays > pulled.soldWithinDays || (f.includeListings && !pulled.listings);
  }

  // ── Orchestration ────────────────────────────────────────────────────────
  // state: {
  //   subject, comps (normalized, merged), filters, ladder: [stepIds],
  //   adjustments, manual: { [compId]: true|false }  (member include/exclude),
  //   asOf, pulled
  // }
  // Returns everything the panel needs. Pure and fast: toggling a comp is a
  // re-run of this function with a changed `manual` map, no network.
  function buildReport(state) {
    const s = state || {};
    const subject = s.subject || {};
    const ladderIds = s.ladder || [];
    const filters = applyLadder(s.filters, ladderIds);
    const evaluated = evaluateComps(s.comps || [], subject, filters, s.asOf);

    const scored = evaluated
      .map(c => ({ ...c, similarity: similarity(subject, c, filters), ...adjustComp(c, subject, s.adjustments) }))
      .sort((a, b) => b.similarity - a.similarity);

    // Auto-selection: top N eligible by similarity.
    const autoIds = new Set(scored.filter(c => c.eligible).slice(0, filters.compCount).map(c => c.id));
    const manual = s.manual || {};
    const rows = scored.map(c => {
      const auto = autoIds.has(c.id);
      const included = Object.prototype.hasOwnProperty.call(manual, c.id) ? !!manual[c.id] : auto;
      return { ...c, autoSelected: auto, included };
    });

    const included = rows.filter(r => r.included);
    const arv = computeArv(included.map(r => r.adjustedPrice), subject.sqft);
    const expansionsUsed = ladderIds.length;
    const conf = confidence(included, expansionsUsed);
    const relaxed = LADDER.filter(st => ladderIds.includes(st.id)).map(st => st.label);
    const eligibleCount = rows.filter(r => r.eligible).length;

    return {
      subject,
      filters,
      rows,
      included: included.map(r => r.id),
      arv: arv.arv,
      arvLow: arv.low,
      arvHigh: arv.high,
      method: arv.method,
      pricePerSqft: arv.pricePerSqft,
      compCount: arv.count,
      eligibleCount,
      confidence: conf.level,
      maxDeviationPct: conf.maxDeviationPct,
      relaxedRules: relaxed,
      needsExpansion: eligibleCount < 3,
      ladder: ladderSteps(ladderIds, s.pulled),
      adjRate: clampAdjRate(s.adjustments && s.adjustments.adjRate),
    };
  }

  return {
    DEFAULT_FILTERS, ADJ_RATE_MIN, ADJ_RATE_MAX, ADJ_RATE_DEFAULT, WEIGHTS, LADDER,
    median, mean, stdDev, haversineMiles,
    fromPropertyRecord, fromAvmComparable, subjectFromRecord, mergeComps,
    evaluateComps, similarity, clampAdjRate, adjustComp, computeArv, confidence,
    ladderSteps, applyLadder, requiresNewPull, buildReport,
  };
}));
