// netlify/functions/property-search.js
//
// Property Search backend — PropertyRadar-backed motivated-seller lead finder.
//
// Real-data mode requires PROPERTYRADAR_API_KEY as a Netlify environment
// variable (set on the paid-tier account). Until that key is set, every
// search request falls back to a small, clearly-labeled demo dataset
// (`demo: true` in the response) so the page renders and is clickable
// end-to-end before the key is configured.
//
// Verified against PropertyRadar's public developer docs and help center
// (Sept 2026): base URL, endpoint path, auth scheme, the Criteria array
// format, Purchase semantics, and the response field names used below are
// all confirmed. Two things remain unverified and are flagged inline:
//   1. The exact Criteria field name(s) for free-text location search
//      (ZipFive is confirmed; City/State are a reasonable but unconfirmed
//      guess for non-zip input).
//   2. Whether Purchase=0 returns full preview data or a count only —
//      PropertyRadar's own docs disagree with each other on this. Test
//      first with Fields limited to ["RadarID"], which is confirmed free
//      regardless of Purchase, before trusting a wider field list.
//   3. Whether multiple Criteria entries are ANDed or ORed together when
//      more than one play is selected at once — assumed AND (narrowing)
//      below, not confirmed.
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

// Maps FORGE's Play ids to PropertyRadar Criteria entries. PropertyRadar's
// Criteria parameter is an ARRAY of { name, value } objects, not a flat
// object — confirmed against PropertyRadar's Criteria Reference docs
// (Sept 2026). Field names below are confirmed real PropertyRadar criteria.
const PLAY_DEFINITIONS = {
  prefore:       { label: 'Pre-Foreclosure', radarCriteria: [{ name: 'inForeclosure', value: [1] }] },
  absentee:      { label: 'Absentee Owners', radarCriteria: [{ name: 'isSameMailingOrExempt', value: [0] }] },
  highequity:    { label: 'High-Equity', radarCriteria: [{ name: 'EquityPercent', value: [[50, null]] }] },
  vacant:        { label: 'Vacant', radarCriteria: [{ name: 'isSiteVacant', value: [1] }] },
  taxdelinquent: { label: 'Tax Delinquent', radarCriteria: [{ name: 'inTaxDelinquency', value: [1] }] },
  probate:       { label: 'Probate', radarCriteria: [{ name: 'inProbateProperty', value: [1] }] },
  // Divorce is a real PropertyRadar play but its data quality/coverage has
  // NOT been verified for FORGE's use case (flagged Sept 2026) — ships in
  // the UI as an explicit "verify data" item, not a fully trusted category.
  divorce:       { label: 'Divorce', radarCriteria: [{ name: 'inDivorce', value: [1] }] },
};

// Fields requested from PropertyRadar on every live search. Names confirmed
// against PropertyRadar's Properties response schema (Sept 2026).
const PROPERTYRADAR_FIELDS = [
  'RadarID', 'Address', 'City', 'State', 'ZipFive',
  'Latitude', 'Longitude',
  'Owner', 'OwnerFirstName', 'OwnerLastName',
  'EquityPercent', 'AvailableEquity', 'AVM',
];

const PROPERTYRADAR_API_BASE = 'https://api.propertyradar.com/v1'; // Confirmed correct: PropertyRadar's endpoint reference documents POST /v1/properties off base https://api.propertyradar.com

function isLiveModeEnabled() {
  return !!process.env.PROPERTYRADAR_API_KEY;
}

// --- Demo fallback data (used until a real API key is configured) ---
// `plays` is an array, not a single value — a property can genuinely satisfy
// more than one lead type at once (e.g. a pre-foreclosure that's also
// high-equity, or a vacant property that's also pre-foreclosure), and the
// UI now surfaces every matching tag instead of forcing one bucket per lead.
const DEMO_POINTS = [
  { addr: '412 W Joliet St, Crown Point, IN 46307', lat: 41.4235, lng: -87.3711, plays: ['prefore'], owner: 'M. Delgado', equity: 89 },
  { addr: '2107 Delaware Pkwy, Crown Point, IN 46307', lat: 41.4102, lng: -87.3599, plays: ['taxdelinquent'], owner: 'R. Nowak', equity: 34 },
  { addr: '9541 Randolph St, Crown Point, IN 46307', lat: 41.4310, lng: -87.3480, plays: ['prefore', 'vacant'], owner: 'Unknown', equity: 21 },
  { addr: '1188 S Court St, Crown Point, IN 46307', lat: 41.4050, lng: -87.3820, plays: ['absentee'], owner: 'J. Whitfield', equity: 58 },
  { addr: '733 N Main St, Crown Point, IN 46307', lat: 41.4278, lng: -87.3602, plays: ['prefore', 'highequity'], owner: 'T. Alvarez', equity: 112 },
  { addr: '5502 Broadway, Crown Point, IN 46307', lat: 41.4155, lng: -87.3455, plays: ['taxdelinquent'], owner: 'S. Krueger', equity: 27 },
  { addr: '861 E 93rd Ave, Crown Point, IN 46307', lat: 41.4330, lng: -87.3750, plays: ['absentee'], owner: 'D. Okafor', equity: 45 },
  { addr: '3390 Ross Township Rd, Crown Point, IN 46307', lat: 41.4400, lng: -87.3450, plays: ['highequity'], owner: 'L. Chen', equity: 158 },
  { addr: '2214 Franciscan Dr, Crown Point, IN 46307', lat: 41.4290, lng: -87.3550, plays: ['highequity'], owner: 'P. Osei', equity: 141 },
  { addr: '77 N Court St, Crown Point, IN 46307', lat: 41.4120, lng: -87.3900, plays: ['probate'], owner: 'Estate of R. Hayes', equity: 16 },
  { addr: '990 E 101st Ave, Crown Point, IN 46307', lat: 41.4060, lng: -87.3400, plays: ['absentee', 'taxdelinquent'], owner: 'K. Bianchi', equity: 52 },
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

// Turns FORGE's free-text location input into PropertyRadar Criteria.
// CONFIRMED live (Sept 22, 2026): ZipFive works cleanly (zero-error test
// calls). The state criteria name is confirmed 'DefaultState' (not 'State'
// as originally guessed) from a live 400 error: "[DefaultState] must be one
// of [AL|AK|AZ|...]" — it requires a clean 2-letter USPS code, so we now
// validate against a known list and strip any trailing zip text before
// using it, instead of passing whatever followed the comma. 'City' as a
// criteria name has not errored in testing but is still not independently
// confirmed as effective (it could be silently ignored).
const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
]);

function buildLocationCriteria(location) {
  const trimmed = (location || '').trim();
  if (!trimmed) return [];

  const zipMatch = trimmed.match(/\b\d{5}\b/);
  if (zipMatch) {
    return [{ name: 'ZipFive', value: [Number(zipMatch[0])] }];
  }

  const withoutZip = trimmed.replace(/\b\d{5}(-\d{4})?\b/, '').trim();
  const parts = withoutZip.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[0];
    const stateToken = parts[1].split(/\s+/)[0].toUpperCase();
    if (US_STATE_CODES.has(stateToken)) {
      return [
        { name: 'City', value: [city] },
        { name: 'DefaultState', value: [stateToken] },
      ];
    }
    return [{ name: 'City', value: [city] }];
  }
  return [{ name: 'City', value: [parts[0]] }];
}

// --- Real PropertyRadar call ---
async function searchPropertyRadar(location, playIds) {
  const criteria = buildLocationCriteria(location);
  playIds.forEach(id => {
    const def = PLAY_DEFINITIONS[id];
    if (def) criteria.push(...def.radarCriteria);
  });

  // CONFIRMED live (Sept 22, 2026 real API response): PropertyRadar rejects
  // Purchase/Fields as JSON body fields — they must be URL query params.
  // Criteria stays in the JSON body.
  //
  // CONFIRMED live (Sept 22, 2026): Purchase=0 returns totalResultCount (a
  // real match count, e.g. 22363 for a High-Equity search) but resultCount
  // is always 0 and totalCost is always 0 — it's a count/cost preview only,
  // it never returns actual property records. Getting real data requires
  // Purchase=1, which PropertyRadar bills per record returned
  // (non-refundable). TEMPORARY: Limit=1 caps this to a single record for
  // controlled verification — remove/raise this once the field mapping is
  // confirmed against a real record and John has decided on a production
  // limit. Do not remove the Limit cap without explicit sign-off.
  const qs = new URLSearchParams({
    Purchase: '1',
    Limit: '1',
    Fields: PROPERTYRADAR_FIELDS.join(','),
  });

  const resp = await fetch(`${PROPERTYRADAR_API_BASE}/properties?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PROPERTYRADAR_API_KEY}`,
    },
    body: JSON.stringify({
      Criteria: criteria,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`PropertyRadar API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  // TEMP DEBUG (remove after verification pass): log the raw response shape
  // and first result so we can confirm real PropertyRadar field names
  // against what this code expects.
  console.log('PROPERTYRADAR_DEBUG top-level keys:', Object.keys(data));
  console.log('PROPERTYRADAR_DEBUG counts:', JSON.stringify({
    resultCount: data.resultCount,
    totalResultCount: data.totalResultCount,
    totalCost: data.totalCost,
    quantityFreeRemaining: data.quantityFreeRemaining,
    resultsArrayLength: Array.isArray(data.results) ? data.results.length : 'not an array',
  }));
  console.log('PROPERTYRADAR_DEBUG first raw result:', JSON.stringify((data.results || [])[0] || null));
  const rawResults = data.results || [];

  // NOTE: a single combined call can't tell us which of the *requested*
  // plays a given returned property actually satisfies when more than one
  // play is selected at once — multiple Criteria entries are assumed to be
  // ANDed together (narrowing to properties matching ALL selected plays),
  // which is NOT confirmed against a live response. Tagging every result
  // with the full requested play list is a placeholder for the single-play
  // case; for multi-play search, issue one call per play and merge results
  // by RadarID so a property matching two plays picks up both tags.
  return rawResults.map((r, i) => ({
    id: r.RadarID || `pr-${i}`,
    address: r.Address || 'Unknown address',
    lat: r.Latitude ?? null,
    lng: r.Longitude ?? null,
    playIds: playIds.length ? playIds : ['prefore'],
    owner: r.Owner || [r.OwnerFirstName, r.OwnerLastName].filter(Boolean).join(' ') || null,
    equity: r.AvailableEquity != null ? Math.round(r.AvailableEquity / 1000) : null,
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

      // Stage 2 CRM handoff — mirrors saved-deals.js's add_to_pipeline: a
      // saved lead means "I want to keep this," sending it to the CRM means
      // "I'm actively working this deal." Creates a real deal, links a
      // seller contact when we know the owner's name, and leaves a note so
      // the lead-type tags and equity estimate aren't lost once it's just
      // another CRM deal.
      if (payload.action === 'send_to_crm') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const { data: saved, error: fetchError } = await supabase
          .from('property_search_saves')
          .select('*')
          .eq('id', id)
          .eq('memberstack_id', memberId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (!saved) return json(404, { error: 'Saved lead not found' });

        if (saved.crm_deal_id) {
          return json(400, { error: 'This lead has already been sent to the CRM' });
        }

        // Property Search leads (pre-foreclosure, absentee, tax delinquent,
        // probate, etc.) are motivated-seller leads — 'wholesale' is the
        // right default deal_type; the member can change it in the CRM
        // once they know how they actually want to work the deal.
        const { data: crmDeal, error: crmError } = await supabase
          .from('deals')
          .insert({
            memberstack_id: memberId,
            property_address: saved.address,
            deal_type: 'wholesale',
            stage: 'New Lead',
          })
          .select()
          .single();
        if (crmError) throw crmError;

        // Link a seller contact when we actually have a name — PropertyRadar
        // (and the demo fallback) sometimes returns 'Unknown' for skip-traced
        // owners, which isn't a real contact worth creating.
        if (saved.owner && saved.owner.trim() && saved.owner.trim().toLowerCase() !== 'unknown') {
          const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .insert({
              memberstack_id: memberId,
              name: saved.owner.trim(),
              type: 'seller',
            })
            .select()
            .single();
          if (contactError) throw contactError;

          const { error: linkError } = await supabase
            .from('deal_contacts')
            .insert({ deal_id: crmDeal.id, contact_id: contact.id, role: 'seller' });
          if (linkError) throw linkError;
        }

        const tagLabels = {
          prefore: 'Pre-Foreclosure', absentee: 'Absentee Owners', highequity: 'High-Equity',
          vacant: 'Vacant', taxdelinquent: 'Tax Delinquent', probate: 'Probate', divorce: 'Divorce',
        };
        const tags = (saved.play_id || '').split(',').filter(Boolean).map(t => tagLabels[t] || t).join(', ');
        const noteBody = `Sent from Property Search.${tags ? ` Lead type: ${tags}.` : ''}${saved.equity ? ` Est. equity: $${saved.equity}K.` : ''}`;
        const { error: noteError } = await supabase
          .from('notes')
          .insert({ memberstack_id: memberId, deal_id: crmDeal.id, body: noteBody, created_by: 'student' });
        if (noteError) throw noteError;

        const { error: updateError } = await supabase
          .from('property_search_saves')
          .update({ crm_deal_id: crmDeal.id })
          .eq('id', id)
          .eq('memberstack_id', memberId);
        if (updateError) throw updateError;

        return json(200, { crmDeal });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('property-search error:', err);
    return json(500, { error: 'Server error' });
  }
};
