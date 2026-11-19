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
// CONFIRMED against a real live PropertyRadar account and a real returned
// record (Sept 22, 2026): base URL, endpoint path, auth scheme, the
// Criteria array format, Purchase/Fields as query params (not JSON body
// fields), the DefaultState/ZipFive criteria names, and every response
// field mapped below (RadarID, Address, City, State, ZipFive, Latitude,
// Longitude, Owner/OwnerFirstName/OwnerLastName, EquityPercent,
// AvailableEquity, AVM). Purchase=0 is confirmed to return totalResultCount
// (a real match count) but never actual records (resultCount/results are
// always 0/empty) — real data requires Purchase=1, which bills per record
// but this account carries a free allotment (quantityFreeRemaining) that
// has absorbed every test so far at $0 cost.
//
// Still unverified live: whether 'City' alone (no state) actually narrows
// results. Every real-data test so far used a zip and took the ZipFive branch.
// Multiple Criteria objects are ANDed (documented on the criteria guide).
// Values inside one criterion are ORed. There is no cross-criterion OR.
//
// Routes:
//   GET  ?action=search&location=&plays=&ptypes=&pmode=&match=&emin=&emax=&start=
//        -> { results: [...], total, demo }   Purchase=1, page of 25, spend-capped
//   GET  ?action=count&location=&plays=&ptypes=&pmode=&match=&emin=&emax=
//        -> { count, link, demo, leadTypes }  Purchase=0, no records, no cap charge
//   GET  ?action=list
//        -> { leads: [...] }  (this member's saved leads)
//   POST { action: 'save', leadId, address, playId, lat, lng, owner, equity }
//        -> { saved: true }
//   POST { action: 'delete', id }
//        -> { deleted: true }

const { enforceMembership } = require('./_Lib/membership');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');
const { compileSearch, labelFor, LEAD_CRITERIA } = require('./_Lib/lead-criteria');
const spend = require('./_Lib/property-search-spend');

// Fields requested from PropertyRadar on every live search. Names confirmed
// against PropertyRadar's Properties response schema (Sept 2026).
const PROPERTYRADAR_FIELDS = [
  'RadarID', 'Address', 'City', 'State', 'ZipFive',
  'Latitude', 'Longitude',
  'Owner', 'OwnerFirstName', 'OwnerLastName',
  'EquityPercent', 'AvailableEquity', 'AVM',
  // Property characteristics added Sept 22, 2026. Field names below are
  // NOT yet confirmed against a real payload (everything above this line
  // was speculative too, until it was tested) — treat the first live
  // search after this ships as the verification step, same as before.
  'PType', 'Beds', 'Baths', 'SqFt', 'YearBuilt', 'LotSizeAcres', 'Stories',
  'Pool', 'GarageSize',
];

const PROPERTYRADAR_API_BASE = 'https://api.propertyradar.com/v1'; // Confirmed correct: PropertyRadar's endpoint reference documents POST /v1/properties off base https://api.propertyradar.com

// Production page size. John capped each purchase at 25 records
// (Sept 22, 2026). "Load 25 More" requests the next window with Start.
const PAGE_SIZE = 25;

function pageOf(list, start) {
  const offset = Math.max(0, Number(start) || 0);
  return list.slice(offset, offset + PAGE_SIZE);
}

function isLiveModeEnabled() {
  return !!process.env.PROPERTYRADAR_API_KEY;
}

// --- Demo fallback data (used until a real API key is configured) ---
// `plays` is an array, not a single value — a property can genuinely satisfy
// more than one lead type at once (e.g. a pre-foreclosure that's also
// high-equity, or a vacant property that's also pre-foreclosure), and the
// UI now surfaces every matching tag instead of forcing one bucket per lead.
const DEMO_POINTS = [
  { addr: '412 W Joliet St, Crown Point, IN 46307', lat: 41.4235, lng: -87.3711, plays: ['prefore', 'zombie'], owner: 'M. Delgado', equity: 89 },
  { addr: '2107 Delaware Pkwy, Crown Point, IN 46307', lat: 41.4102, lng: -87.3599, plays: ['taxdelinquent'], owner: 'R. Nowak', equity: 34 },
  { addr: '9541 Randolph St, Crown Point, IN 46307', lat: 41.4310, lng: -87.3480, plays: ['prefore', 'vacant', 'zombie'], owner: 'Unknown', equity: 21 },
  { addr: '1188 S Court St, Crown Point, IN 46307', lat: 41.4050, lng: -87.3820, plays: ['absentee', 'bored', 'longterm', 'freeclear'], owner: 'J. Whitfield', equity: 58 },
  { addr: '733 N Main St, Crown Point, IN 46307', lat: 41.4278, lng: -87.3602, plays: ['prefore', 'highequity'], owner: 'T. Alvarez', equity: 112 },
  { addr: '5502 Broadway, Crown Point, IN 46307', lat: 41.4155, lng: -87.3455, plays: ['taxdelinquent', 'lowequity'], owner: 'S. Krueger', equity: 27 },
  { addr: '861 E 93rd Ave, Crown Point, IN 46307', lat: 41.4330, lng: -87.3750, plays: ['absentee', 'cashbuyer'], owner: 'D. Okafor', equity: 45 },
  { addr: '3390 Ross Township Rd, Crown Point, IN 46307', lat: 41.4400, lng: -87.3450, plays: ['highequity'], owner: 'L. Chen', equity: 158 },
  { addr: '2214 Franciscan Dr, Crown Point, IN 46307', lat: 41.4290, lng: -87.3550, plays: ['highequity', 'listing'], owner: 'P. Osei', equity: 141 },
  { addr: '77 N Court St, Crown Point, IN 46307', lat: 41.4120, lng: -87.3900, plays: ['probate', 'inherited'], owner: 'Estate of R. Hayes', equity: 16 },
  { addr: '990 E 101st Ave, Crown Point, IN 46307', lat: 41.4060, lng: -87.3400, plays: ['absentee', 'taxdelinquent', 'activeinvestor'], owner: 'K. Bianchi', equity: 52 },
  { addr: '1402 Taft St, Crown Point, IN 46307', lat: 41.4180, lng: -87.3660, plays: ['flipped'], owner: 'A. Berger', equity: 40 },
  { addr: '608 Maple Ln, Crown Point, IN 46307', lat: 41.4210, lng: -87.3520, plays: ['upsidedown'], owner: 'C. Walsh', equity: 8 },
  { addr: '77 N Grant St, Crown Point, IN 46307', lat: 41.4165, lng: -87.3780, plays: ['foreclosure'], owner: 'Lender REO', equity: 19 },
  { addr: '2550 E 93rd Ave, Crown Point, IN 46307', lat: 41.4340, lng: -87.3410, plays: ['foreactivity'], owner: 'M. Patel', equity: 33 },
  { addr: '15 S Main St, Crown Point, IN 46307', lat: 41.4144, lng: -87.3655, plays: ['divorce'], owner: 'J. and R. Cole', equity: 47 },
];

function buildDemoResults(playIds) {
  const wanted = playIds.length ? playIds : Object.keys(LEAD_CRITERIA);
  return DEMO_POINTS
    .filter(p => wanted.every(pl => p.plays.includes(pl)))
    .map((p, i) => ({
      id: 'demo-' + i,
      address: p.addr,
      lat: p.lat,
      lng: p.lng,
      playIds: p.plays,
      owner: p.owner,
      equity: p.equity,
      details: {},
      mapUrl: buildMapUrl(p.lat, p.lng),
      zillowUrl: buildZillowUrl(p.addr),
    }));
}

// "Pics" — PropertyRadar has no photo/image data in its API or product
// (confirmed against its own docs), and a Google Street View Static API
// integration would require a brand-new user-provided credential. Simplest
// no-new-credential option: plain link-outs built from data we already
// have. No extra API call, no extra cost, no double-billing risk.
function buildMapUrl(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildZillowUrl(addressFull) {
  if (!addressFull || !addressFull.trim()) return null;
  const slug = addressFull.trim().replace(/,/g, '').replace(/\s+/g, '-');
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`;
}

// --- Real PropertyRadar call ---
// purchase=false is the count preview (Purchase=0): totalResultCount, no
// records, no charge. purchase=true buys up to `limit` records.
async function searchPropertyRadar(criteria, playIds, start, { purchase, limit }) {
  // CONFIRMED live (Sept 22, 2026 real API response): PropertyRadar rejects
  // Purchase/Fields as JSON body fields — they must be URL query params.
  // Criteria stays in the JSON body.
  //
  // Purchase=1 is required to get actual property records back (Purchase=0
  // only ever returns a count/cost preview — confirmed via a live test that
  // showed totalResultCount:22363 with resultCount/totalCost stuck at 0).
  // PropertyRadar bills per record returned and it's non-refundable, though
  // this account has a free allotment (quantityFreeRemaining) that has
  // covered every record returned so far at $0 cost. Limit=25 is the
  // production cap John set (Sept 22, 2026). The spend safeguard can lower
  // Limit further so a page cannot cross the daily or monthly cap.
  //
  // Start is CONFIRMED against PropertyRadar's own live API reference docs
  // (developers.propertyradar.com, Sept 22, 2026): "Offset from which to
  // begin returning records. Used for paging." Powers the "Load 25 more"
  // button — each additional page is its own Purchase=1 batch.
  const qs = new URLSearchParams({
    Purchase: purchase ? '1' : '0',
    Limit: String(limit),
    Start: String(start || 0),
  });
  if (purchase) qs.set('Fields', PROPERTYRADAR_FIELDS.join(','));

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
  if (!purchase) {
    return { total: data.totalResultCount ?? 0, results: [] };
  }
  const rawResults = data.results || [];

  // Criteria are ANDed, so each returned property matches every requested
  // lead type. The cards show those requested tags. A single response does
  // not say which extra, unrequested types the property would also match.
  const mapped = rawResults.map((r, i) => {
    const lat = r.Latitude ?? null;
    const lng = r.Longitude ?? null;
    const addressFull = [r.Address, r.City, r.State, r.ZipFive].filter(Boolean).join(', ');
    return {
      id: r.RadarID || `pr-${i}`,
      address: r.Address || 'Unknown address',
      lat,
      lng,
      playIds: playIds.length ? playIds : ['prefore'],
      owner: r.Owner || [r.OwnerFirstName, r.OwnerLastName].filter(Boolean).join(' ') || null,
      equity: r.AvailableEquity != null ? Math.round(r.AvailableEquity / 1000) : null,
      // Characteristics below are UNVERIFIED (see PROPERTYRADAR_FIELDS
      // comment) — null-safe so an unrecognized/renamed field just shows
      // as missing in the UI instead of breaking the response.
      details: {
        // City / state / ZIP travel with the lead (and into saved leads via
        // the details blob) so "Comp This Property" can send RentCast the
        // full address — the street alone can match the wrong property.
        city: r.City || null,
        state: r.State || null,
        zip: r.ZipFive || null,
        propertyType: r.PType || null,
        beds: r.Beds ?? null,
        baths: r.Baths ?? null,
        sqft: r.SqFt ?? null,
        yearBuilt: r.YearBuilt ?? null,
        lotSizeAcres: r.LotSizeAcres ?? null,
        stories: r.Stories ?? null,
        pool: r.Pool === true || r.Pool === 1 ? true : (r.Pool === false || r.Pool === 0 ? false : null),
        garageSize: r.GarageSize ?? null,
      },
      mapUrl: buildMapUrl(lat, lng),
      zillowUrl: buildZillowUrl(addressFull),
    };
  });

  return {
    results: mapped,
    // totalResultCount is the real total match count for this Criteria —
    // independent of how many records were actually purchased in this call.
    // Falls back to what we got back if the field is ever missing, so
    // "Load more" just quietly has nothing further to offer.
    total: data.totalResultCount ?? mapped.length,
  };
}

function countPayload(compiled, count, demo, liveError) {
  const body = {
    count,
    demo,
    location: compiled.location,
    leadTypes: compiled.leadTypes,
    approximate: compiled.approximate,
    link: compiled.link,
    propertyTypes: compiled.propertyTypes,
    propertyMode: compiled.propertyMode,
    match: compiled.match,
  };
  if (liveError) body.liveError = liveError;
  return body;
}

function searchParams(params) {
  return {
    location: params.location,
    plays: params.plays,
    ptypes: params.ptypes,
    pmode: params.pmode,
    match: params.match,
    emin: params.emin,
    emax: params.emax,
  };
}

// Room left under the daily member cap and the monthly global cap.
// A missing blob context (unit tests, local node) uses in-memory counters.
async function openSpend(memberId) {
  const caps = spend.capsFromEnv(process.env);
  const now = new Date();
  let store = spend.openStore();
  try {
    const status = await spend.inspect(store, memberId, now, caps);
    return { store, status, now };
  } catch (err) {
    if (!spend.isStoreUnavailable(err)) throw err;
    console.error('Property search spend store unavailable, using in-memory counters:', err.message);
    store = spend.memoryStore();
    const status = await spend.inspect(store, memberId, now, caps);
    return { store, status, now };
  }
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const gate = await enforceMembership(event);
  if (gate.response) return gate.response;
  const memberId = gate.access.memberId;

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const action = params.action;

      if (action === 'search' || action === 'count') {
        const compiled = compileSearch(searchParams(params));
        if (compiled.error) return json(compiled.status || 400, { error: compiled.error });
        // Offset for "Load 25 more" — 0 on the first page of a search.
        // Count previews ignore it. Purchase=0 does not buy records.
        const start = Math.max(0, parseInt(params.start, 10) || 0);

        if (action === 'count') {
          if (!isLiveModeEnabled()) {
            return json(200, countPayload(compiled, buildDemoResults(compiled.playIds).length, true));
          }
          try {
            const preview = await searchPropertyRadar(compiled.criteria, compiled.playIds, 0, { purchase: false, limit: 1 });
            return json(200, countPayload(compiled, preview.total, false));
          } catch (err) {
            console.error('PropertyRadar count failed, falling back to demo count:', err);
            return json(200, countPayload(compiled, buildDemoResults(compiled.playIds).length, true, 'Live data temporarily unavailable.'));
          }
        }

        if (!isLiveModeEnabled()) {
          const demoResults = buildDemoResults(compiled.playIds);
          // Same Start window as a live search, so a later page cannot
          // append the rows the first page already returned.
          return json(200, { results: pageOf(demoResults, start), total: demoResults.length, demo: true, link: compiled.link });
        }

        let guard;
        try {
          guard = await openSpend(memberId);
        } catch (err) {
          console.error('Property search spend check failed:', err);
          return json(503, { error: 'Property Search is temporarily unavailable. Try again in a moment.' });
        }
        if (guard.status.blocked) return json(429, { error: guard.status.blocked.message });

        try {
          const { results, total } = await searchPropertyRadar(
            compiled.criteria,
            compiled.playIds,
            start,
            { purchase: true, limit: Math.min(PAGE_SIZE, guard.status.room) }
          );
          try {
            await spend.record(guard.store, memberId, results.length, guard.now);
          } catch (err) {
            // The records were already purchased. Losing the counter write
            // must not hide them from the member.
            console.error('Property search spend record failed after purchase:', err);
          }
          return json(200, { results, total, demo: false, link: compiled.link });
        } catch (err) {
          console.error('PropertyRadar live search failed, falling back to demo data:', err);
          const demoResults = buildDemoResults(compiled.playIds);
          return json(200, { results: pageOf(demoResults, start), total: demoResults.length, demo: true, liveError: 'Live data temporarily unavailable.', link: compiled.link });
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
        const { leadId, address, playIds, lat, lng, owner, equity, details } = payload;
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
            // Characteristics + map/Zillow links, bundled as one JSON blob
            // (details jsonb — see add-property-search-details-column.sql)
            // rather than one column per field, since the field set is
            // still unverified and likely to change.
            details: details || null,
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

        const tags = (saved.play_id || '').split(',').filter(Boolean).map(t => labelFor(t)).join(', ');

        // Property characteristics + map/Zillow links, when present, so
        // "transfer the property info (including pics) to the CRM" lands
        // somewhere real — the deal's note — not just in Property Search.
        const d = saved.details || {};
        const charParts = [];
        if (d.beds != null) charParts.push(`${d.beds} bd`);
        if (d.baths != null) charParts.push(`${d.baths} ba`);
        if (d.sqft != null) charParts.push(`${d.sqft} sqft`);
        if (d.yearBuilt != null) charParts.push(`built ${d.yearBuilt}`);
        if (d.propertyType) charParts.push(d.propertyType);
        const charsLine = charParts.length ? ` ${charParts.join(', ')}.` : '';
        const linkParts = [];
        if (d.mapUrl) linkParts.push(`Map: ${d.mapUrl}`);
        if (d.zillowUrl) linkParts.push(`Zillow: ${d.zillowUrl}`);
        const linksLine = linkParts.length ? ` ${linkParts.join(' | ')}` : '';

        const noteBody = `Sent from Property Search.${tags ? ` Lead type: ${tags}.` : ''}${saved.equity ? ` Est. equity: $${saved.equity}K.` : ''}${charsLine}${linksLine}`;
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
