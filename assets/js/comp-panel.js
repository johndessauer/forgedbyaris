// assets/js/comp-panel.js — FORGE Comping Engine panel (Phase 2)
//
// Loaded by property-search.html after Leaflet and comp-engine.js.
// Exposes window.ForgeComps. The page calls ForgeComps.init(...) once the
// member is known, then asks ForgeComps.buttonFor(...) for the
// "Comp This Property" button wherever it renders a lead.
//
// ── Visibility flag ────────────────────────────────────────────────────
// Until RentCast goes live (Phase 5) the panel is ADMIN-ONLY (John,
// Oct 12, 2026): with no RentCast key the backend serves Crown Point demo
// data for any address, which members could mistake for real comps.
// Flip COMPS_PUBLIC to true in Phase 5. The server enforces the Empire
// tier gate regardless of this flag.
//
// All ARV math lives in comp-engine.js. Toggling a comp, changing a filter
// inside the pulled range, or moving the $/sqft slider is a pure re-run of
// ForgeCompEngine.buildReport() — no network call. The only paid actions
// are the explicit "Expand search (uses 1 lookup)" and "Refresh (uses 1
// lookup)" buttons. Selections are saved in the background with the free
// `update` action so the stored ARV matches what the member sees.

(function () {
  'use strict';

  const COMPS_PUBLIC = false;
  const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];
  const API = '/api/rentcast-comps';
  const SAVE_DEBOUNCE_MS = 900;

  const E = window.ForgeCompEngine;
  const ctx = { enabled: false, getToken: () => null, email: '' };
  let S = null;            // current panel state
  let els = null;          // panel DOM handles
  let compMap = null, compLayer = null, radiusCircle = null, markersById = {};
  let saveTimer = null, stepTimer = null, lastFocus = null;

  // ── tiny helpers ───────────────────────────────────────────────────
  const esc = v => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = v => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '—' : '$' + Math.round(Number(v)).toLocaleString('en-US');
  const moneyK = v => (v === null || v === undefined) ? '—' : '$' + Math.round(Number(v) / 1000).toLocaleString('en-US') + 'K';
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const shortDate = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; };
  // "801 N Main St, Crown Point, IN 46307" → "801 N Main St" for the table;
  // the full address stays in the title attribute and the map tooltip.
  const streetOnly = a => String(a || '').split(',')[0];
  const simClass = s => s >= 0.85 ? 'hi' : (s >= 0.70 ? 'mid' : 'lo');
  const $ = (sel, root) => (root || document).querySelector(sel);

  async function api(method, payload) {
    const token = ctx.getToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let url = API;
    const opts = { method, headers };
    if (method === 'GET') url += '?' + new URLSearchParams(payload).toString();
    else { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(payload); }
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { return { status: 0, body: { error: 'network' } }; }
    let body = {};
    try { body = await res.json(); } catch (e) { body = {}; }
    return { status: res.status, body };
  }

  // ── public: init + buttons ─────────────────────────────────────────
  function init(opts) {
    const o = opts || {};
    ctx.getToken = typeof o.getToken === 'function' ? o.getToken : () => null;
    ctx.email = String(o.email || '').toLowerCase();
    ctx.enabled = !!E && (COMPS_PUBLIC || ADMIN_EMAILS.includes(ctx.email));
    if (!ctx.enabled) return false;

    buildPanel();
    renderLookupCard();

    const params = new URLSearchParams(window.location.search);
    const deep = params.get('comp');
    if (deep) open(deep, {});
    return true;
  }

  function buttonFor(kind, id) {
    if (!ctx.enabled) return '';
    return `<button type="button" class="ps-lead-action-btn ps-comp-lead-btn" data-comp-kind="${esc(kind)}" data-comp-id="${esc(id)}" onclick="ForgeComps.fromButton(this)">Comp This Property</button>`;
  }

  function popupButton(id) {
    if (!ctx.enabled) return '';
    return `<button type="button" class="ps-comp-popup-btn" data-comp-kind="result" data-comp-id="${esc(id)}" onclick="ForgeComps.fromButton(this)">Comp This Property</button>`;
  }

  // Gathers what the page already knows about a lead, so the first call
  // uses the right beds/baths/sqft (brief §3.1.2).
  function openLead(kind, id) {
    let rec = null;
    try {
      // eslint-disable-next-line no-undef
      if (kind === 'saved' && typeof savedLeadsCache !== 'undefined') rec = savedLeadsCache.find(l => String(l.id) === String(id));
      // eslint-disable-next-line no-undef
      else if (typeof lastResults !== 'undefined') rec = lastResults.find(r => String(r.id) === String(id));
    } catch (e) { rec = null; }
    if (!rec || !rec.address) return;
    const d = rec.details || {};
    open(rec.address, { beds: d.beds, baths: d.baths, sqft: d.sqft, propertyType: d.propertyType, yearBuilt: d.yearBuilt, lat: rec.lat, lng: rec.lng });
  }

  // ── lookup card (replaces the "Property Lookup by Address" teaser) ──
  function renderLookupCard() {
    const lookupTeaser = document.getElementById('ps-teaser-lookup');
    const compTeaser = document.getElementById('ps-teaser-comps');
    if (compTeaser) compTeaser.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'ps-comp-scope ps-comp-lookup';
    card.id = 'ps-comp-lookup';
    card.innerHTML = `
      <h3>Comp a Property</h3>
      <div class="ps-comp-hint">Recorded sales within 1 mi / 90 days, plus a RentCast valuation. Admin preview — demo data until live.</div>
      <form id="ps-comp-form" novalidate>
        <label class="ps-comp-field"><span>Street</span><input class="ps-comp-input" id="ps-comp-street" autocomplete="street-address" placeholder="733 N Main St" required></label>
        <div class="ps-comp-row2">
          <label class="ps-comp-field"><span>City</span><input class="ps-comp-input" id="ps-comp-city" autocomplete="address-level2" placeholder="Crown Point"></label>
          <label class="ps-comp-field"><span>State</span><input class="ps-comp-input" id="ps-comp-state" maxlength="2" autocomplete="address-level1" placeholder="IN"></label>
          <label class="ps-comp-field"><span>ZIP</span><input class="ps-comp-input" id="ps-comp-zip" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="46307"></label>
        </div>
        <details class="ps-comp-refine">
          <summary>Refine (optional)</summary>
          <div class="ps-comp-row3">
            <label class="ps-comp-field"><span>Beds</span><input class="ps-comp-input" id="ps-comp-beds" inputmode="decimal"></label>
            <label class="ps-comp-field"><span>Baths</span><input class="ps-comp-input" id="ps-comp-baths" inputmode="decimal"></label>
            <label class="ps-comp-field"><span>Sq ft</span><input class="ps-comp-input" id="ps-comp-sqft" inputmode="numeric"></label>
          </div>
          <label class="ps-comp-field"><span>Property type</span>
            <select class="ps-comp-select" id="ps-comp-type">
              <option value="">Use public record</option>
              <option>Single Family</option><option>Condo</option><option>Townhouse</option>
              <option>Multi-Family</option><option>Manufactured</option>
            </select>
          </label>
        </details>
        <button type="submit" class="ps-comp-btn-gold" id="ps-comp-go">Comp This Property</button>
        <div class="ps-comp-form-error" id="ps-comp-form-error" role="alert"></div>
      </form>`;
    if (lookupTeaser && lookupTeaser.parentNode) lookupTeaser.parentNode.replaceChild(card, lookupTeaser);
    else { const f = document.querySelector('.ps-filters'); if (f) f.appendChild(card); }

    $('#ps-comp-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const street = $('#ps-comp-street').value.trim();
      const city = $('#ps-comp-city').value.trim();
      const state = $('#ps-comp-state').value.trim().toUpperCase();
      const zip = $('#ps-comp-zip').value.trim();
      const err = $('#ps-comp-form-error');
      if (!street || !(zip || (city && state))) {
        err.textContent = 'Enter the street plus a ZIP, or the street with city and state.';
        err.style.display = 'block';
        return;
      }
      err.style.display = 'none';
      const address = [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      open(address, { beds: num($('#ps-comp-beds').value), baths: num($('#ps-comp-baths').value), sqft: num($('#ps-comp-sqft').value), propertyType: $('#ps-comp-type').value || null });
    });
  }

  // ── panel shell ─────────────────────────────────────────────────────
  function buildPanel() {
    if (els) return;
    const overlay = document.createElement('div');
    overlay.className = 'ps-comp-overlay';
    overlay.addEventListener('click', close);
    const panel = document.createElement('aside');
    panel.className = 'ps-comp-scope ps-comp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'ps-comp-title');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = `
      <div class="ps-comp-head">
        <div class="ps-comp-head-main" id="ps-comp-head"></div>
        <button type="button" class="ps-comp-close" id="ps-comp-close" aria-label="Close comps">×</button>
      </div>
      <div class="ps-comp-body" id="ps-comp-body"></div>
      <div class="ps-comp-sr" aria-live="polite" id="ps-comp-live"></div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    els = { overlay, panel, head: $('#ps-comp-head', panel), body: $('#ps-comp-body', panel), live: $('#ps-comp-live', panel) };
    $('#ps-comp-close', panel).addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && els.panel.classList.contains('open')) close(); });
  }

  function show() {
    lastFocus = document.activeElement;
    els.overlay.classList.add('open');
    els.panel.classList.add('open');
    els.panel.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const c = $('#ps-comp-close', els.panel); if (c) c.focus(); }, 50);
  }

  function close() {
    if (!els) return;
    els.overlay.classList.remove('open');
    els.panel.classList.remove('open');
    els.panel.setAttribute('aria-hidden', 'true');
    clearInterval(stepTimer);
    flushSave();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ── open: one orchestrated pull (up to 3 lookups, or $0 when cached) ─
  async function open(address, overrides) {
    if (!ctx.enabled) return;
    buildPanel();
    flushSave();
    S = { address, overrides: overrides || {}, resp: null, filters: { ...E.DEFAULT_FILTERS }, ladder: [], manual: {}, adjustments: { adjRate: E.ADJ_RATE_DEFAULT, perBed: 0, perBath: 0 }, sort: { key: 'similarity', dir: 'desc' }, showExcluded: false, focusId: null, busy: false };
    renderHead();
    renderLoading();
    show();
    const r = await api('POST', { action: 'comp', address, overrides: S.overrides });
    clearInterval(stepTimer);
    if (r.status !== 200) { renderError(r); return; }
    applyResponse(r.body);
  }

  function applyResponse(body) {
    S.resp = body;
    S.pulled = body.pulled || { radius: 2, soldWithinDays: 365, listings: true };
    S.budget = body.budget || null;
    renderAll();
  }

  // ── rendering ───────────────────────────────────────────────────────
  function report() {
    return E.buildReport({
      subject: S.resp.subject, comps: S.resp.comps, filters: S.filters, ladder: S.ladder,
      adjustments: S.adjustments, manual: S.manual, asOf: new Date(), pulled: S.pulled,
    });
  }

  function renderHead() {
    const resp = S && S.resp;
    const subj = resp && resp.subject;
    const facts = [];
    if (subj) {
      if (subj.propertyType) facts.push(esc(subj.propertyType));
      if (subj.beds != null) facts.push(esc(subj.beds) + ' bd');
      if (subj.baths != null) facts.push(esc(subj.baths) + ' ba');
      if (subj.sqft) facts.push(Number(subj.sqft).toLocaleString('en-US') + ' sqft');
      if (subj.yearBuilt) facts.push('built ' + esc(subj.yearBuilt));
    }
    const pills = [];
    if (resp && resp.demo) pills.push('<span class="ps-comp-pill demo" title="Sample data — not a real comp report">Demo data</span>');
    if (resp && resp.cached && Object.values(resp.cached).some(Boolean)) pills.push(`<span class="ps-comp-pill" title="Served from FORGE's cache — no lookup used">Data as of ${esc(shortDate(resp.dataAsOf))} · cached</span>`);
    els.head.innerHTML = `
      <div class="ps-comp-kicker">Comp Report</div>
      <div class="ps-comp-title" id="ps-comp-title">${esc((subj && subj.address) || (S && S.address) || '')}</div>
      ${facts.length ? `<div class="ps-comp-facts">${facts.join(' · ')}</div>` : ''}
      ${pills.length ? `<div class="ps-comp-pills">${pills.join('')}</div>` : ''}`;
  }

  function renderLoading() {
    const steps = ['Pulling recorded sales…', 'Valuing the property…', 'Ranking comparables…', 'Almost there…'];
    let i = 0;
    els.body.innerHTML = `
      <div class="ps-comp-step-text" id="ps-comp-step" aria-live="polite">${steps[0]}</div>
      <div class="ps-comp-skel" style="height:96px"></div>
      <div class="ps-comp-skel" style="height:64px"></div>
      <div class="ps-comp-skel" style="height:220px"></div>
      <div class="ps-comp-skel" style="height:180px"></div>`;
    clearInterval(stepTimer);
    stepTimer = setInterval(() => { i = Math.min(i + 1, steps.length - 1); const el = $('#ps-comp-step'); if (el) el.textContent = steps[i]; }, 1400);
  }

  function renderError(r) {
    const e = (r.body && r.body.error) || '';
    let html;
    if (r.status === 401 || e === 'session_expired') {
      html = `<div class="ps-comp-notice err"><strong>Your session expired.</strong> Log in again to pull comps.<br><a class="ps-comp-btn-gold" style="display:inline-block;text-decoration:none;text-align:center" href="login.html">Log in</a></div>`;
    } else if (r.status === 403 && e === 'not_empire') {
      html = `<div class="ps-comp-notice"><strong>Comps are an Empire feature.</strong><br>Pull recorded sales, a value range and an ARV for any property, then send it straight to the Deal Analyzer.<br><a class="ps-comp-btn-gold" style="display:inline-block;text-decoration:none;text-align:center" href="dashboard.html#empire-banner">Unlock Empire</a></div>`;
    } else if (r.status === 402 || e === 'budget_cap') {
      html = `<div class="ps-comp-notice warn"><strong>Comp lookups are paused for this month.</strong> Cached reports still work — properties comped recently will still open.</div>`;
    } else if (r.status === 404) {
      html = `<div class="ps-comp-notice err"><strong>We couldn't find that address.</strong> Check the street number, street name, and ZIP, then try again.</div>`;
    } else if (r.status === 429 && e === 'member_limit') {
      html = `<div class="ps-comp-notice warn"><strong>You've reached this month's comp lookup limit.</strong> Cached reports still work.</div>`;
    } else if (r.status === 429) {
      html = `<div class="ps-comp-notice warn"><strong>Property data is busy right now.</strong> Wait a minute and try again.</div>`;
    } else {
      html = `<div class="ps-comp-notice err"><strong>Property data is temporarily unavailable.</strong> Try again in a few minutes. No lookup was charged for the failed attempt.</div>`;
    }
    els.body.innerHTML = html;
  }

  function renderAll() {
    renderHead();
    const resp = S.resp;
    const sectionErrs = Object.keys(resp.sectionErrors || {});
    const partial = sectionErrs.length
      ? `<div class="ps-comp-notice warn">Some data couldn't load (${sectionErrs.map(s => ({ subject: 'property record', sold: 'recorded sales', value: 'RentCast valuation' }[s] || s)).join(', ')}). What's shown below uses the data that did load.</div>`
      : (resp.noPublicRecord
        ? `<div class="ps-comp-notice">No public property record on file for this address (common for new construction). Valuation and comps below still use RentCast data.</div>`
        : '');
    els.body.innerHTML = `
      ${resp.demo ? '<div class="ps-comp-notice warn"><strong>Demo data.</strong> These are sample Crown Point, IN comps, shown for every address until live property data is turned on.</div>' : ''}
      ${partial}
      <section class="ps-comp-section" aria-label="Value range"><div id="ps-comp-summary"></div></section>
      <section class="ps-comp-section" aria-label="Comp filters">
        <div class="ps-comp-section-title"><span>Filters</span><span class="ps-comp-budget" id="ps-comp-budget"></span></div>
        <div class="ps-comp-filter-sheet" id="ps-comp-sheet"><div id="ps-comp-filters"></div></div>
      </section>
      <section class="ps-comp-section" id="ps-comp-ladder-wrap" aria-label="Find more comps"></section>
      <section class="ps-comp-section" aria-label="Comp map">
        <div class="ps-comp-section-title"><span>Map</span></div>
        <div class="ps-comp-map-wrap"><div class="ps-comp-map" id="ps-comp-map" role="img" aria-label="Map of the subject property and its comps"></div></div>
        <div class="ps-comp-legend"><span><i style="background:var(--c-gold)"></i>Subject</span><span><i style="background:var(--c-green)"></i>Very similar</span><span><i style="background:var(--c-yellow)"></i>Similar</span><span><i style="background:#9CA3AF"></i>Less similar</span><span><i style="border:2px solid #9CA3AF;background:transparent"></i>Excluded</span></div>
      </section>
      <section class="ps-comp-section" aria-label="Comparable sales">
        <div class="ps-comp-section-title"><span>Comparables</span><span class="ps-comp-budget" id="ps-comp-count"></span></div>
        <div id="ps-comp-table"></div>
      </section>
      <section class="ps-comp-section"><div id="ps-comp-how"></div></section>
      <button type="button" class="ps-comp-filters-toggle" id="ps-comp-filters-toggle" aria-controls="ps-comp-sheet" aria-expanded="false">Adjust filters</button>`;
    renderFilters();
    setupMap();
    refresh({ initial: true });
    const t = $('#ps-comp-filters-toggle');
    t.addEventListener('click', () => {
      const sheet = $('#ps-comp-sheet');
      const openNow = !sheet.classList.contains('open');
      sheet.classList.toggle('open', openNow);
      t.setAttribute('aria-expanded', String(openNow));
    });
  }

  // Everything that depends on the selection. Pure + fast (no network).
  function refresh(opts) {
    const r = report();
    S.report = r;
    renderSummary(r);
    renderLadder(r);
    renderTable(r);
    updateMap(r);
    renderHow(r);
    renderBudget();
    if (!(opts && opts.initial)) scheduleSave();
    els.live.textContent = r.arv ? `FORGE ARV ${money(r.arv)}, ${r.compCount} comps, ${r.confidence} confidence` : 'Not enough comps for an ARV';
    return r;
  }

  function renderSummary(r) {
    const avm = S.resp.avm || {};
    const last = S.resp.subject && S.resp.subject.lastSalePrice;
    const pts = [r.arv, r.arvLow, r.arvHigh, avm.price, avm.low, avm.high, last].filter(v => Number.isFinite(Number(v)) && Number(v) > 0).map(Number);
    let gauge = '';
    if (pts.length) {
      const lo = Math.min(...pts) * 0.97, hi = Math.max(...pts) * 1.03;
      const pct = v => (Number(v) - lo) / (hi - lo) * 100;
      const pos = v => pct(v).toFixed(2) + '%';
      // Keep labels inside the gauge near either end.
      const edge = v => pct(v) < 14 ? ' edge-l' : (pct(v) > 86 ? ' edge-r' : '');
      const rangeLo = avm.low || r.arvLow, rangeHi = avm.high || r.arvHigh;
      gauge = `
        <div class="ps-comp-gauge" role="img" aria-label="Value range from ${money(rangeLo)} to ${money(rangeHi)}, FORGE ARV ${money(r.arv)}">
          <div class="ps-comp-gauge-track">
            ${rangeLo && rangeHi ? `<div class="ps-comp-gauge-range" style="left:${pos(rangeLo)};width:calc(${pos(rangeHi)} - ${pos(rangeLo)})"></div>` : ''}
            ${last ? `<div class="ps-comp-mark last${edge(last)}" style="left:${pos(last)}"><div class="ps-comp-mark-dot"></div><div class="ps-comp-mark-label">Last sale ${moneyK(last)}</div></div>` : ''}
            ${avm.price ? `<div class="ps-comp-mark avm${edge(avm.price)}" style="left:${pos(avm.price)}"><div class="ps-comp-mark-dot"></div><div class="ps-comp-mark-label">RentCast ${moneyK(avm.price)}</div></div>` : ''}
            ${r.arv ? `<div class="ps-comp-mark arv${edge(r.arv)}" style="left:${pos(r.arv)}"><div class="ps-comp-mark-dot"></div><div class="ps-comp-mark-label">FORGE ARV ${moneyK(r.arv)}</div></div>` : ''}
          </div>
          <div class="ps-comp-gauge-ends"><span>${avm.low ? 'RentCast low ' + moneyK(avm.low) : 'Low ' + moneyK(r.arvLow)}</span><span>${avm.high ? 'RentCast high ' + moneyK(avm.high) : 'High ' + moneyK(r.arvHigh)}</span></div>
        </div>`;
    }
    $('#ps-comp-summary').innerHTML = `
      ${gauge}
      <div class="ps-comp-stats">
        <div class="ps-comp-stat arv"><div class="k">FORGE ARV</div><div class="v">${r.arv ? money(r.arv) : '—'}</div><div class="s">${r.arv ? `Range ${moneyK(r.arvLow)}–${moneyK(r.arvHigh)}` : 'Needs at least 1 included comp'}</div></div>
        <div class="ps-comp-stat"><div class="k">$ / sq ft</div><div class="v">${r.pricePerSqft ? '$' + r.pricePerSqft.toFixed(0) : '—'}</div></div>
        <div class="ps-comp-stat"><div class="k">Confidence</div><div class="v"><span class="ps-comp-conf ${esc(r.confidence)}">${esc(r.confidence)}</span></div></div>
        <div class="ps-comp-stat"><div class="k">Comps</div><div class="v">${r.compCount}</div><div class="s">RentCast ${avm.price ? moneyK(avm.price) : '—'}</div></div>
      </div>
      ${r.relaxedRules.length ? `<div class="ps-comp-relaxed">Rules relaxed: ${r.relaxedRules.map(esc).join('; ')}. Confidence lowered.</div>` : ''}
      <div class="ps-comp-disclaim">FORGE ARV is an estimate from recorded sales, not an appraisal. Listing comps are not verified sales. Coverage varies by market.</div>`;
  }

  const RADII = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5];
  const DAYS = [30, 60, 90, 180, 365];
  function renderFilters() {
    const f = S.filters;
    const opt = (vals, cur, fmt) => vals.map(v => `<option value="${v}" ${Number(cur) === v ? 'selected' : ''}>${fmt(v)}</option>`).join('');
    const subjType = (S.resp.subject && S.resp.subject.propertyType) || 'Same as subject';
    $('#ps-comp-filters').innerHTML = `
      <div class="ps-comp-filters">
        <label>Radius<select class="ps-comp-select" data-f="radius">${opt(RADII, f.radius, v => v + ' mi')}</select></label>
        <label>Sold within<select class="ps-comp-select" data-f="soldWithinDays">${opt(DAYS, f.soldWithinDays, v => v + ' days')}</select></label>
        <label>Beds ±<select class="ps-comp-select" data-f="bedsTol">${opt([0, 1, 2, 3], f.bedsTol, v => '±' + v)}</select></label>
        <label>Baths ±<select class="ps-comp-select" data-f="bathsTol">${opt([0, 1, 2], f.bathsTol, v => '±' + v)}</select></label>
        <label>Sq ft ±<select class="ps-comp-select" data-f="sqftTolPct">${opt([10, 15, 20, 25, 30, 40, 50], f.sqftTolPct, v => '±' + v + '%')}</select></label>
        <label>Type<select class="ps-comp-select" data-f="propertyType">
          <option value="" ${!f.propertyType ? 'selected' : ''}>${esc(subjType)}</option>
          ${['Single Family', 'Condo', 'Townhouse', 'Multi-Family', 'Manufactured'].filter(t => t !== subjType).map(t => `<option ${f.propertyType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
        <label>Comp count<select class="ps-comp-select" data-f="compCount">${opt([3, 4, 5, 6, 8, 10, 15, 20, 25], f.compCount, v => String(v))}</select></label>
        <label>Listing comps<select class="ps-comp-select" data-f="includeListings"><option value="0" ${!f.includeListings ? 'selected' : ''}>Exclude</option><option value="1" ${f.includeListings ? 'selected' : ''}>Include</option></select></label>
      </div>
      <div class="ps-comp-adj">
        <label for="ps-comp-adjrate">Size adjustment</label>
        <input type="range" id="ps-comp-adjrate" min="${E.ADJ_RATE_MIN}" max="${E.ADJ_RATE_MAX}" step="1" value="${S.adjustments.adjRate}" aria-describedby="ps-comp-adjrate-out">
        <output id="ps-comp-adjrate-out">$${S.adjustments.adjRate}/sq ft</output>
      </div>
      <details class="ps-comp-lines">
        <summary>Line-item adjustments (optional)</summary>
        <div class="ps-comp-lines-grid">
          <label class="ps-comp-field"><span>Per bedroom ($)</span><input class="ps-comp-input" data-a="perBed" inputmode="numeric" value="${S.adjustments.perBed || ''}" placeholder="0"></label>
          <label class="ps-comp-field"><span>Per bathroom ($)</span><input class="ps-comp-input" data-a="perBath" inputmode="numeric" value="${S.adjustments.perBath || ''}" placeholder="0"></label>
        </div>
      </details>
      <div class="ps-comp-filter-actions">
        <button type="button" class="ps-comp-link" id="ps-comp-reset">Reset to auto-selection</button>
        <span id="ps-comp-expand-slot"></span>
        <span id="ps-comp-refresh-slot"></span>
        <button type="button" class="ps-comp-btn-outline ps-comp-sheet-done" id="ps-comp-sheet-done">Done</button>
      </div>`;
    const root = $('#ps-comp-filters');
    root.querySelectorAll('select[data-f]').forEach(sel => sel.addEventListener('change', () => {
      const k = sel.dataset.f;
      if (k === 'propertyType') S.filters.propertyType = sel.value || null;
      else if (k === 'includeListings') S.filters.includeListings = sel.value === '1';
      else S.filters[k] = Number(sel.value);
      refresh();
    }));
    const rate = $('#ps-comp-adjrate');
    rate.addEventListener('input', () => {
      S.adjustments.adjRate = E.clampAdjRate(rate.value);
      $('#ps-comp-adjrate-out').textContent = '$' + S.adjustments.adjRate + '/sq ft';
      refresh();
    });
    root.querySelectorAll('input[data-a]').forEach(inp => inp.addEventListener('input', () => {
      S.adjustments[inp.dataset.a] = Number(inp.value.replace(/[^0-9.-]/g, '')) || 0;
      refresh();
    }));
    $('#ps-comp-reset').addEventListener('click', () => {
      S.manual = {}; S.ladder = []; S.filters = { ...E.DEFAULT_FILTERS };
      S.adjustments = { adjRate: E.ADJ_RATE_DEFAULT, perBed: 0, perBath: 0 };
      renderFilters(); refresh();
    });
    $('#ps-comp-sheet-done').addEventListener('click', () => { $('#ps-comp-sheet').classList.remove('open'); const t = $('#ps-comp-filters-toggle'); if (t) t.setAttribute('aria-expanded', 'false'); });
  }

  function budgetText(b, left) {
    if (!b) return '';
    if (b.paused) return 'Lookups paused for this month (cap reached)';
    if (b.freeLookupsLeft !== undefined && b.freeLookupsLeft !== null) {
      if (b.freeLookupsLeft > 0) return `${b.freeLookupsLeft} of ${b.included} free lookups left this month`;
      const cents = b.overage ? `$${Number(b.overage).toFixed(2)}` : '';
      return `Free lookups used — ${cents} each, $${Math.max(0, Math.round((b.cap - b.spend) * 100) / 100)} left of $${b.cap} cap`;
    }
    return left !== null ? `${left} lookups left this month` : '';
  }

  function renderBudget() {
    const slot = $('#ps-comp-expand-slot');
    const b = S.budget;
    const left = b && b.remainingLookups !== null && b.remainingLookups !== undefined ? b.remainingLookups : null;
    const budgetEl = $('#ps-comp-budget');
    if (budgetEl) budgetEl.textContent = S.resp.demo ? 'Demo — no lookups used' : budgetText(b, left);
    // Expand button only when the filters reach past what was pulled.
    const effective = E.applyLadder(S.filters, S.ladder);
    const needs = E.requiresNewPull(effective, S.pulled);
    if (slot) {
      slot.innerHTML = needs
        ? `<button type="button" class="ps-comp-btn-outline" id="ps-comp-expand" ${b && b.paused ? 'disabled' : ''}>Expand search (uses 1 lookup)</button> <span class="ps-comp-budget">${left !== null ? left + ' left' : ''}</span>`
        : '';
      const btn = $('#ps-comp-expand');
      if (btn) btn.addEventListener('click', () => expand(effective));
    }
    const rslot = $('#ps-comp-refresh-slot');
    if (rslot) {
      const cached = S.resp.cached && S.resp.cached.sold;
      rslot.innerHTML = (cached && !S.resp.demo) ? '<button type="button" class="ps-comp-link" id="ps-comp-refresh">Refresh sales data (uses 1 lookup)</button>' : '';
      const rb = $('#ps-comp-refresh');
      if (rb) rb.addEventListener('click', refreshSold);
    }
  }

  function renderLadder(r) {
    const wrap = $('#ps-comp-ladder-wrap');
    if (!wrap) return;
    if (!r.needsExpansion && !S.ladder.length) { wrap.innerHTML = ''; return; }
    const radius = r.filters.radius, days = r.filters.soldWithinDays;
    wrap.innerHTML = `
      <div class="ps-comp-notice warn">
        ${r.needsExpansion ? `<strong>Only ${r.eligibleCount} sold comp${r.eligibleCount === 1 ? '' : 's'} within ${radius} mi / ${days} days.</strong> At least 3 are needed for a reliable ARV. Widen the search one step at a time — each step lowers confidence.` : '<strong>Search widened.</strong> Undo a step to tighten it again.'}
        <div class="ps-comp-ladder">
          ${r.ladder.map(st => `
            <div class="ps-comp-step ${st.applied ? 'applied' : ''}">
              <span>${esc(st.label)}<br><span class="cost">${st.costsLookup ? 'Uses 1 lookup' : 'Free — uses data already pulled'}</span></span>
              <button type="button" class="ps-comp-btn-outline" data-step="${esc(st.id)}" aria-pressed="${st.applied}">${st.applied ? 'Undo' : 'Apply'}</button>
            </div>`).join('')}
        </div>
      </div>`;
    wrap.querySelectorAll('button[data-step]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.step;
      const step = r.ladder.find(s => s.id === id);
      if (S.ladder.includes(id)) S.ladder = S.ladder.filter(x => x !== id);
      else if (step && step.costsLookup) { expand(E.applyLadder(S.filters, S.ladder.concat(id)), id); return; }
      else S.ladder = S.ladder.concat(id);
      refresh();
    }));
  }

  const COLS = [
    { key: 'include', label: 'Use', sortable: false },
    { key: 'address', label: 'Address' },
    { key: 'distance', label: 'Mi', num: true },
    { key: 'date', label: 'Sold / status' },
    { key: 'price', label: 'Price', num: true },
    { key: 'ppsf', label: '$/sqft', num: true },
    { key: 'size', label: 'Bd/Ba/Sqft' },
    { key: 'similarity', label: 'Match', num: true },
    { key: 'adjustedPrice', label: 'Adjusted', num: true },
  ];

  function sortRows(rows) {
    const { key, dir } = S.sort;
    const m = dir === 'asc' ? 1 : -1;
    const val = row => key === 'date' ? (Date.parse(row.date) || 0) : key === 'size' ? (row.sqft || 0) : key === 'address' ? String(row.address || '') : row[key];
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * m;
    });
  }

  const REASON_TEXT = { listing: 'listing (enable listing comps)', 'no-price': 'no sale price', 'non-arms-length': "likely non-arm's-length", 'ppsf-outlier': '$/sqft outlier', radius: 'outside radius', 'sale-date': 'sold too long ago', 'property-type': 'different type', beds: 'beds', baths: 'baths', sqft: 'size' };

  function renderTable(r) {
    // Pin numbers: included comps first (1..N by similarity), then the other
    // eligible ones, then excluded — so a row and its pin always match and
    // the comps in the ARV are always #1–#N.
    const rank = {};
    const tier = row => (row.included ? 0 : row.eligible ? 1 : 2);
    r.rows.slice().sort((a, b) => tier(a) - tier(b) || b.similarity - a.similarity).forEach((row, i) => { rank[row.id] = i + 1; });
    S.rank = rank;
    const shownRows = sortRows(r.rows.filter(row => S.showExcluded || row.included || row.eligible));
    const hiddenCount = r.rows.length - r.rows.filter(row => row.included || row.eligible).length;
    $('#ps-comp-count').textContent = `${r.compCount} of ${r.rows.length} included`;
    const head = COLS.map(c => c.sortable === false
      ? `<th scope="col">${c.label}</th>`
      : `<th scope="col"><button type="button" data-sort="${c.key}" aria-sort="${S.sort.key === c.key ? (S.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">${c.label}</button></th>`).join('');
    const body = shownRows.map(row => {
      const sc = simClass(row.similarity);
      const status = row.source === 'recorded' ? shortDate(row.date) : `${esc(row.status || 'Listing')} · ${shortDate(row.date)}`;
      const reasons = !row.eligible ? `<span class="ps-comp-why">Out: ${row.reasons.map(x => REASON_TEXT[x] || x).join(', ')}</span>` : '';
      const adj = `<div class="ps-comp-adjcell">${row.totalAdjustment >= 0 ? '+' : '−'}$${Math.abs(row.totalAdjustment || 0).toLocaleString('en-US')} adj.</div>`;
      return `
        <tr data-id="${esc(row.id)}" class="${row.included ? '' : 'excluded'} ${S.focusId === row.id ? 'focus' : ''}" tabindex="-1">
          <td class="cell-toggle"><label class="ps-comp-hit"><input type="checkbox" class="ps-comp-toggle" data-toggle="${esc(row.id)}" ${row.included ? 'checked' : ''} aria-label="Include ${esc(row.address)}"></label></td>
          <td data-label="Address"><span class="ps-comp-idx ${sc}">${rank[row.id]}</span><span class="addr" title="${esc(row.address)}">${esc(streetOnly(row.address))}</span><br>
            <span class="ps-comp-badge ${row.source === 'recorded' ? 'rec' : 'lst'}">${row.source === 'recorded' ? 'Recorded sale' : 'Listing (unverified sale)'}</span>${reasons}</td>
          <td class="num" data-label="Distance">${row.distance === null || row.distance === undefined ? '—' : row.distance.toFixed(2)}</td>
          <td data-label="${row.source === 'recorded' ? 'Sold' : 'Status'}">${status}</td>
          <td class="num" data-label="Price">${money(row.price)}</td>
          <td class="num" data-label="$/sqft">${row.ppsf ? '$' + Math.round(row.ppsf) : '—'}</td>
          <td data-label="Bd/Ba/Sqft">${row.beds ?? '—'}/${row.baths ?? '—'}/${row.sqft ? Number(row.sqft).toLocaleString('en-US') : '—'}</td>
          <td class="num" data-label="Match">${Math.round(row.similarity * 100)}%</td>
          <td class="num" data-label="Adjusted"><strong>${money(row.adjustedPrice)}</strong>${adj}</td>
        </tr>`;
    }).join('');
    $('#ps-comp-table').innerHTML = `
      <div class="ps-comp-table-wrap">
        <table class="ps-comp-table"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="9">No comps match these filters.</td></tr>'}</tbody></table>
        ${hiddenCount ? `<button type="button" class="ps-comp-more" id="ps-comp-more" aria-expanded="${S.showExcluded}">${S.showExcluded ? 'Hide' : 'Show'} ${hiddenCount} excluded comp${hiddenCount === 1 ? '' : 's'}</button>` : ''}
      </div>`;
    const t = $('#ps-comp-table');
    t.querySelectorAll('input[data-toggle]').forEach(cb => cb.addEventListener('change', () => {
      S.manual[cb.dataset.toggle] = cb.checked;
      refresh();
      const again = $(`input[data-toggle="${CSS.escape(cb.dataset.toggle)}"]`);
      if (again) again.focus();
    }));
    t.querySelectorAll('button[data-sort]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      S.sort = { key: k, dir: S.sort.key === k && S.sort.dir === 'desc' ? 'asc' : 'desc' };
      renderTable(S.report);
    }));
    t.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('mouseenter', () => focusComp(tr.dataset.id, false));
      tr.addEventListener('mouseleave', () => focusComp(null, false));
    });
    const more = $('#ps-comp-more');
    if (more) more.addEventListener('click', () => { S.showExcluded = !S.showExcluded; renderTable(S.report); updateMap(S.report); });
  }

  function renderHow(r) {
    const inc = r.rows.filter(x => x.included);
    const lines = inc.map(c => `<li>${esc(c.address)}: ${money(c.price)} ${c.totalAdjustment >= 0 ? '+' : '−'} $${Math.abs(c.totalAdjustment).toLocaleString('en-US')} = <strong>${money(c.adjustedPrice)}</strong></li>`).join('');
    $('#ps-comp-how').innerHTML = `
      <details class="ps-comp-how">
        <summary>How we got this</summary>
        <div class="ps-comp-how-body">
          <p>Each comp's sale price is adjusted for size: <code>(subject sq ft − comp sq ft) × $${r.adjRate}</code>${S.adjustments.perBed || S.adjustments.perBath ? ', plus your per-bedroom / per-bathroom amounts' : ''}.</p>
          ${inc.length ? `<ol>${lines}</ol>` : '<p>No comps are included yet.</p>'}
          <p>FORGE ARV = the <strong>${r.method === 'mean' ? 'average (3 or fewer comps)' : 'median'}</strong> of the adjusted prices${r.arv ? ` = <strong>${money(r.arv)}</strong>` : ''}. Range = lowest to highest adjusted price.</p>
          <p>Confidence is <strong>${esc(r.confidence)}</strong>: High needs 3+ recorded sales within 1 mi / 90 days, all within ±10% of the median, with no rules relaxed${r.maxDeviationPct !== null ? `. The widest comp here is ${r.maxDeviationPct}% from the median` : ''}.</p>
          <p>Comps are ranked by similarity: 40% distance, 25% size, 15% beds/baths, 10% year built, 10% how recent, blended with RentCast's match score where it exists.</p>
        </div>
      </details>`;
  }

  // ── map ─────────────────────────────────────────────────────────────
  function setupMap() {
    if (compMap) { compMap.remove(); compMap = null; }
    if (typeof L === 'undefined') { const m = $('#ps-comp-map'); if (m) m.innerHTML = '<div style="padding:16px;font-size:12px;color:#9CA3AF">Map unavailable.</div>'; return; }
    const subj = S.resp.subject || {};
    compMap = L.map('ps-comp-map', { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { subdomains: 'abc', maxZoom: 19 }).addTo(compMap);
    compLayer = L.layerGroup().addTo(compMap);
    if (subj.lat && subj.lng) {
      compMap.setView([subj.lat, subj.lng], 14);
      L.marker([subj.lat, subj.lng], { icon: L.divIcon({ className: '', html: '<div class="ps-comp-star" aria-hidden="true">★</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000, keyboard: false })
        .addTo(compMap).bindTooltip('Subject property');
      radiusCircle = L.circle([subj.lat, subj.lng], { radius: 1609.34, color: '#C89B3C', weight: 1, opacity: 0.7, fillOpacity: 0.04, dashArray: '4 4' }).addTo(compMap);
    } else {
      compMap.setView([41.4189, -87.3653], 12);
      radiusCircle = null;
    }
    setTimeout(() => compMap && compMap.invalidateSize(), 260);
  }

  function updateMap(r) {
    if (!compMap || !compLayer) return;
    compLayer.clearLayers();
    markersById = {};
    const pts = [];
    r.rows.forEach(row => {
      if (!row.lat || !row.lng) return;
      if (!row.included && !row.eligible && !S.showExcluded) return;
      const cls = `ps-comp-pin ${simClass(row.similarity)} ${row.included ? '' : 'out'}`;
      const m = L.marker([row.lat, row.lng], { icon: L.divIcon({ className: '', html: `<div class="${cls}" data-pin="${esc(row.id)}">${S.rank[row.id]}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), title: row.address, riseOnHover: true });
      m.on('click', () => focusComp(row.id, true));
      m.addTo(compLayer);
      markersById[row.id] = m;
      if (row.included) pts.push([row.lat, row.lng]);
    });
    const subj = S.resp.subject || {};
    if (radiusCircle) radiusCircle.setRadius(r.filters.radius * 1609.34);
    if (subj.lat && subj.lng) pts.push([subj.lat, subj.lng]);
    if (!S.mapFitted && pts.length > 1) { compMap.fitBounds(pts, { padding: [24, 24], maxZoom: 16 }); S.mapFitted = true; }
  }

  function focusComp(id, scroll) {
    S.focusId = id;
    document.querySelectorAll('.ps-comp-pin.focus').forEach(p => p.classList.remove('focus'));
    document.querySelectorAll('.ps-comp-table tr.focus').forEach(tr => tr.classList.remove('focus'));
    if (!id) return;
    const pin = document.querySelector(`.ps-comp-pin[data-pin="${CSS.escape(id)}"]`);
    if (pin) pin.classList.add('focus');
    const tr = document.querySelector(`.ps-comp-table tr[data-id="${CSS.escape(id)}"]`);
    if (tr) { tr.classList.add('focus'); if (scroll) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else if (scroll && !S.showExcluded) { S.showExcluded = true; renderTable(S.report); focusComp(id, true); }
  }

  // ── paid actions (explicit buttons only) ─────────────────────────────
  async function expand(effectiveFilters, ladderId) {
    if (!S || !S.resp || S.busy) return;
    if (S.resp.demo) { alertInline('Demo mode — wider searches use the same sample data.'); if (ladderId) { S.ladder = S.ladder.concat(ladderId); refresh(); } return; }
    S.busy = true;
    const btn = $('#ps-comp-expand'); if (btn) { btn.disabled = true; btn.textContent = 'Expanding…'; }
    const r = await api('POST', { action: 'expand', reportId: S.resp.reportId, radius: effectiveFilters.radius, soldWithinDays: effectiveFilters.soldWithinDays });
    S.busy = false;
    if (r.status !== 200) { alertInline(r.status === 402 ? 'Comp lookups are paused for this month.' : 'Could not expand the search. No lookup was charged.'); renderBudget(); return; }
    const listings = S.resp.comps.filter(c => c.source === 'listing');
    S.resp.comps = E.mergeComps(r.body.comps || [], listings);
    S.pulled = r.body.pulled || S.pulled;
    if (ladderId) S.ladder = S.ladder.concat(ladderId);
    S.mapFitted = false;
    const b = await api('GET', { action: 'budget' });
    if (b.status === 200) S.budget = b.body;
    refresh();
  }

  async function refreshSold() {
    if (!S || S.busy) return;
    S.busy = true;
    const r = await api('POST', { action: 'comp', address: S.address, overrides: S.overrides, refresh: 'sold' });
    S.busy = false;
    if (r.status !== 200) { alertInline('Could not refresh. No lookup was charged.'); return; }
    const keep = { filters: S.filters, ladder: S.ladder, manual: S.manual, adjustments: S.adjustments };
    applyResponse(r.body);
    Object.assign(S, keep);
    renderFilters(); refresh();
  }

  function alertInline(msg) {
    const slot = $('#ps-comp-expand-slot');
    if (slot) slot.innerHTML = `<span class="ps-comp-budget" role="status">${esc(msg)}</span>`;
  }

  // ── background save (free) ───────────────────────────────────────────
  function selection() {
    return { manual: S.manual, ladder: S.ladder, filters: S.filters, adjustments: S.adjustments, pulled: S.pulled };
  }
  function scheduleSave() {
    if (!S || !S.resp || !S.resp.reportId) return;
    S.dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!S || !S.resp || !S.resp.reportId || !S.dirty) return;
    S.dirty = false;
    api('POST', { action: 'update', reportId: S.resp.reportId, selection: selection() }).catch(() => {});
  }
  // Buttons read their lead id from data attributes, so ids never pass
  // through an inline JS string. (A delegated document listener would miss
  // map-popup clicks: Leaflet stops click propagation inside popups.)
  function fromButton(btn) {
    if (btn) openLead(btn.getAttribute('data-comp-kind'), btn.getAttribute('data-comp-id'));
  }

  window.ForgeComps = { init, buttonFor, popupButton, openLead, fromButton, open, close, _state: () => S };
}());
