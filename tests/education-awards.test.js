const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const badges = require('../netlify/functions/_Lib/education-badges');
const awards = require('../netlify/functions/_Lib/education-awards');
const tags = require('../netlify/functions/_Lib/unlock-tags');
const download = require('../netlify/functions/book-download');

const ROOT = path.join(__dirname, '..');

const wholesale = { id: 'wholesale', category: 'Wholesaling', published: true };
const creative = { id: 'creative', category: 'Creative Finance', published: true };
const syndication = { id: 'syndication', category: 'Syndication', published: true };
const fresh = { id: 'fresh', category: 'Fix & Flip', published: true };

function passed(moduleId, tier) {
  return { module_id: moduleId, tier, passed: true };
}

function storeFor(bytesByKey) {
  return {
    async get(key) {
      const bytes = bytesByKey[key];
      if (!bytes) return null;
      return (async function* () { yield bytes; })();
    },
  };
}

test('an earned Investor level survives a new topic and still opens both books', async () => {
  const stored = [{ level: 'rookie' }, { level: 'investor' }];
  const published = [wholesale, creative, syndication, fresh];
  const progress = [
    passed('wholesale', 'rookie'), passed('wholesale', 'investor'),
    passed('creative', 'rookie'), passed('creative', 'investor'),
    passed('syndication', 'rookie'), passed('syndication', 'investor'),
  ];
  const foundation = { empire: false };
  const level = badges.badgesFromProgress(published, progress, stored, foundation);
  assert.equal(level.investor, true);
  assert.equal(level.rookie, true);
  assert.equal(level.mogul, false);
  assert.equal(badges.meetsLevel(level, 'rookie'), true);
  assert.equal(badges.meetsLevel(level, 'investor'), true);
  assert.deepEqual(badges.levelSyncPlan(published, progress, stored, foundation).tagLevels, []);
  assert.deepEqual(tags.newlyEarnedLevels(
    badges.badgesFromProgress([wholesale, creative, syndication], progress, stored, foundation),
    badges.badgesFromProgress(published, tags.progressAfterPass(progress, 'fresh', 'rookie'), stored, foundation)
  ), []);

  const pdf = Buffer.from('%PDF-1.4 kept');
  const handler = download.createHandler({
    enforceMembership: async () => ({ access: { memberId: 'mem_investor', empire: false } }),
    loadBadges: async () => level,
    getStore: () => storeFor({
      'real-estate-h2o.pdf': pdf,
      'apartment-confidential.pdf': pdf,
    }),
  });
  for (const book of ['real-estate-h2o', 'apartment-confidential']) {
    const res = await handler({ httpMethod: 'GET', queryStringParameters: { book }, headers: {} });
    assert.equal(res.statusCode, 200, book);
    assert.equal(res.headers['Content-Type'], 'application/pdf');
  }
});

test('a member without Rookie still has to pass every topic they are allowed to take', () => {
  const published = [wholesale, creative, syndication];
  const one = badges.badgesFromProgress(published, [passed('wholesale', 'rookie')], [], { empire: false });
  assert.deepEqual(one, { rookie: false, investor: false, mogul: false });

  const foundationDone = badges.badgesFromProgress(published, [
    passed('wholesale', 'rookie'),
    passed('creative', 'rookie'),
  ], [], { empire: false });
  assert.equal(foundationDone.rookie, true);
  assert.equal(foundationDone.investor, false);

  const empireStillShort = badges.badgesFromProgress(published, [
    passed('wholesale', 'rookie'),
    passed('creative', 'rookie'),
  ], [], { empire: true });
  assert.equal(empireStillShort.rookie, false);

  const withNewFoundationTopic = badges.badgesFromProgress(
    published.concat([fresh]),
    [passed('wholesale', 'rookie'), passed('creative', 'rookie')],
    [],
    { empire: false }
  );
  assert.equal(withNewFoundationTopic.rookie, false);

  assert.deepEqual(
    badges.badgesFromProgress([syndication], [], [], { empire: false }),
    { rookie: false, investor: false, mogul: false }
  );
});

test('the first save tags Rookie once, and a stored Investor is not tagged again', async () => {
  const calls = [];
  const state = {
    modules: [wholesale, creative, syndication],
    progress: [passed('wholesale', 'rookie'), passed('creative', 'rookie')],
    awards: [],
  };
  const supabase = fakeSupabase(state);
  const deps = {
    scheduleUnlockTags(memberId, before, after) {
      calls.push(tags.newlyEarnedLevels(before, after));
    },
  };
  const access = { empire: false };

  const first = await awards.persistNewlyEarned(supabase, 'mem_new', state.modules, state.progress, access, deps);
  assert.equal(first.rookie, true);
  assert.equal(first.investor, false);
  assert.deepEqual(calls, [['rookie']]);
  assert.deepEqual(state.awards.map((row) => row.level), ['rookie']);

  const second = await awards.persistNewlyEarned(supabase, 'mem_new', state.modules, state.progress, access, deps);
  assert.equal(second.rookie, true);
  assert.deepEqual(calls, [['rookie']]);

  const kept = [wholesale, creative, syndication, fresh];
  const storedInvestor = [{ level: 'rookie' }, { level: 'investor' }];
  const plan = badges.levelSyncPlan(kept, [
    passed('wholesale', 'investor'),
    passed('creative', 'investor'),
  ], storedInvestor, access);
  assert.equal(plan.badges.investor, true);
  assert.deepEqual(plan.tagLevels, []);
  assert.deepEqual(plan.toRecord, []);
});

test('a missing awards table keeps the live level and does not tag', async () => {
  const state = {
    modules: [wholesale, creative],
    progress: [passed('wholesale', 'rookie'), passed('creative', 'rookie')],
    awards: [],
    missingTable: true,
  };
  let tagged = 0;
  const badgesForMember = await awards.persistNewlyEarned(
    fakeSupabase(state),
    'mem_new',
    state.modules,
    state.progress,
    { empire: false },
    { scheduleUnlockTags() { tagged += 1; } }
  );
  assert.equal(badgesForMember.rookie, true);
  assert.equal(tagged, 0);
  assert.deepEqual(state.awards, []);
});

test('the lesson list uses stored levels and does not tag a member who already earned Investor', async () => {
  const tagCalls = [];
  const state = {
    modules: [
      { ...wholesale, title: 'Wholesaling', slug: 'wholesaling', order_index: 1 },
      { ...creative, title: 'Creative Finance', slug: 'creative', order_index: 2 },
      { ...syndication, title: 'Syndication', slug: 'syndication', order_index: 3 },
      { ...fresh, title: 'Fix & Flip', slug: 'fix-flip', order_index: 4 },
    ],
    progress: [
      { memberstack_id: 'mem_investor', ...passed('wholesale', 'investor') },
      { memberstack_id: 'mem_investor', ...passed('creative', 'investor') },
    ],
    awards: [
      { memberstack_id: 'mem_investor', level: 'rookie' },
      { memberstack_id: 'mem_investor', level: 'investor' },
    ],
    upserts: [],
  };
  const handler = loadEducationData(state, tagCalls);
  const res = await handler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer tok' },
    queryStringParameters: { action: 'list' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.modules.length, 4);
  assert.equal(body.badges.investor, true);
  assert.equal(body.badges.rookie, true);
  assert.equal(badges.meetsLevel(body.badges, 'investor'), true);
  assert.equal(badges.meetsLevel(body.badges, 'rookie'), true);
  assert.deepEqual(tagCalls, []);
  assert.equal(state.upserts.length, 0);
});

test('the backfill SQL is idempotent and does not send unlock tags', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'add-education-level-awards.sql'), 'utf8');
  assert.match(sql, /create table if not exists education_level_awards/i);
  assert.match(sql, /primary key \(memberstack_id, level\)/i);
  assert.match(sql, /on conflict \(memberstack_id, level\) do nothing/i);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /education_modules', 'category'/);
  assert.match(sql, /education_progress', 'passed'/);
  assert.equal(/delete\s+from/i.test(sql), false);
  assert.equal(/forge-unlock|ghl|gohighlevel/i.test(sql), false);
  assert.match(sql, /grant select, insert, update, delete on table education_level_awards to service_role/i);
});

function fakeSupabase(state) {
  return {
    from(table) {
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push([col, val]); return builder; },
        order() { return builder; },
        upsert(rows) {
          state.upserts = state.upserts || [];
          state.upserts.push(rows);
          if (state.missingTable) {
            return Promise.resolve({ error: { code: 'PGRST205', message: "Could not find the table 'public.education_level_awards' in the schema cache" } });
          }
          for (const row of rows) {
            const exists = state.awards.some((item) => item.memberstack_id === row.memberstack_id && item.level === row.level);
            if (!exists) state.awards.push({ memberstack_id: row.memberstack_id, level: row.level });
          }
          return Promise.resolve({ error: null });
        },
        then(resolve, reject) {
          try { resolve(builder._read()); }
          catch (err) { reject(err); }
        },
        _read() {
          if (table === 'education_level_awards' && state.missingTable) {
            return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.education_level_awards' in the schema cache" } };
          }
          let rows = [];
          if (table === 'education_modules') rows = state.modules;
          else if (table === 'education_progress') rows = state.progress;
          else if (table === 'education_level_awards') rows = state.awards;
          for (const [col, val] of filters) rows = rows.filter((row) => row[col] === val);
          return { data: rows.map((row) => ({ ...row })), error: null };
        },
      };
      return builder;
    },
  };
}

function loadEducationData(state, tagCalls) {
  const memPath = path.join(ROOT, 'netlify/functions/_Lib/membership.js');
  const sbPath = path.join(ROOT, 'netlify/functions/_Lib/supabase-client.js');
  const tagPath = path.join(ROOT, 'netlify/functions/_Lib/unlock-tags.js');
  const realTags = require(tagPath);
  const stubs = {
    [memPath]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_investor', active: true, empire: false } }),
      isEmpireCategory: require(path.join(ROOT, 'netlify/functions/_Lib/plans')).isEmpireCategory,
      empireLessonPayload: () => [],
    },
    [sbPath]: { supabase: fakeSupabase(state) },
    [tagPath]: {
      ...realTags,
      scheduleUnlockTags(memberId, before, after) {
        tagCalls.push(realTags.newlyEarnedLevels(before, after));
      },
    },
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
    delete require.cache[require.resolve('../netlify/functions/_Lib/education-awards')];
    return require('../netlify/functions/education-data').handler;
  } finally {
    Module._load = orig;
  }
}
