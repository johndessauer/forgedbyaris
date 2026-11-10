// netlify/functions/_Lib/acs-client.js
// Census ACS 5-year lookups. Prefers the latest vintage (2024 as of early
// 2026) and falls back a year at a time so a missing release does not break
// Market Oracle.

const ACS_VARS = [
  'NAME',
  'B19013_001E', // median household income
  'B25077_001E', // median value, owner-occupied housing units
  'B25064_001E', // median gross rent
  'B25001_001E', // total housing units
  'B25002_003E', // vacant housing units
  'B25003_001E', // total occupied housing units
  'B25003_002E', // owner-occupied units
  'B25024_006E', // 5 to 9 units
  'B25024_007E', // 10 to 19 units
  'B25024_008E', // 20 to 49 units
  'B25024_009E', // 50 or more units
].join(',');

const PREFERRED_YEARS = [2024, 2023, 2022];

function isSuppressed(v) {
  return v == null || v < 0;
}

function parseRow(header, row) {
  const rec = {};
  header.forEach((h, i) => { rec[h] = row[i]; });
  const num = (k) => {
    const v = parseInt(rec[k], 10);
    return Number.isFinite(v) ? v : 0;
  };
  const medianIncome = num('B19013_001E');
  const medianHomeValue = num('B25077_001E');
  const medianRent = num('B25064_001E');
  const totalUnits = num('B25001_001E');
  const vacantUnits = num('B25002_003E');
  const occupiedUnits = num('B25003_001E');
  const ownerUnits = num('B25003_002E');
  const units5Plus = num('B25024_006E') + num('B25024_007E') + num('B25024_008E') + num('B25024_009E');
  const vacancyRate = totalUnits > 0 ? (vacantUnits / totalUnits) * 100 : 0;
  const ownershipRate = occupiedUnits > 0 ? (ownerUnits / occupiedUnits) * 100 : 0;
  const pctUnits5Plus = totalUnits > 0 ? (units5Plus / totalUnits) * 100 : 0;
  const grossRentMultiplier = medianHomeValue > 0 && medianRent > 0 ? medianHomeValue / (medianRent * 12) : 0;
  const rentToPrice = medianHomeValue > 0 && medianRent > 0 ? (medianRent / medianHomeValue) * 100 : 0;
  return {
    name: rec.NAME || '',
    medianIncome,
    medianHomeValue,
    medianRent,
    totalUnits,
    vacancyRate,
    ownershipRate,
    pctUnits5Plus,
    grossRentMultiplier,
    rentToPrice,
    suppressed: isSuppressed(medianIncome) || isSuppressed(medianHomeValue) || isSuppressed(medianRent),
    raw: rec,
  };
}

function targetQuery(target) {
  if (!target) return null;
  if (target.kind === 'zcta') {
    return { for: `zip code tabulation area:${target.zip}` };
  }
  if (target.kind === 'state') {
    return { for: `state:${target.stateFips}` };
  }
  if (target.kind === 'county') {
    return { for: `county:${target.countyFips}`, in: `state:${target.stateFips}` };
  }
  if (target.kind === 'place') {
    return { for: `place:${target.placeFips}`, in: `state:${target.stateFips}` };
  }
  if (target.kind === 'tract') {
    return { for: `tract:${target.tract}`, in: `state:${target.stateFips} county:${target.countyFips}` };
  }
  if (target.kind === 'blockGroup') {
    return { for: `block group:${target.blockGroup}`, in: `state:${target.stateFips} county:${target.countyFips} tract:${target.tract}` };
  }
  return null;
}

function acsUrl(year, target, key) {
  const q = targetQuery(target);
  if (!q) return null;
  const params = new URLSearchParams({ get: ACS_VARS, for: q.for });
  if (q.in) params.set('in', q.in);
  if (key) params.set('key', key);
  return `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
}

async function fetchAcsYear(fetchImpl, year, target, key) {
  const url = acsUrl(year, target, key);
  if (!url) return { ok: false, error: 'unsupported geography' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: `ACS ${year} HTTP ${res.status}` };
    let rows;
    try { rows = JSON.parse(text); } catch (e) { return { ok: false, error: 'ACS response was not JSON' }; }
    if (!Array.isArray(rows) || rows.length < 2) return { ok: false, error: 'No ACS data for that geography.' };
    const parsed = parseRow(rows[0], rows[1]);
    if (parsed.suppressed) return { ok: false, error: 'suppressed', parsed, year };
    return { ok: true, year, parsed };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAcs(target, deps) {
  const fetchImpl = (deps && deps.fetch) || fetch;
  const key = deps && deps.censusKey;
  const years = (deps && deps.years) || PREFERRED_YEARS;
  if (!target) return { ok: false, error: 'missing ACS target' };
  let lastErr = 'No ACS data for that geography.';
  for (const year of years) {
    const r = await fetchAcsYear(fetchImpl, year, target, key);
    if (r.ok) return r;
    if (r.error === 'suppressed') {
      lastErr = 'ACS data is suppressed for this geography (too small a sample).';
      // Try a broader year only if this vintage is missing entirely; suppression
      // will usually be the same across nearby vintages, so stop.
      return { ok: false, error: lastErr, suppressed: true, year: r.year, parsed: r.parsed };
    }
    lastErr = r.error || lastErr;
  }
  return { ok: false, error: lastErr };
}

function toMarketStats(parsed, extra) {
  const p = parsed || {};
  return {
    geoLabel: (extra && extra.geoLabel) || p.name || '',
    medianHomeValue: p.medianHomeValue || 0,
    medianRent: p.medianRent || 0,
    medianIncome: p.medianIncome || 0,
    vacancyRate: p.vacancyRate || 0,
    ownershipRate: p.ownershipRate || 0,
    grossRentMultiplier: p.grossRentMultiplier || 0,
    rentToPrice: p.rentToPrice || 0,
    totalUnits: p.totalUnits || 0,
    pctUnits5Plus: p.pctUnits5Plus || 0,
    ...(extra || {}),
  };
}

module.exports = {
  ACS_VARS,
  PREFERRED_YEARS,
  isSuppressed,
  parseRow,
  targetQuery,
  acsUrl,
  fetchAcs,
  fetchAcsYear,
  toMarketStats,
};
