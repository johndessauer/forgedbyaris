// netlify/functions/_Lib/location-resolver.js
//
// Turns a Market Oracle query into a structured US geography:
//   bare ZIP, "City, ST", a US state, or a neighborhood inside a city/ZIP.
// Nominatim is constrained to the ZIP/city when those are known, and name
// variants (Harter Heights / Harters Heights) are tried before giving up.
// Hits outside the stated area are rejected.

const ZIPPOTAM = 'https://api.zippopotam.us/us';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CENSUS_GEO = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const NOMINATIM_UA = 'FORGE-Market-Oracle/1.0 (+https://forgedbyaris.com)';

const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20',
  KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28',
  MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36',
  NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
  WI: '55', WY: '56', DC: '11',
};
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};
const NAME_TO_ABBR = Object.fromEntries(
  Object.entries(STATE_NAMES).flatMap(([abbr, name]) => [
    [name.toUpperCase(), abbr],
    [abbr, abbr],
  ])
);

const MAX_MILES_FROM_ZIP = 12;
const DEFAULT_RADIUS_MILES = 0.5;

function stateAbbr(input) {
  if (!input) return null;
  const s = String(input).trim().toUpperCase();
  return NAME_TO_ABBR[s] || null;
}

function stateFips(abbr) {
  return STATE_FIPS[stateAbbr(abbr) || ''] || null;
}

function stateName(abbr) {
  const a = stateAbbr(abbr);
  return a ? STATE_NAMES[a] : null;
}

function matchCityState(text) {
  if (!text) return null;
  const m = text.trim().match(/^(.*?),\s*([A-Za-z.]{2,})$/);
  if (!m) {
    const loose = text.trim().match(/^(.*)\s+([A-Z]{2})$/);
    if (!loose) return null;
    const st = stateAbbr(loose[2]);
    if (!st) return null;
    return { city: loose[1].trim().replace(/,$/, ''), state: st, remainder: null };
  }
  const st = stateAbbr(m[2].replace(/\./g, ''));
  if (!st) return null;
  const left = m[1].trim();
  // "Harter Heights, South Bend" + ST already consumed — if left has a comma,
  // split neighborhood from city.
  const inner = left.match(/^(.*),\s*([^,]+)$/);
  if (inner) {
    return { city: inner[2].trim(), state: st, remainder: inner[1].trim() };
  }
  return { city: left, state: st, remainder: null };
}

function parseQuery(raw) {
  const q = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!q) return { type: 'empty', raw: q };
  if (/^\d{5}$/.test(q)) return { type: 'zip', zip: q, raw: q };

  const zipMatch = q.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : null;
  let rest = q;
  if (zipMatch) {
    rest = (q.slice(0, zipMatch.index) + ' ' + q.slice(zipMatch.index + zipMatch[0].length))
      .replace(/\s+,\s+/g, ', ')
      .replace(/[\s]+/g, ' ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim();
  }

  if (zip && !rest) return { type: 'zip', zip, raw: q };

  const asState = stateAbbr(rest || q);
  if (asState && !zip && (rest === q || !rest)) {
    // Whole query is a state name/abbr (e.g. "Florida").
    if (!rest || stateAbbr(q)) return { type: 'state', state: asState, raw: q };
  }
  if (!zip && stateAbbr(q) && !q.includes(',')) {
    return { type: 'state', state: stateAbbr(q), raw: q };
  }

  const cs = matchCityState(rest || q);
  if (cs && !cs.remainder) {
    return { type: 'city', city: cs.city, state: cs.state, zip, raw: q };
  }
  if (cs && cs.remainder) {
    return { type: 'neighborhood', name: stripPlaceSuffix(cs.remainder), city: cs.city, state: cs.state, zip, raw: q };
  }
  if (zip && rest) {
    return { type: 'neighborhood', name: stripPlaceSuffix(rest), zip, raw: q };
  }
  return { type: 'unknown', name: stripPlaceSuffix(rest || q), raw: q };
}

function stripPlaceSuffix(name) {
  return String(name || '')
    .replace(/\s+(historic\s+)?(neighborhood|district|area|community|subdivision)$/i, '')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
}

function nameVariants(name) {
  const n = stripPlaceSuffix(name);
  if (!n) return [];
  const out = new Set([n]);
  const parts = n.split(/\s+/);
  if (parts[0] && !/s$/i.test(parts[0])) {
    out.add([parts[0] + 's', ...parts.slice(1)].join(' '));
  } else if (parts[0] && /s$/i.test(parts[0]) && parts[0].length > 3) {
    out.add([parts[0].slice(0, -1), ...parts.slice(1)].join(' '));
  }
  return [...out];
}

function haversineMiles(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function boxAround(lat, lng, miles = 10) {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  // viewbox: left, top, right, bottom
  return [lng - dLng, lat + dLat, lng + dLng, lat - dLat];
}

async function fetchJson(fetchImpl, url, headers, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data, text };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return { ok: false, status: timedOut ? 504 : 0, data: null, text: timedOut ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function lookupZip(zip, fetchImpl) {
  const res = await fetchJson(fetchImpl, `${ZIPPOTAM}/${zip}`);
  const place = res.ok && res.data && res.data.places && res.data.places[0];
  if (!place) return null;
  const lat = parseFloat(place.latitude);
  const lng = parseFloat(place.longitude);
  const city = place['place name'];
  const state = place['state abbreviation'];
  return {
    zip,
    city,
    state,
    lat,
    lng,
    label: city && state ? `${city}, ${state} (${zip})` : `ZIP ${zip}`,
  };
}

async function nominatimSearch(q, fetchImpl, opts) {
  const params = {
    q,
    format: 'jsonv2',
    addressdetails: 1,
    limit: opts && opts.limit ? String(opts.limit) : '5',
    countrycodes: 'us',
  };
  if (opts && opts.viewbox) params.viewbox = opts.viewbox.join(',');
  const url = `${NOMINATIM}?` + new URLSearchParams(params).toString();
  const res = await fetchJson(fetchImpl, url, { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' });
  return Array.isArray(res.data) ? res.data : [];
}

function hitInArea(hit, constraint) {
  if (!hit || !hit.lat || !hit.lon) return false;
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const addr = hit.address || {};
  const postcode = String(addr.postcode || '').slice(0, 5);
  const state = stateAbbr(addr.state) || stateAbbr(addr['ISO3166-2-lvl4'] && String(addr['ISO3166-2-lvl4']).split('-')[1]);
  const city = addr.city || addr.town || addr.village || addr.municipality;
  if (constraint.zip && postcode && postcode === constraint.zip) return { lat, lng, via: 'postcode' };
  if (constraint.state && state && state !== constraint.state) return false;
  if (constraint.city && city && !normEq(city, constraint.city) && !(constraint.zip && !postcode)) {
    // City mismatch is ok if we still have a zip and are close to the centroid.
    if (!constraint.lat) return false;
  }
  if (constraint.lat != null && constraint.lng != null) {
    const miles = haversineMiles(constraint.lat, constraint.lng, lat, lng);
    if (miles <= (constraint.maxMiles || MAX_MILES_FROM_ZIP)) return { lat, lng, via: 'distance', miles };
    return false;
  }
  if (constraint.state && state === constraint.state && constraint.city && city && normEq(city, constraint.city)) {
    return { lat, lng, via: 'city' };
  }
  if (constraint.state && state === constraint.state && !constraint.city && !constraint.zip) {
    return { lat, lng, via: 'state' };
  }
  return false;
}

function normEq(a, b) {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n(a) === n(b);
}

function displayName(hit) {
  return (hit && (hit.name || hit.display_name)) || '';
}

async function censusAt(lat, lng, fetchImpl) {
  const url = `${CENSUS_GEO}?` + new URLSearchParams({
    x: String(lng),
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  }).toString();
  const res = await fetchJson(fetchImpl, url, { Accept: 'application/json' }, 12000);
  const geos = ((((res.data || {}).result || {}).geographies) || {});
  const first = (names) => {
    for (const name of names) {
      const arr = geos[name];
      if (arr && arr[0]) return { layer: name, ...arr[0] };
    }
    return null;
  };
  const county = first(['Counties']);
  const tract = first(['Census Tracts']);
  const place = first(['Incorporated Places', 'Census Designated Places']);
  const state = first(['States']);
  const block = first(['2020 Census Blocks', 'Census Blocks']);
  const blockGeoid = block && (block.GEOID || '');
  const blockGroup = blockGeoid && blockGeoid.length >= 12
    ? {
      GEOID: blockGeoid.slice(0, 12),
      STATE: block.STATE || blockGeoid.slice(0, 2),
      COUNTY: block.COUNTY || blockGeoid.slice(2, 5),
      TRACT: block.TRACT || blockGeoid.slice(5, 11),
      BLKGRP: blockGeoid.slice(11, 12),
    }
    : null;
  return {
    county: county && {
      name: county.BASENAME || county.NAME,
      stateFips: county.STATE,
      countyFips: county.COUNTY,
      geoid: county.GEOID,
      stateAbbr: stateAbbr((state && (state.STUSAB || state.BASENAME)) || ''),
    },
    tract: tract && {
      name: tract.NAME,
      geoid: tract.GEOID,
      stateFips: tract.STATE,
      countyFips: tract.COUNTY,
      tract: tract.TRACT,
    },
    place: place && {
      name: place.NAME || place.BASENAME,
      geoid: place.GEOID,
      stateFips: place.STATE,
      placeFips: place.PLACE || (place.GEOID && String(place.GEOID).slice(2)),
    },
    blockGroup,
    blockGeoid: blockGeoid || null,
  };
}

function geographyBase(fields) {
  return {
    type: fields.type,
    label: fields.label,
    name: fields.name || null,
    city: fields.city || null,
    state: fields.state || null,
    zip: fields.zip || null,
    lat: fields.lat != null ? fields.lat : null,
    lng: fields.lng != null ? fields.lng : null,
    blockGroup: fields.blockGroup || null,
    tract: fields.tract || null,
    place: fields.place || null,
    county: fields.county || null,
    radiusMiles: fields.radiusMiles != null ? fields.radiusMiles : null,
    note: fields.note || '',
    fallbackFrom: fields.fallbackFrom || null,
    resolvedAs: fields.resolvedAs || fields.type,
  };
}

async function resolveLocation(query, deps) {
  const fetchImpl = (deps && deps.fetch) || fetch;
  const parsed = parseQuery(query);
  if (parsed.type === 'empty') {
    return { ok: false, error: 'Enter a zip code, city, or neighborhood (e.g. Memphis, TN or Harter Heights, 46617).', parsed };
  }

  if (parsed.type === 'zip') {
    const z = await lookupZip(parsed.zip, fetchImpl);
    if (!z) return { ok: false, error: 'No ACS data for that ZIP code.', parsed };
    const census = await censusAt(z.lat, z.lng, fetchImpl).catch(() => null);
    return {
      ok: true,
      parsed,
      geography: geographyBase({
        type: 'zip',
        label: z.label,
        city: z.city,
        state: z.state,
        zip: z.zip,
        lat: z.lat,
        lng: z.lng,
        county: census && census.county,
        place: census && census.place,
        tract: census && census.tract,
        blockGroup: census && census.blockGroup,
        note: `U.S. Census ZIP Code Tabulation Area ${z.zip}.`,
        resolvedAs: 'zip',
      }),
      acsTargets: {
        primary: { kind: 'zcta', zip: z.zip },
        comparison: null,
      },
    };
  }

  if (parsed.type === 'state') {
    const fips = stateFips(parsed.state);
    const label = stateName(parsed.state) || parsed.state;
    return {
      ok: true,
      parsed,
      geography: geographyBase({
        type: 'state',
        label,
        state: parsed.state,
        note: `U.S. Census state-level estimates for ${label}.`,
        resolvedAs: 'state',
      }),
      acsTargets: {
        primary: { kind: 'state', stateFips: fips },
        comparison: null,
      },
    };
  }

  if (parsed.type === 'city') {
    const cityRes = await resolveCity(parsed, fetchImpl);
    if (!cityRes.ok) return { ...cityRes, parsed };
    return cityRes;
  }

  // neighborhood or unknown
  if (parsed.type === 'neighborhood' || parsed.type === 'unknown') {
    const hood = await resolveNeighborhood(parsed, fetchImpl);
    if (hood.ok) return hood;
    // Clean fallback: if we have a ZIP, return ZIP-level data with a notice.
    if (parsed.zip) {
      const z = await lookupZip(parsed.zip, fetchImpl);
      if (z) {
        const census = await censusAt(z.lat, z.lng, fetchImpl).catch(() => null);
        return {
          ok: true,
          parsed,
          geography: geographyBase({
            type: 'zip',
            label: z.label,
            city: z.city,
            state: z.state,
            zip: z.zip,
            lat: z.lat,
            lng: z.lng,
            county: census && census.county,
            place: census && census.place,
            note: `Could not uniquely locate “${parsed.name}” inside ZIP ${parsed.zip}. Showing ZIP-level figures instead.`,
            fallbackFrom: parsed.name,
            resolvedAs: 'zip-fallback',
          }),
          acsTargets: { primary: { kind: 'zcta', zip: z.zip }, comparison: null },
        };
      }
    }
    if (parsed.city && parsed.state) {
      const cityRes = await resolveCity({ ...parsed, type: 'city' }, fetchImpl);
      if (cityRes.ok) {
        cityRes.geography.fallbackFrom = parsed.name;
        cityRes.geography.note = `Could not uniquely locate “${parsed.name}” in ${parsed.city}, ${parsed.state}. Showing city-level figures instead.`;
        cityRes.geography.resolvedAs = 'city-fallback';
        return cityRes;
      }
    }
    return {
      ok: false,
      error: hood.error || 'Could not resolve that location. Try a 5-digit ZIP, “City, ST”, or a neighborhood plus a ZIP (e.g. Harter Heights, 46617).',
      parsed,
    };
  }

  return { ok: false, error: 'Could not resolve that location.', parsed };
}

async function resolveCity(parsed, fetchImpl) {
  const q = `${parsed.city}, ${stateName(parsed.state) || parsed.state}, USA`;
  const hits = await nominatimSearch(q, fetchImpl, { limit: 5 });
  const constraint = { city: parsed.city, state: parsed.state, zip: parsed.zip, maxMiles: 40 };
  if (parsed.zip) {
    const z = await lookupZip(parsed.zip, fetchImpl);
    if (z) { constraint.lat = z.lat; constraint.lng = z.lng; }
  }
  let chosen = null;
  let area = null;
  for (const hit of hits) {
    const ok = hitInArea(hit, constraint);
    // For a city query without a zip, accept in-state city-class hits.
    const typ = (hit.type || '') + ' ' + (hit.addresstype || '') + ' ' + (hit.class || '');
    const cityLike = /city|town|village|municipality|administrative|county/.test(typ) || hit.addresstype === 'city';
    if (ok && (cityLike || !chosen)) {
      chosen = hit;
      area = ok;
      if (cityLike) break;
    }
  }
  if (!chosen || !area) {
    return { ok: false, error: `Could not resolve ${parsed.city}, ${parsed.state} to a US city.`, parsed };
  }
  const lat = area.lat;
  const lng = area.lng;
  const census = await censusAt(lat, lng, fetchImpl).catch(() => null);
  const place = census && census.place;
  const county = census && census.county;
  const label = `${parsed.city}, ${parsed.state}`;
  const primary = place && place.stateFips && place.placeFips
    ? { kind: 'place', stateFips: place.stateFips, placeFips: place.placeFips }
    : (county ? { kind: 'county', stateFips: county.stateFips, countyFips: county.countyFips } : null);
  if (!primary) {
    return { ok: false, error: 'Could not resolve that location to a US city or county.', parsed };
  }
  const note = primary.kind === 'place'
    ? `U.S. Census place (city) of ${place.name}.`
    : `U.S. Census county figures for ${county.name} County, ${parsed.state}. The Census geocoder could not match a city place code.`;
  return {
    ok: true,
    parsed,
    geography: geographyBase({
      type: primary.kind === 'place' ? 'city' : 'county',
      label,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip || null,
      lat, lng,
      place, county,
      tract: census && census.tract,
      blockGroup: census && census.blockGroup,
      note,
      resolvedAs: primary.kind === 'place' ? 'city' : 'county',
    }),
    acsTargets: {
      primary,
      comparison: parsed.zip ? { kind: 'zcta', zip: parsed.zip } : null,
    },
  };
}

async function resolveNeighborhood(parsed, fetchImpl) {
  const name = parsed.name;
  if (!name) return { ok: false, error: 'Enter a neighborhood name plus a ZIP or city.' };

  let zipInfo = null;
  if (parsed.zip) zipInfo = await lookupZip(parsed.zip, fetchImpl);
  if (!zipInfo && parsed.city && parsed.state) {
    // City centroid as a constraint when no ZIP was given.
    const cityHits = await nominatimSearch(`${parsed.city}, ${stateName(parsed.state) || parsed.state}, USA`, fetchImpl, { limit: 1 });
    if (cityHits[0]) {
      zipInfo = {
        zip: parsed.zip || null,
        city: parsed.city,
        state: parsed.state,
        lat: parseFloat(cityHits[0].lat),
        lng: parseFloat(cityHits[0].lon),
      };
    }
  }
  if (!zipInfo && !parsed.city) {
    return { ok: false, error: `Add a ZIP code or city so “${name}” can be located. Try “${name}, 46617” or “${name}, South Bend, IN”.` };
  }

  const constraint = {
    zip: parsed.zip || (zipInfo && zipInfo.zip) || null,
    city: parsed.city || (zipInfo && zipInfo.city) || null,
    state: parsed.state || (zipInfo && zipInfo.state) || null,
    lat: zipInfo && zipInfo.lat,
    lng: zipInfo && zipInfo.lng,
    maxMiles: MAX_MILES_FROM_ZIP,
  };
  const viewbox = (constraint.lat != null) ? boxAround(constraint.lat, constraint.lng, MAX_MILES_FROM_ZIP) : null;
  const cityLabel = constraint.city && constraint.state
    ? `${constraint.city}, ${stateName(constraint.state) || constraint.state}`
    : (constraint.state ? (stateName(constraint.state) || constraint.state) : '');

  let chosen = null;
  let area = null;
  let usedVariant = name;
  const queries = [];
  for (const v of nameVariants(name)) {
    if (cityLabel && parsed.zip) queries.push(`${v}, ${cityLabel} ${parsed.zip}`);
    if (cityLabel) queries.push(`${v}, ${cityLabel}`);
    if (parsed.zip) queries.push(`${v}, ${parsed.zip}`);
    queries.push(v);
  }

  const seen = new Set();
  for (const q of queries) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = await nominatimSearch(q, fetchImpl, { limit: 5, viewbox });
    for (const hit of hits) {
      const ok = hitInArea(hit, constraint);
      if (!ok) continue;
      chosen = hit;
      area = ok;
      usedVariant = q;
      break;
    }
    if (chosen) break;
  }

  if (!chosen || !area) {
    return { ok: false, error: `Could not uniquely locate “${name}”${constraint.zip ? ' in ZIP ' + constraint.zip : ''}.`, parsed };
  }

  const lat = area.lat;
  const lng = area.lng;
  const census = await censusAt(lat, lng, fetchImpl).catch(() => null);
  const zip = constraint.zip || ((chosen.address && chosen.address.postcode) || '').slice(0, 5) || null;
  const display = chosen.name || name;
  const label = zip
    ? `${display}, ${constraint.city || ''}${constraint.city && constraint.state ? ', ' : ''}${constraint.state || ''} (${zip})`.replace(/\s+/g, ' ').replace(' ,', ',').trim()
    : `${display}${constraint.city ? ', ' + constraint.city : ''}${constraint.state ? ', ' + constraint.state : ''}`;

  const bg = census && census.blockGroup;
  const tract = census && census.tract;
  const primary = bg && bg.STATE && bg.COUNTY && bg.TRACT && bg.BLKGRP
    ? { kind: 'blockGroup', stateFips: bg.STATE, countyFips: bg.COUNTY, tract: bg.TRACT, blockGroup: bg.BLKGRP, geoid: bg.GEOID }
    : (tract && tract.stateFips && tract.countyFips && tract.tract
      ? { kind: 'tract', stateFips: tract.stateFips, countyFips: tract.countyFips, tract: tract.tract, geoid: tract.geoid }
      : (zip ? { kind: 'zcta', zip } : null));
  if (!primary) {
    return { ok: false, error: `Located “${display}” but could not match it to a Census geography.`, parsed };
  }

  const geoKind = primary.kind === 'blockGroup'
    ? `Census block group ${bg.BLKGRP} in ${tract && tract.name ? tract.name : 'tract ' + (bg.TRACT || '')}`
    : (primary.kind === 'tract' ? (tract && tract.name) || 'census tract' : `ZIP ${zip}`);
  const note = `${display} resolved inside ${constraint.city ? constraint.city + ', ' : ''}${constraint.state || ''}${zip ? ' ' + zip : ''}`.trim()
    + `. Primary figures are ${geoKind}. Nearby block groups can differ a lot, so they are not averaged in. Comps use a ${DEFAULT_RADIUS_MILES} mile radius around the neighborhood center, which may slightly overlap adjacent areas.`;

  return {
    ok: true,
    parsed,
    geography: geographyBase({
      type: 'neighborhood',
      label,
      name: display,
      city: constraint.city,
      state: constraint.state,
      zip,
      lat, lng,
      blockGroup: bg,
      tract,
      place: census && census.place,
      county: census && census.county,
      radiusMiles: DEFAULT_RADIUS_MILES,
      note,
      resolvedAs: 'neighborhood',
    }),
    acsTargets: {
      primary,
      comparison: zip ? { kind: 'zcta', zip } : null,
    },
    match: { variant: usedVariant, via: area.via, osmName: chosen.name, osmType: chosen.type || chosen.addresstype },
  };
}

module.exports = {
  parseQuery,
  nameVariants,
  stateAbbr,
  stateFips,
  stateName,
  haversineMiles,
  boxAround,
  hitInArea,
  lookupZip,
  resolveLocation,
  DEFAULT_RADIUS_MILES,
  MAX_MILES_FROM_ZIP,
  STATE_FIPS,
  STATE_NAMES,
};
