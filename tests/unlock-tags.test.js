const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { badgesFromProgress } = require('../netlify/functions/_Lib/education-badges');
const tags = require('../netlify/functions/_Lib/unlock-tags');

const ENV = { GHL_API_KEY: 'k', GHL_LOCATION_ID: '3dQD2B6ZsBjZVIrWF8WR' };

function ghl(contact) {
  const calls = [];
  async function ghlRequest(apiKey, method, requestPath, body) {
    calls.push({ method, path: requestPath, body });
    if (method === 'GET') return { statusCode: 200, body: { contact } };
    return { statusCode: 201, body: {} };
  }
  return { calls, ghlRequest };
}

test('only a new Rookie or Investor badge is tagged, once', () => {
  assert.deepEqual(tags.newlyEarnedLevels({ rookie: false, investor: false }, { rookie: true, investor: false }), ['rookie']);
  assert.deepEqual(tags.newlyEarnedLevels({ rookie: true, investor: false }, { rookie: true, investor: true }), ['investor']);
  assert.deepEqual(tags.newlyEarnedLevels({ rookie: false, investor: false }, { rookie: true, investor: true }), ['rookie', 'investor']);
  assert.deepEqual(tags.newlyEarnedLevels({ rookie: true, investor: true }, { rookie: true, investor: true, mogul: true }), []);
  assert.deepEqual(tags.UNLOCK_TAGS, { rookie: 'forge-unlock-rookie', investor: 'forge-unlock-investor' });
});

test('the completing quiz is what flips the badge', () => {
  const modules = [{ id: 'a' }, { id: 'b' }];
  const beforeRows = [{ module_id: 'a', tier: 'rookie', passed: true }];
  const before = badgesFromProgress(modules, beforeRows);
  const after = badgesFromProgress(modules, tags.progressAfterPass(beforeRows, 'b', 'rookie'));
  assert.equal(before.rookie, false);
  assert.equal(after.rookie, true);
  assert.deepEqual(beforeRows, [{ module_id: 'a', tier: 'rookie', passed: true }]);
});

test('an existing tag is not posted again, and a new tag is only added', async () => {
  const already = ghl({ id: 'c1', tags: ['member', 'forge-unlock-rookie'] });
  const skipped = await tags.addUnlockTag('Member@Forge.com', 'rookie', ENV, already.ghlRequest);
  assert.equal(skipped.action, 'already');
  assert.equal(already.calls.filter((call) => call.method === 'POST').length, 0);

  const fresh = ghl({ id: 'c1', tags: ['paying-member'] });
  const added = await tags.tagNewlyEarned('mem_1', { rookie: false }, { rookie: true }, {
    email: 'member@forge.com',
    env: ENV,
    ghlRequest: fresh.ghlRequest,
  });
  assert.equal(added.results[0].action, 'tagged');
  assert.equal(fresh.calls[1].method, 'POST');
  assert.equal(fresh.calls[1].path, '/contacts/c1/tags');
  assert.deepEqual(fresh.calls[1].body, { tags: ['forge-unlock-rookie'] });
  assert.equal(fresh.calls.some((call) => call.path === '/contacts/upsert'), false);
});

test('a missing contact, missing email, or GHL error does not throw', async () => {
  const missing = ghl(null);
  const noContact = await tags.addUnlockTag('member@forge.com', 'investor', ENV, missing.ghlRequest);
  assert.equal(noContact.action, 'skipped');
  assert.equal(noContact.reason, 'no_contact');

  const noEmail = await tags.addUnlockTag('', 'rookie', ENV, missing.ghlRequest);
  assert.equal(noEmail.reason, 'no_email');

  const noEnv = await tags.addUnlockTag('member@forge.com', 'rookie', {}, missing.ghlRequest);
  assert.equal(noEnv.reason, 'no_ghl_env');

  const boom = tags.tagNewlyEarned('mem_1', { investor: false }, { investor: true }, {
    email: 'member@forge.com',
    env: ENV,
    ghlRequest: async () => { throw new Error('down'); },
  });
  const failed = await boom;
  assert.equal(failed.results[0].action, 'ghl_failed');

  tags.scheduleUnlockTags('mem_1', { rookie: false }, { rookie: true }, {
    email: 'member@forge.com',
    env: ENV,
    ghlRequest: async () => { throw new Error('down'); },
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test('the quiz response is not waiting on the tag', () => {
  const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/education-data.js'), 'utf8');
  assert.ok(src.indexOf('let badgeSnapshot') < src.indexOf('.upsert('));
  assert.match(src, /scheduleUnlockTags\(memberId, before, after\)/);
  assert.equal(src.includes('await scheduleUnlockTags'), false);
  assert.match(src, /Score \$\{PASS_THRESHOLD_LABEL\[prior\]\} on the \$\{prior\} quiz first to unlock/);
});
