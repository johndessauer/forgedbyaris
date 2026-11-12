// Market Oracle — live data proxy
//
// Resolves a ZIP, "City, ST", US state, or neighborhood-within-ZIP, then
// returns:
//   - Census ACS 5-year estimates (latest vintage, currently 2024) for the
//     primary geography, plus a ZIP comparison when a neighborhood is used
//   - Optional RentCast radius sale/rental comps (authenticated members only,
//     behind the existing cache + monthly budget cap)
//   - Area intel (Census Building Permits Survey + sourced news), cached
//     lightly, with source links and dates so ARIS never invents headlines
//
// Requires CENSUS_API_KEY (free). FRED_API_KEY is optional. RentCast is
// optional and never called without a verified member. News search API keys
// (TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, NEWSAPI_KEY) are optional.

const { resolveLocation } = require('./_Lib/location-resolver');
const { fetchAcs, toMarketStats } = require('./_Lib/acs-client');
const { loadAreaIntel } = require('./_Lib/area-intel');
const { loadRadiusComps } = require('./_Lib/market-rentcast');
const { createSupabaseStore } = require('./_Lib/comps-store');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://forgedbyaris.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(statusCode, body) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// Tiny in-process cache for free sources (ACS/permits/news) so a page refresh
// during one instance does not re-hit Census. The RentCast path has its own
// 30-day store cache.
const memCache = new Map();
const MEM_TTL_MS = 6 * 60 * 60 * 1000;

function memGet(key, now) {
  const row = memCache.get(key);
  if (!row) return null;
  if (row.expires <= now.getTime()) { memCache.delete(key); return null; }
  return row.value;
}
function memSet(key, value, now, ttl) {
  memCache.set(key, { value, expires: now.getTime() + (ttl || MEM_TTL_MS) });
}

async function fetchFredRate(fetchImpl, key) {
  if (!key) return { mortgageRate: null, mortgageRateAsOf: null };
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&sort_order=desc&limit=1&file_type=json&api_key=${key}`;
    const res = await fetchImpl(url);
    if (!res.ok) return { mortgageRate: null, mortgageRateAsOf: null };
    const fredData = await res.json();
    const obs = fredData && fredData.observations && fredData.observations[0];
    if (obs && obs.value !== '.') {
      return { mortgageRate: parseFloat(obs.value), mortgageRateAsOf: obs.date };
    }
  } catch (e) { /* non-fatal */ }
  return { mortgageRate: null, mortgageRateAsOf: null };
}

function createHandler(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const fetchImpl = d.fetch || fetch;
  const nowFn = d.now || (() => new Date());
  const verify = d.verifyMember || (async (event) => {
    const { verifyMember } = require('./_Lib/verify-member');
    return verifyMember(event);
  });

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });

    if (!env.CENSUS_API_KEY) {
      return reply(500, { error: 'CENSUS_API_KEY not configured' });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return reply(400, { error: 'Invalid request body' });
    }
    const query = (body.query || '').trim();
    if (!query) return reply(400, { error: 'Missing query' });

    // Market Oracle is a member feature. Census figures are not returned
    // until the caller has a live plan. RentCast comps stay Empire-only.
    let access;
    try {
      if (d.requireMembership) {
        access = await d.requireMembership(event);
      } else if (d.getMember) {
        const { accessFromMember } = require('./_Lib/membership');
        const memberId = await verify(event);
        access = accessFromMember(memberId, await d.getMember(memberId));
        if (!access.active) {
          const err = new Error('Active membership required');
          err.statusCode = 403;
          throw err;
        }
      } else {
        const { requireMembership } = require('./_Lib/membership');
        access = await requireMembership(event, { verifyMember: verify });
      }
    } catch (e) {
      return reply(e.statusCode || 401, { error: e.message || 'Active membership required' });
    }

    const now = nowFn();

    try {
      const resolved = await resolveLocation(query, { fetch: fetchImpl, now });
      if (!resolved.ok) {
        return reply(502, { error: resolved.error || 'Could not resolve that location.' });
      }

      const { geography, acsTargets } = resolved;

      // ACS primary, and ZIP comparison when present. If the primary BG is
      // suppressed, try the tract, then the ZIP.
      let primary = await fetchAcs(acsTargets.primary, { fetch: fetchImpl, censusKey: env.CENSUS_API_KEY, years: d.acsYears });
      let usedTarget = acsTargets.primary;
      if (!primary.ok && acsTargets.primary && acsTargets.primary.kind === 'blockGroup') {
        const tractTarget = geography.tract && {
          kind: 'tract',
          stateFips: geography.tract.stateFips,
          countyFips: geography.tract.countyFips,
          tract: geography.tract.tract,
          geoid: geography.tract.geoid,
        };
        if (tractTarget) {
          const tractAcs = await fetchAcs(tractTarget, { fetch: fetchImpl, censusKey: env.CENSUS_API_KEY, years: d.acsYears });
          if (tractAcs.ok) {
            primary = tractAcs;
            usedTarget = tractTarget;
            geography.note = (geography.note || '')
              + ' Block-group ACS was suppressed or unavailable, so tract-level figures are shown instead.';
          }
        }
      }
      if (!primary.ok && acsTargets.comparison) {
        const fallback = await fetchAcs(acsTargets.comparison, { fetch: fetchImpl, censusKey: env.CENSUS_API_KEY, years: d.acsYears });
        if (fallback.ok) {
          primary = fallback;
          usedTarget = acsTargets.comparison;
          geography.fallbackFrom = geography.fallbackFrom || geography.name || geography.type;
          geography.resolvedAs = 'zip-fallback';
          geography.note = (geography.note ? geography.note + ' ' : '')
            + 'Neighborhood-level ACS was unavailable, so ZIP-level figures are shown.';
        }
      }
      if (!primary.ok) {
        return reply(502, { error: primary.error || 'Census ACS lookup failed for that location.' });
      }

      let zipComparison = null;
      if (acsTargets.comparison && !(usedTarget && usedTarget.kind === 'zcta' && usedTarget.zip === acsTargets.comparison.zip)) {
        const cmp = await fetchAcs(acsTargets.comparison, { fetch: fetchImpl, censusKey: env.CENSUS_API_KEY, years: d.acsYears });
        if (cmp.ok) {
          zipComparison = toMarketStats(cmp.parsed, {
            geoLabel: geography.zip ? `ZIP ${geography.zip}` : cmp.parsed.name,
            dataSource: 'census',
            acsVintage: cmp.year,
          });
        }
      }

      const stats = toMarketStats(primary.parsed, { geoLabel: geography.label });

      // Area intel + FRED + optional comps in parallel.
      // Comps spend RentCast money and are Empire / FORGE Zero / Beta only.
      const memberId = access.comps ? access.memberId : null;

      let store = d.store || null;
      if (!store && memberId && (env.RENTCAST_API_KEY || env.RENTCAST_MOCK) && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const { supabase } = require('./_Lib/supabase-client');
          store = createSupabaseStore(supabase);
        } catch (e) {
          store = null;
        }
      }

      const intelKey = `intel:${geography.type}:${geography.zip || ''}:${geography.city || ''}:${geography.state || ''}:${geography.name || ''}`;
      let areaIntel = memGet(intelKey, now);
      const intelPromise = areaIntel
        ? Promise.resolve(areaIntel)
        : loadAreaIntel(geography, { fetch: fetchImpl, env, now: nowFn }).then((val) => {
          memSet(intelKey, val, now, 12 * 60 * 60 * 1000);
          return val;
        });

      const [fred, intel, comps] = await Promise.all([
        fetchFredRate(fetchImpl, env.FRED_API_KEY),
        intelPromise,
        loadRadiusComps(geography, {
          fetch: fetchImpl,
          env,
          now: nowFn,
          store,
          memberId,
          mockResponse: d.mockResponse,
        }).catch((e) => ({
          status: 'skipped',
          reason: 'error',
          message: 'Live comps could not be loaded for this area.',
        })),
      ]);
      areaIntel = intel;

      return reply(200, {
        geoLabel: geography.label,
        geography,
        medianHomeValue: stats.medianHomeValue,
        medianRent: stats.medianRent,
        medianIncome: stats.medianIncome,
        vacancyRate: stats.vacancyRate,
        ownershipRate: stats.ownershipRate,
        grossRentMultiplier: stats.grossRentMultiplier,
        rentToPrice: stats.rentToPrice,
        totalUnits: stats.totalUnits,
        pctUnits5Plus: stats.pctUnits5Plus,
        marketNotes: geography.note || '',
        dataSource: 'census',
        acsVintage: primary.year,
        acsGeography: usedTarget && usedTarget.kind,
        zipComparison,
        comps,
        areaIntel,
        mortgageRate: fred.mortgageRate,
        mortgageRateAsOf: fred.mortgageRateAsOf,
      });
    } catch (err) {
      return reply(502, { error: (err && err.message) || 'Live data lookup failed' });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
