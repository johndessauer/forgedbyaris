// Market Oracle — live data proxy (Phase II, free-tier sources only)
//
// Pulls real government data instead of ARIS-estimated numbers:
//   - Census ACS 5-Year estimates: median home value, median rent, median
//     income, vacancy rate, ownership rate, total housing units
//   - Census Geocoder (free, no key): resolves a "City, ST" query to a
//     county FIPS code when the input isn't a ZIP code
//   - Zippopotam.us (free, no key): resolves a ZIP code to its city/state
//     for display, since Census ACS's own NAME field returns a raw
//     ZCTA label (e.g. "ZCTA5 90740"), not a human place name
//   - FRED: current 30-year fixed mortgage rate
//
// IMPORTANT — this is real ACS data, not live MLS pricing. ACS 5-Year
// estimates are a rolling average, typically 1-3 years behind current
// market conditions. That's a real upgrade over ARIS estimating from
// training data, but it is not the same as a live listing-price feed
// (e.g. Rentcast/ATTOM). market-oracle.html labels this in the UI so
// members know what they're looking at.
//
// Requires two free environment variables, set in Netlify:
//   CENSUS_API_KEY — free, no billing, from census.gov/data/key_signup.html
//   FRED_API_KEY   — free, no billing, from fred.stlouisfed.org
//
// If either key is missing, or if the location can't be resolved, this
// function returns a clear error so the caller (market-oracle.html) can
// fall back to the existing ARIS-estimated flow rather than showing
// nothing.

const ACS_YEAR = 2022; // most recent 5-year ACS vintage at time of writing — bump this yearly

const ACS_VARS = [
  'NAME',
  'B19013_001E', // median household income
  'B25077_001E', // median value, owner-occupied housing units
  'B25064_001E', // median gross rent
  'B25001_001E', // total housing units
  'B25002_003E', // vacant housing units
  'B25003_001E', // total occupied housing units
  'B25003_002E'  // owner-occupied units
].join(',');

// Resolves a ZIP code to "City, ST" via Zippopotam.us. Non-fatal — returns
// null on any failure so the caller can fall back to a ZIP-only label.
async function resolveZipCityState(zip) {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const data = await res.json();
    const place = data?.places?.[0];
    if (!place) return null;
    const city = place['place name'];
    const state = place['state abbreviation'];
    if (!city || !state) return null;
    return `${city}, ${state}`;
  } catch (e) {
    return null;
  }
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const CENSUS_KEY = process.env.CENSUS_API_KEY;
  const FRED_KEY = process.env.FRED_API_KEY;

  const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://forgedbyaris.com'
  };

  if (!CENSUS_KEY) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'CENSUS_API_KEY not configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const query = (body.query || '').trim();
  if (!query) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing query' }) };
  }

  try {
    const isZip = /^\d{5}$/.test(query);
    let acsRows;
    let geoLabel;

    if (isZip) {
      const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=${ACS_VARS}&for=zip%20code%20tabulation%20area:${query}&key=${CENSUS_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Census ACS lookup failed for that ZIP code.');
      acsRows = await res.json();
      if (!acsRows || acsRows.length < 2) throw new Error('No ACS data for that ZIP code.');

      // Census ACS's own NAME field for a ZCTA is a raw label like
      // "ZCTA5 90740" — not a human place name. Resolve the real city/state
      // separately; fall back to the ZIP-only label if that lookup fails.
      const cityState = await resolveZipCityState(query);
      geoLabel = cityState ? `${cityState} (${query})` : `ZIP ${query}`;
    } else {
      // Resolve city/state text to a county FIPS via the free Census Geocoder
      const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) throw new Error('Geocoder request failed.');
      const geoData = await geoRes.json();
      const match = geoData?.result?.addressMatches?.[0];
      const county = match?.geographies?.Counties?.[0];
      if (!county) throw new Error('Could not resolve that location to a US county.');

      const stateFips = county.STATE;
      const countyFips = county.COUNTY;
      geoLabel = `${county.BASENAME} County, ${match.addressComponents?.state || ''}`.trim();

      const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=${ACS_VARS}&for=county:${countyFips}&in=state:${stateFips}&key=${CENSUS_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Census ACS lookup failed for that county.');
      acsRows = await res.json();
      if (!acsRows || acsRows.length < 2) throw new Error('No ACS data for that county.');
    }

    // ACS returns [headerRow, dataRow]; map header -> value
    const header = acsRows[0];
    const row = acsRows[1];
    const rec = {};
    header.forEach((h, i) => { rec[h] = row[i]; });

    const medianIncome    = parseInt(rec.B19013_001E, 10) || 0;
    const medianHomeValue = parseInt(rec.B25077_001E, 10) || 0;
    const medianRent      = parseInt(rec.B25064_001E, 10) || 0;
    const totalUnits      = parseInt(rec.B25001_001E, 10) || 0;
    const vacantUnits     = parseInt(rec.B25002_003E, 10) || 0;
    const occupiedUnits   = parseInt(rec.B25003_001E, 10) || 0;
    const ownerUnits      = parseInt(rec.B25003_002E, 10) || 0;

    const vacancyRate   = totalUnits > 0 ? (vacantUnits / totalUnits) * 100 : 0;
    const ownershipRate = occupiedUnits > 0 ? (ownerUnits / occupiedUnits) * 100 : 0;

    // ACS occasionally returns negative sentinel codes (e.g. -666666666) for
    // suppressed/unavailable small-geography data — treat those as invalid.
    const isSuppressed = (v) => v < 0;
    if (isSuppressed(medianIncome) || isSuppressed(medianHomeValue) || isSuppressed(medianRent)) {
      throw new Error('ACS data is suppressed for this geography (too small a sample). Try a broader location.');
    }

    // Live 30-year mortgage rate via FRED — non-fatal if it fails, since the
    // location data is still useful without it.
    let mortgageRate = null;
    let mortgageRateAsOf = null;
    if (FRED_KEY) {
      try {
        const fredUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&sort_order=desc&limit=1&file_type=json&api_key=${FRED_KEY}`;
        const fredRes = await fetch(fredUrl);
        if (fredRes.ok) {
          const fredData = await fredRes.json();
          const obs = fredData?.observations?.[0];
          if (obs && obs.value !== '.') {
            mortgageRate = parseFloat(obs.value);
            mortgageRateAsOf = obs.date;
          }
        }
      } catch (e) {
        // swallow — mortgage rate is a bonus field, not required
      }
    }

    const grossRentMultiplier = medianHomeValue > 0 && medianRent > 0 ? medianHomeValue / (medianRent * 12) : 0;
    const rentToPrice         = medianHomeValue > 0 && medianRent > 0 ? (medianRent / medianHomeValue) * 100 : 0;

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        geoLabel,
        medianHomeValue,
        medianRent,
        medianIncome,
        vacancyRate,
        ownershipRate,
        grossRentMultiplier,
        rentToPrice,
        totalUnits,
        marketNotes: '',
        dataSource: 'census',
        acsVintage: ACS_YEAR,
        mortgageRate,
        mortgageRateAsOf
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || 'Live data lookup failed' })
    };
  }
};
