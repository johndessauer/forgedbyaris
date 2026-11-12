// Server-side plan gate. Plan ids match the member pages; the browser is
// not what decides whether a function or a member page is served.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

const {
  PLAN_IDS,
  hasActiveMembership,
  hasEmpireAccess,
  isEmpireCategory,
  isEmpireAnalyzerTab,
  EMPIRE_SCENARIO_TITLE,
} = require('../netlify/functions/_Lib/plans');
const { requireMembership, empireLessonPayload } = require('../netlify/functions/_Lib/membership');
const { createHandler: createQuote } = require('../netlify/functions/aris-quote');

function pc(planId, status, priceId) {
  return { planId, status: status || 'ACTIVE', payment: priceId ? { priceId } : undefined };
}

test('live plan rules match the member pages and do not widen Empire', () => {
  const memberOnly = [
    PLAN_IDS.FOUNDATION,
    PLAN_IDS.FOUNDATION_180,
    PLAN_IDS.FORTIVA_1997,
    PLAN_IDS.FORTIVA_1497,
    PLAN_IDS.WEBINAR_997_FOUNDATION,
  ];
  for (const id of memberOnly) {
    assert.equal(hasActiveMembership([pc(id, 'ACTIVE')]), true, id);
    assert.equal(hasEmpireAccess([pc(id, 'ACTIVE')]), false, id);
    assert.equal(hasActiveMembership([pc(id, 'TRIALING')]), true, id);
    assert.equal(hasActiveMembership([pc(id, 'CANCELED')]), false, id);
    assert.equal(hasActiveMembership([pc(id, 'PAST_DUE')]), false, id);
  }

  const both = [
    PLAN_IDS.FORGE_ZERO,
    PLAN_IDS.FOUNDATION_EMPIRE,
    PLAN_IDS.FOUNDATION_EMPIRE_MANUAL,
    PLAN_IDS.FOUNDING_MEMBER,
    PLAN_IDS.FOUNDING_MEMBER_VIP,
    PLAN_IDS.FWN_LAUNCH,
    PLAN_IDS.FWN_ACCELERATOR,
    PLAN_IDS.FWN_997,
    PLAN_IDS.FWN_1797,
    PLAN_IDS.WEBINAR_997,
    PLAN_IDS.WEBINAR_1797,
  ];
  for (const id of both) {
    assert.equal(hasActiveMembership([pc(id, 'ACTIVE')]), true, id);
    assert.equal(hasEmpireAccess([pc(id, 'ACTIVE')]), true, id);
  }

  // Legacy founding / beta prices, including a plan id the pages do not list.
  assert.equal(hasActiveMembership([pc('pln_other', 'ACTIVE', 'prc_-97-direct-ka9b0lq3')]), true);
  assert.equal(hasEmpireAccess([pc('pln_other', 'ACTIVE', 'prc_497-97-3m13d01j8')]), true);
  assert.equal(hasActiveMembership([pc('pln_other', 'CANCELED', 'prc_497-97-3m13d01j8')]), false);

  // Empire add-on alone is not base access. The pages send that member to signup.
  assert.equal(hasActiveMembership([pc(PLAN_IDS.EMPIRE, 'ACTIVE')]), false);
  assert.equal(hasEmpireAccess([pc(PLAN_IDS.EMPIRE, 'ACTIVE')]), true);
  assert.equal(hasActiveMembership([]), false);
  assert.equal(hasActiveMembership(null), false);

  assert.equal(isEmpireCategory('Syndication'), true);
  assert.equal(isEmpireCategory('hotels & hospitality'), true);
  assert.equal(isEmpireCategory('Wholesaling'), false);
  assert.equal(isEmpireAnalyzerTab('Hotel'), true);
  assert.equal(isEmpireAnalyzerTab('hotel'), true);
  assert.equal(isEmpireAnalyzerTab('wholesale'), false);
  assert.equal(isEmpireAnalyzerTab('multi'), false);
});

test('requireMembership uses the verified memberstack id and the live plan', async () => {
  await assert.rejects(
    () => requireMembership({ headers: {} }, {
      verifyMember: async () => { const e = new Error('Missing or malformed Authorization header'); e.statusCode = 401; throw e; },
      getMember: async () => { throw new Error('member should not be loaded'); },
    }),
    (e) => e.statusCode === 401
  );

  const foundation = { planConnections: [pc(PLAN_IDS.FOUNDATION, 'ACTIVE')] };
  const access = await requireMembership({ headers: { authorization: 'Bearer tok' } }, {
    verifyMember: async () => 'mem_foundation',
    getMember: async (id) => {
      assert.equal(id, 'mem_foundation');
      return foundation;
    },
  });
  assert.equal(access.memberId, 'mem_foundation');
  assert.equal(access.active, true);
  assert.equal(access.empire, false);
  assert.equal(access.comps, false);

  await assert.rejects(
    () => requireMembership({}, {
      need: 'empire',
      verifyMember: async () => 'mem_foundation',
      getMember: async () => foundation,
    }),
    (e) => e.statusCode === 403 && /Empire/.test(e.message)
  );

  await assert.rejects(
    () => requireMembership({}, {
      verifyMember: async () => 'mem_lapsed',
      getMember: async () => ({ planConnections: [pc(PLAN_IDS.FOUNDATION_EMPIRE, 'CANCELED')] }),
    }),
    (e) => e.statusCode === 403 && /Active membership/.test(e.message)
  );

  const empire = await requireMembership({}, {
    need: 'empire',
    verifyMember: async () => 'mem_empire',
    getMember: async () => ({ planConnections: [pc(PLAN_IDS.FWN_1797, 'TRIALING')] }),
  });
  assert.equal(empire.memberId, 'mem_empire');
  assert.equal(empire.empire, true);
});

test('empire lesson video ids are served only with empire and are not in the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../education.html'), 'utf8');
  assert.equal(html.includes('St5NUR2RbLI'), false);
  assert.equal(html.includes('fv5w8ssXuR0'), false);
  assert.match(html, /cc_load_policy=0/);
  assert.match(html, /cc_load_policy:\s*'0'/);

  const locked = empireLessonPayload({ empire: false });
  assert.equal(locked.length, 5);
  assert.equal(locked[0].lessons[0].title.includes('Tenants Pay the Mortgage'), true);
  assert.equal(locked[0].lessons[0].youtubeId, undefined);
  assert.equal(locked[0].lessons[0].description, undefined);

  const open = empireLessonPayload({ empire: true });
  const ids = open.flatMap(m => m.lessons.map(l => l.youtubeId));
  assert.equal(ids.length, 18);
  assert.equal(ids[0], 'St5NUR2RbLI');
  assert.ok(open[0].lessons[0].description);

  const lab = fs.readFileSync(path.join(__dirname, '../real-estate-lab.html'), 'utf8');
  assert.ok(lab.includes(EMPIRE_SCENARIO_TITLE));
  const edge = fs.readFileSync(path.join(__dirname, '../netlify/edge-functions/lib/membership.js'), 'utf8');
  assert.ok(edge.includes(EMPIRE_SCENARIO_TITLE));
});

test('member content functions call the shared gate', () => {
  const root = path.join(__dirname, '../netlify/functions');
  const files = [
    'education-data.js', 'video-library.js', 'lab-scenarios.js', 'property-search.js',
    'crm-contacts.js', 'crm-deals.js', 'crm-notes.js', 'saved-deals.js',
    'deal-documents.js', 'profile-data.js', 'member-stats.js', 'membership-check.js',
    'calendar-feed.js',
  ];
  for (const name of files) {
    const src = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(src, /enforceMembership|requireMembership/, name);
  }
  const quote = fs.readFileSync(path.join(root, 'aris-quote.js'), 'utf8');
  assert.match(quote, /requireMembership/);
  const edu = fs.readFileSync(path.join(root, 'education-data.js'), 'utf8');
  assert.match(edu, /isEmpireCategory/);
  assert.match(edu, /empire_lessons/);
  const comps = fs.readFileSync(path.join(root, 'rentcast-comps.js'), 'utf8');
  assert.match(comps, /hasCompsAccess/);
});

test('education get refuses an empire category unless the plan includes empire', async () => {
  const memPath = path.join(__dirname, '../netlify/functions/_Lib/membership.js');
  const sbPath = path.join(__dirname, '../netlify/functions/_Lib/supabase-client.js');
  const state = { empire: false };
  const chain = () => {
    const q = {
      select() { return q; },
      eq() { return q; },
      order() { return Promise.resolve({ data: [], error: null }); },
      maybeSingle: async () => ({ data: { id: 'mod-1', category: 'Syndication', title: 'Syndication' }, error: null }),
    };
    return q;
  };
  const stubs = {
    [memPath]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_1', active: true, empire: state.empire, comps: state.empire } }),
      isEmpireCategory: (c) => String(c || '').toLowerCase() === 'syndication',
      empireLessonPayload: () => [{ module: 1, title: 'Locked', lessons: [{ n: 1, title: 'T' }] }],
    },
    [sbPath]: { supabase: { from() { return chain(); } } },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (stubs[resolved]) return stubs[resolved];
    return orig.apply(this, arguments);
  };
  try {
    const resolved = require.resolve('../netlify/functions/education-data');
    delete require.cache[resolved];
    const mod = require('../netlify/functions/education-data');
    const event = {
      httpMethod: 'GET',
      headers: { authorization: 'Bearer tok' },
      queryStringParameters: { action: 'get', id: 'mod-1', tier: 'rookie' },
    };
    const denied = await mod.handler(event);
    assert.equal(denied.statusCode, 403);
    assert.match(denied.body, /Empire/);

    state.empire = true;
    const allowed = await mod.handler(event);
    assert.equal(allowed.statusCode, 200);
    const body = JSON.parse(allowed.body);
    assert.equal(body.module.category, 'Syndication');

    const lessons = await mod.handler({ ...event, queryStringParameters: { action: 'empire_lessons' } });
    assert.equal(lessons.statusCode, 200);
    assert.equal(JSON.parse(lessons.body).modules[0].title, 'Locked');
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve('../netlify/functions/education-data')];
  }
});

test('aris-quote does not call Anthropic without a live plan', async () => {
  let called = false;
  const handler = createQuote({
    env: { ANTHROPIC_API_KEY: 'k' },
    requireMembership: async () => { const e = new Error('Active membership required'); e.statusCode = 403; throw e; },
    fetch: async () => { called = true; return { json: async () => ({}) }; },
  });
  const res = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
  assert.match(res.body, /membership_required/);
});

async function loadEdge(name) {
  const edge = path.join(__dirname, '../netlify/edge-functions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(edge, name), path.join(dir, name.replace(/\.js$/, '.mjs')));
  fs.copyFileSync(path.join(edge, 'lib', 'membership.js'), path.join(dir, 'lib', 'membership.js'));
  const speech = path.join(edge, 'lib', 'speech-text.js');
  if (fs.existsSync(speech)) fs.copyFileSync(speech, path.join(dir, 'lib', 'speech-text.js'));
  return import(pathToFileURL(path.join(dir, name.replace(/\.js$/, '.mjs'))).href + '?t=' + Math.random());
}

test('member pages and vault files are not served before the plan check', async () => {
  delete globalThis.__forgeTestMembership;
  const mod = await loadEdge('member-page.js');
  let served = false;
  const res = await mod.default(new Request('https://preview.example/education.html'), {
    next: async () => { served = true; return new Response('SECRET PAGE'); },
  });
  const text = await res.text();
  assert.equal(served, false);
  assert.match(text, /Checking your membership/);
  assert.equal(text.includes('SECRET PAGE'), false);

  const doc = await mod.default(new Request('https://preview.example/docs/FORGE-Bill-of-Sale.docx'), {
    next: async () => { served = true; return new Response('DOC BYTES'); },
  });
  assert.equal(served, false);
  assert.match(await doc.text(), /Checking your membership/);
});

test('a live plan receives the page; foundation does not receive deal network', async () => {
  delete globalThis.__forgeTestMembership;
  const mod = await loadEdge('member-page.js');
  const realFetch = globalThis.fetch;
  const flags = { empire: false };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/\.netlify\/functions\/membership-check$/);
    return new Response(JSON.stringify({ memberId: 'mem_1', active: true, empire: flags.empire, comps: flags.empire }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const page = await mod.default(new Request('https://preview.example/property-search.html', {
      headers: { cookie: 'forge_ms=' + encodeURIComponent('jwt') },
    }), { next: async () => new Response('PROPERTY SEARCH') });
    assert.equal(await page.text(), 'PROPERTY SEARCH');
    assert.equal(page.headers.get('cache-control'), 'private, no-store');

    const network = await mod.default(new Request('https://preview.example/deal-network', {
      headers: { cookie: 'forge_ms=jwt' },
    }), { next: async () => new Response('DEAL NETWORK') });
    const lock = await network.text();
    assert.equal(lock.includes('DEAL NETWORK'), false);
    assert.match(lock, /Empire/);

    flags.empire = true;
    const open = await mod.default(new Request('https://preview.example/deal-network.html', {
      headers: { cookie: 'forge_ms=jwt' },
    }), { next: async () => new Response('DEAL NETWORK') });
    assert.equal(await open.text(), 'DEAL NETWORK');

    flags.empire = false;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Active membership required' }), { status: 403 });
    const signup = await mod.default(new Request('https://preview.example/crm.html', {
      headers: { cookie: 'forge_ms=jwt' },
    }), { next: async () => new Response('CRM') });
    assert.equal(signup.status, 302);
    assert.equal(signup.headers.get('location'), 'https://preview.example/signup.html');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('coach and voice require a plan; the public sales widget does not', async () => {
  delete globalThis.__forgeTestMembership;
  const stream = await loadEdge('aris-stream.js');
  const voice = await loadEdge('aris-voice.js');
  const realFetch = globalThis.fetch;
  let anthropic = 0;
  globalThis.Netlify = { env: { get: (k) => (k === 'ANTHROPIC_API_KEY' || k === 'ELEVENLABS_API_KEY' ? 'k' : '') } };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('anthropic')) {
      anthropic += 1;
      return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (u.includes('elevenlabs') || u.includes('text-to-speech')) {
      return new Response('audio', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }
    return new Response(JSON.stringify({ error: 'no' }), { status: 401 });
  };
  try {
    const denied = await stream.default(new Request('https://preview.example/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', messages: [{ role: 'user', content: 'hi' }] }),
    }), {});
    assert.equal(denied.status, 401);
    assert.equal(anthropic, 0);

    const sales = await stream.default(new Request('https://preview.example/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'sales', messages: [{ role: 'user', content: 'hi' }] }),
    }), {});
    assert.equal(sales.status, 200);
    assert.equal(anthropic, 1);

    const noVoice = await voice.default(new Request('https://preview.example/api/aris-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello from ARIS.' }),
    }), {});
    assert.equal(noVoice.status, 401);

    globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_1', active: true, empire: true });
    const yesVoice = await voice.default(new Request('https://preview.example/api/aris-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ text: 'Hello from ARIS.' }),
    }), {});
    assert.equal(yesVoice.status, 200);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.__forgeTestMembership;
  }
});
