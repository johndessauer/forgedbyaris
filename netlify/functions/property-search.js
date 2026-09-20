// netlify/functions/property-search.js
//
// Property Search backend — PropertyRadar-backed motivated-seller lead finder.
//
// Real-data mode requires PROPERTYRADAR_API_KEY as a Netlify environment
// variable, plus PROPERTYRADAR_PLAN_TIER (informational only, not required
// by the API itself) once the trial account is confirmed. Until that key
// is set, every search request falls back to a small, clearly-labeled demo
// dataset (`demo: true` in the response) so the page renders and is
// clickable end-to-end before the vendor account exists.
//
// IMPORTANT: the exact PropertyRadar endpoint path, request shape, and
// response field names below are built from their public pricing/API
// marketing pages and help-center articles, NOT from their live API
// reference docs (no account access existed at the time this was written).
// Everything under buildPropertyRadarRequest() and normalizePropertyRadarResult()
// is marked TODO-VERIFY and must be checked against a real API response
// during the free trial before this is trusted for production traffic.
//
// Routes:
//   GET  ?action=search&location=<free text>&plays=<comma-separated play ids>
//        -> { results: [...], demo: boolean }
//   GET  ?action=list
//        -> { leads: [...] }  (this member's saved leads)
//   POST { action: 'save', leadId, address, playId, lat, lng, owner, equity }
//        -> { saved: true }
//   POST { action: 'delete', id }
//        -> { deleted: true }

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

// Maps FORGE's Play ids to PropertyRadar filter criteria.
// TODO-VERIFY: confirm exact PropertyRadar Criteria API field names/values
// during the trial — these are best-guess mappings from their public
// "Lead Gen Plays" naming, not confirmed API parameter names.
const PLAY_DEFINITIONS = {
  prefore:       { label: 'Pre-Foreclosure', radarCriteria: { TransferType: 'PreForeclosure' } },
  absentee:      { label: 'Absentee Owners', radarCriteria: { OwnerOccupied: false } },
  highequity:    { label: 'High-Equity', radarCriteria: { EquityPercent: { min: 50 } } },
  vacant:        { label: 'Vacant', radarCriteria: { Vacant: true } },
  taxdelinquent: { label: 'Tax Delinquent', radarCriteria: { TaxDelinquent: true } },
  probate:       { label: 'Probate', radarCriteria: { Probate: true } },
  // Divorce is a real PropertyRadar play but its data quality/coverage has
  // NOT been verified for FORGE's use case (flagged Sept 2026) — ships in
  // the UI as an explicit "verify data" item, not a fully trusted category.
  divorce:       { label: 'Divorce', radarCriteria: { Divorce: true } },
};

const PROPERTYRADAR_API_BASE = 'https://api.propertyradar.com/v1'; // TODO-VERIFY exact base URL against real API docs

function isLiveModeEnabled() {
  return !!process.env.PROPERTYRADAR_API_KEY;
}

// --- Demo fallback data (used until a real API key is configured) ---
// `plays` is an array, not a single value — a property can genuinely satisfy
// more than one lead type at once (e.g. a pre-foreclosure that's also
// high-equity, or a vacant property that's also pre-foreclosure), and the
// UI now surfaces every matching tag instead of forcing one bucket per lead.
const DEMO_POINTS = [
  { addr: '412 W Joliet St', lat: 41.4235, lng: -87.3711, plays: ['prefore'], owner: 'M. Delgado', equity: 89 },
  { addr: '2107 Delaware Pkwy', lat: 41.4102, lng: -87.3599, plays: ['taxdelinquent'], owner: 'R. Nowak', equity: 34 },
  { addr: '9541 Randolph St', lat: 41.4310, lng: -87.3480, plays: ['prefore', 'vacant'], owner: 'Unknown', equity: 21 },
  { addr: '1188 S Court St', lat: 41.4050, lng: -87.3820, plays: ['absentee'], owner: 'J. Whitfield', equity: 58 },
  { addr: '733 N Main St', lat: 41.4278, lng: -87.3602, plays: ['prefore', 'highequity'], owner: 'T. Alvarez', equity: 112 },
  { addr: '5502 Broadway', lat: 41.4155, lng: -87.3455, plays: ['taxdelinquent'], owner: 'S. Krueger', equity: 27 },
  { addr: '861 E 93rd Ave', lat: 41.4330, lng: -87.3750, plays: ['absentee'], owner: 'D. Okafor', equity: 45 },
  { addr: '3390 Ross Township Rd', lat: 41.4400, lng: -87.3450, plays: ['highequity'], owner: 'L. Chen', equity: 158 },
  { addr: '2214 Franciscan Dr', lat: 41.4290, lng: -87.3550, plays: ['highequity'], owner: 'P. Osei', equity: 141 },
  { addr: '77 N Court St', lat: 41.4120, lng: -87.3900, plays: ['probate'], owner: 'Estate of R. Hayes', equity: 16 },
  { addr: '990 E 101st Ave', lat: 41.4060, lng: -87.3400, plays: ['absentee', 'taxdelinquent'], owner: 'K. Bianchi', equity: 52 },
];

function buildDemoResults(playIds) {
  const wanted = new Set(playIds.length ? playIds : Object.keys(PLAY_DEFINITIONS));
  return DEMO_POINTS
    .filter(p => p.plays.some(pl => wanted.has(pl)))
    .map((p, i) => ({
      id: 'demo-' + i,
      address: p.addr,
      lat: p.lat,
      lng: p.lng,
      playIds: p.plays,
      owner: p.owner,
      equity: p.equity,
    }));
}

// --- Real PropertyRadar call (structured, untested against a live account) ---
async function searchPropertyRadar(location, playIds) {
  const criteria = [];
  playIds.forEach(id => {
    const def = PLAY_DEFINITIONS[id];
    if (def) criteria.push(def.radarCriteria);
  });

  // TODO-VERIFY: confirm exact endpoint path, auth header format
  // (PropertyRadar docs reference API-key auth but the header name/scheme
  // was not visible without an account), and request body shape.
  const resp = await fetch(`${PROPERTYRADAR_API_BASE}/properties`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PROPERTYRADAR_API_KEY}`,
    },
    body: JSON.stringify({
      Location: location,
      Criteria: criteria,
      Purchase: 0, // preview/count-only pass first — see cost-control note below
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PropertyRadar API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  // TODO-VERIFY: confirm the real response field names (this normalization
  // is a best guess — Address/Latitude/Longitude/Owner/EquityPercent are
  // plausible PropertyRadar field names based on their public docs, not
  // confirmed from an actual response payload).
  const rawResults = data.results || data.Results || [];
  // TODO-VERIFY: this single combined call can't currently tell us which of
  // the *requested* plays a given returned property actually satisfies (that
  // depends on whether PropertyRadar ANDs or ORs multiple criteria objects
  // together, which is itself unverified — see the criteria-building comment
  // above). Tagging every result with the full requested play list is the
  // honest placeholder until a live account confirms the real behavior;
  // don't read this as "this property matches all of these." Proper fix once
  // there's account access: either issue one PropertyRadar call per selected
  // play and merge results by RadarID (so a property returned under two
  // separate play calls picks up both tags), or use whatever field in a real
  // response actually indicates which criteria matched.
  return rawResults.map((r, i) => ({
    id: r.RadarID || r.id || `pr-${i}`,
    address: r.Address || r.SitusAddress || 'Unknown address',
    lat: r.Latitude ?? r.lat ?? null,
    lng: r.Longitude ?? r.lng ?? null,
    playIds: playIds.length ? playIds : ['prefore'],
    owner: r.OwnerName || r.Owner || null,
    equity: r.EquityPercent ? Math.round((r.EquityPercent / 100) * (r.EstimatedValue || 0) / 1000) : null,
  }));
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let memberId;
  try {
    memberId = await verifyMember(event);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const action = params.action;

      if (action === 'search') {
        const location = (params.location || '').trim();
        const playIds = (params.plays || '').split(',').filter(Boolean);

        if (!isLiveModeEnabled()) {
          return json(200, { results: buildDemoResults(playIds), demo: true });
        }

        try {
          const results = await searchPropertyRadar(location, playIds);
          return json(200, { results, demo: false });
        } catch (err) {
          console.error('PropertyRadar live search failed, falling back to demo data:', err);
          return json(200, { results: buildDemoResults(playIds), demo: true, liveError: 'Live data temporarily unavailable.' });
        }
      }

      if (action === 'list') {
        const { data, error } = await supabase
          .from('property_search_saves')
          .select('*')
          .eq('memberstack_id', memberId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json(200, { leads: data || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'save') {
        const { leadId, address, playIds, lat, lng, owner, equity } = payload;
        if (!leadId) return json(400, { error: 'leadId is required' });

        // play_id is a single text column (see add-property-search-saves-table.sql)
        // but a lead can now carry more than one matching tag — flatten to a
        // comma-joined string (e.g. "prefore,highequity") rather than losing
        // every tag past the first. Revisit if this ever needs to be queried
        // by individual tag.
        const playIdValue = Array.isArray(playIds) ? playIds.join(',') : (playIds || null);

        const { data, error } = await supabase
          .from('property_search_saves')
          .insert({
            memberstack_id: memberId,
            lead_id: leadId,
            address: address || null,
            play_id: playIdValue,
            lat: lat || null,
            lng: lng || null,
            owner: owner || null,
            equity: equity || null,
          })
          .select()
          .single();
        if (error) throw error;
        return json(201, { saved: true, lead: data });
      }

      if (payload.action === 'delete') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase
          .from('property_search_saves')
          .delete()
          .eq('id', id)
          .eq('memberstack_id', memberId);
        if (error) throw error;
        return json(200, { deleted: true });
      }

      // NOT implemented yet — fast-follow, per the phased build plan
      // (Property Search Stage 2: CRM handoff). Mirrors saved-deals.js's
      // add_to_pipeline pattern once it's built — same shape, same
      // memberstack_id scoping, writing into the existing contacts/deals
      // tables from schema.sql.
      if (payload.action === 'send_to_crm') {
        return json(501, { error: 'CRM handoff is not implemented yet — Stage 2 fast-follow.' });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('property-search error:', err);
    return json(500, { error: 'Server error' });
  }
};
