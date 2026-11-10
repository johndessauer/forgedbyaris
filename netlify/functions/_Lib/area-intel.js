// netlify/functions/_Lib/area-intel.js
//
// Generalized investor "area intel": sourced only. Never invents items.
//   1. Census Building Permits Survey (county YTD files on www2.census.gov) — free.
//   2. Optional news/search API when a key is present in env (Tavily, Brave, NewsAPI).
//   3. Otherwise a best-effort Google News RSS search (free, may be empty).
// Every item has a title, URL, date, and source name. ARIS must cite these
// and must not add unsourced developments.

const BPS_BASE = 'https://www2.census.gov/econ/bps/County';

function sourceNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch (e) {
    return 'source';
  }
}

async function fetchText(fetchImpl, url, headers, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: err && err.name === 'AbortError' ? 504 : 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function bpsUrl(year, month) {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  return `${BPS_BASE}/co${yy}${mm}y.txt`;
}

function parseBpsRow(line) {
  // CSV; county name is padded and may contain spaces, not usually commas.
  const parts = line.split(',');
  if (parts.length < 15) return null;
  const date = (parts[0] || '').trim(); // YYYYMM
  const stateFips = (parts[1] || '').trim().padStart(2, '0');
  const countyFips = (parts[2] || '').trim().padStart(3, '0');
  const name = (parts[5] || '').trim();
  const n = (i) => parseInt(parts[i], 10) || 0;
  // After name: 1-unit Bldgs, Units, Value, 2-units B/U/V, 3-4 B/U/V, 5+ B/U/V
  const oneUnit = n(7);
  const twoUnits = n(10);
  const threeFour = n(13);
  const fivePlus = n(16);
  const oneVal = n(8);
  const twoVal = n(11);
  const tfVal = n(14);
  const fiveVal = n(17);
  return {
    period: date,
    stateFips,
    countyFips,
    name,
    units1: oneUnit,
    units2: twoUnits,
    units34: threeFour,
    units5plus: fivePlus,
    totalUnits: oneUnit + twoUnits + threeFour + fivePlus,
    totalValue: oneVal + twoVal + tfVal + fiveVal,
  };
}

async function findBpsFile(fetchImpl, now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  for (let back = 0; back < 18; back++) {
    let year = y;
    let month = m - back;
    while (month <= 0) { month += 12; year -= 1; }
    const url = bpsUrl(year, month);
    const res = await fetchText(fetchImpl, url, { 'User-Agent': 'FORGE-Market-Oracle/1.0 (+https://forgedbyaris.com)' });
    if (res.ok && res.text && res.text.includes('Survey,FIPS')) {
      return { url, year, month, text: res.text };
    }
  }
  return null;
}

function pickCounty(text, stateFips, countyFips) {
  const sf = String(stateFips).padStart(2, '0');
  const cf = String(countyFips).padStart(3, '0');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!/^\d{6},/.test(line)) continue;
    const row = parseBpsRow(line);
    if (row && row.stateFips === sf && row.countyFips === cf) return row;
  }
  return null;
}

async function loadPermits(geography, deps) {
  const county = geography && geography.county;
  if (!county || !county.stateFips || !county.countyFips) {
    return { status: 'unavailable', message: 'No county FIPS available for Building Permits Survey data.', items: [] };
  }
  const fetchImpl = (deps && deps.fetch) || fetch;
  const now = (deps && deps.now && deps.now()) || new Date();
  const file = await findBpsFile(fetchImpl, now);
  if (!file) {
    return { status: 'unavailable', message: 'Census Building Permits Survey file was not available.', items: [] };
  }
  const row = pickCounty(file.text, county.stateFips, county.countyFips);
  if (!row) {
    return {
      status: 'unavailable',
      message: `No Building Permits Survey row for ${county.name || 'this county'}.`,
      sourceUrl: file.url,
      items: [],
    };
  }
  // Prior-year same month, for a simple trend (non-fatal).
  let prior = null;
  const priorUrl = bpsUrl(file.year - 1, file.month);
  const priorRes = await fetchText(fetchImpl, priorUrl, { 'User-Agent': 'FORGE-Market-Oracle/1.0 (+https://forgedbyaris.com)' });
  if (priorRes.ok) prior = pickCounty(priorRes.text, county.stateFips, county.countyFips);

  const periodLabel = `${String(row.period).slice(0, 4)} YTD through ${String(file.month).padStart(2, '0')}`;
  let trend = null;
  if (prior && prior.totalUnits >= 0) {
    const delta = row.totalUnits - prior.totalUnits;
    const pct = prior.totalUnits > 0 ? (delta / prior.totalUnits) * 100 : null;
    trend = {
      priorPeriod: `${String(prior.period).slice(0, 4)} YTD through ${String(file.month).padStart(2, '0')}`,
      priorTotalUnits: prior.totalUnits,
      changeUnits: delta,
      changePct: pct == null ? null : Math.round(pct * 10) / 10,
    };
  }
  const title = `${row.name}: ${row.totalUnits.toLocaleString()} housing units permitted year-to-date`
    + (trend && trend.changePct != null
      ? ` (${trend.changePct >= 0 ? '+' : ''}${trend.changePct}% vs ${trend.priorPeriod})`
      : '');
  return {
    status: 'ok',
    geography: 'county',
    period: periodLabel,
    source: 'U.S. Census Bureau Building Permits Survey',
    sourceUrl: file.url,
    countyName: row.name,
    totalUnits: row.totalUnits,
    units1: row.units1,
    units5plus: row.units5plus,
    totalValue: row.totalValue,
    trend,
    items: [{
      category: 'permits',
      title,
      url: 'https://www.census.gov/construction/bps/index.html',
      date: `${String(row.period).slice(0, 4)}-${String(file.month).padStart(2, '0')}`,
      source: 'U.S. Census Bureau Building Permits Survey',
      summary: `County-level (not neighborhood) YTD permits: ${row.units1.toLocaleString()} single-family units, ${row.units5plus.toLocaleString()} units in 5+ family buildings.`,
    }],
  };
}

function item(fields) {
  return {
    category: fields.category || 'news',
    title: fields.title,
    url: fields.url,
    date: fields.date || null,
    source: fields.source || sourceNameFromUrl(fields.url),
    summary: fields.summary || '',
  };
}

async function tavilySearch(query, key, fetchImpl) {
  const res = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: 'basic',
      max_results: 6,
      include_answer: false,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((r) => item({
    title: r.title,
    url: r.url,
    date: r.published_date || r.publishedDate || null,
    source: sourceNameFromUrl(r.url),
    summary: r.content || r.snippet || '',
  }));
}

async function braveSearch(query, key, fetchImpl) {
  const url = 'https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({ q: query, count: '6' });
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data.web && data.web.results) || []).map((r) => item({
    title: r.title,
    url: r.url,
    date: (r.age || r.page_age) || null,
    source: r.profile && r.profile.name || sourceNameFromUrl(r.url),
    summary: r.description || '',
  }));
}

async function newsApiSearch(query, key, fetchImpl) {
  const url = 'https://newsapi.org/v2/everything?' + new URLSearchParams({
    q: query, language: 'en', sortBy: 'publishedAt', pageSize: '6',
  });
  const res = await fetchImpl(url, { headers: { 'X-Api-Key': key } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.articles || []).map((r) => item({
    title: r.title,
    url: r.url,
    date: r.publishedAt ? String(r.publishedAt).slice(0, 10) : null,
    source: (r.source && r.source.name) || sourceNameFromUrl(r.url),
    summary: r.description || '',
  }));
}

function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml).split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]
      || (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1];
    const date = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
    const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1];
    if (!title || !link) continue;
    let iso = null;
    if (date) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) iso = d.toISOString().slice(0, 10);
    }
    items.push(item({
      title: title.replace(/\s+/g, ' ').trim(),
      url: link.trim(),
      date: iso,
      source: source ? source.trim() : sourceNameFromUrl(link),
    }));
  }
  return items;
}

async function googleNewsRss(query, fetchImpl) {
  const url = 'https://news.google.com/rss/search?' + new URLSearchParams({
    q: query, hl: 'en-US', gl: 'US', ceid: 'US:en',
  });
  const res = await fetchText(fetchImpl, url, {
    'User-Agent': 'FORGE-Market-Oracle/1.0 (+https://forgedbyaris.com)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  });
  if (!res.ok || !res.text) return [];
  return parseRssItems(res.text);
}

function buildNewsQuery(geography) {
  const parts = [];
  if (geography.name && geography.type === 'neighborhood') parts.push(`"${geography.name}"`);
  if (geography.city && geography.state) parts.push(`"${geography.city}" ${geography.state}`);
  else if (geography.state) parts.push(geography.state);
  else if (geography.label) parts.push(geography.label);
  const where = parts.join(' ');
  return `${where} (development OR "new construction" OR rezoning OR "planning commission" OR employer OR infrastructure OR groundbreaking OR "housing project" OR "industrial park")`.trim();
}

async function loadNews(geography, deps) {
  const fetchImpl = (deps && deps.fetch) || fetch;
  const env = (deps && deps.env) || {};
  const query = buildNewsQuery(geography);
  let items = [];
  let provider = 'none';
  try {
    if (env.TAVILY_API_KEY) {
      items = await tavilySearch(query, env.TAVILY_API_KEY, fetchImpl);
      provider = 'tavily';
    } else if (env.BRAVE_SEARCH_API_KEY) {
      items = await braveSearch(query, env.BRAVE_SEARCH_API_KEY, fetchImpl);
      provider = 'brave';
    } else if (env.NEWSAPI_KEY) {
      items = await newsApiSearch(query, env.NEWSAPI_KEY, fetchImpl);
      provider = 'newsapi';
    } else {
      items = await googleNewsRss(query, fetchImpl);
      provider = 'google_news_rss';
    }
  } catch (e) {
    return {
      status: 'unavailable',
      provider,
      message: 'The news lookup failed. Permit data may still be available. Do not invent developments or headlines.',
      items: [],
    };
  }
  // Dedup by URL, cap at 8, drop items without a URL.
  const seen = new Set();
  const clean = [];
  for (const it of items) {
    if (!it || !it.url || !it.title) continue;
    const key = it.url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(it);
    if (clean.length >= 8) break;
  }
  if (!clean.length) {
    return {
      status: 'unavailable',
      provider,
      message: 'No sourced news items were returned for this area. Do not invent developments, employer moves, or rezoning activity.',
      items: [],
    };
  }
  return { status: 'ok', provider, query, items: clean };
}

async function loadAreaIntel(geography, deps) {
  const [permits, news] = await Promise.all([
    loadPermits(geography, deps).catch((e) => ({
      status: 'unavailable',
      message: 'Permit lookup failed.',
      items: [],
    })),
    loadNews(geography, deps),
  ]);
  const items = []
    .concat((permits && permits.items) || [])
    .concat((news && news.items) || []);
  const notes = [];
  if (permits && permits.status !== 'ok') notes.push(permits.message);
  if (news && news.status !== 'ok') notes.push(news.message);
  notes.push('Permit figures are county-level, not neighborhood-level. News items are only those returned by the source below; ARIS must cite them and must not invent others.');
  return {
    permits,
    news,
    items,
    note: notes.filter(Boolean).join(' '),
  };
}

module.exports = {
  loadAreaIntel,
  loadPermits,
  loadNews,
  parseBpsRow,
  pickCounty,
  bpsUrl,
  parseRssItems,
  buildNewsQuery,
  item,
};
