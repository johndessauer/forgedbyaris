const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  applyPreferencePatch,
  defaultMarket,
  nudgeMultiplier,
  voiceRepliesOn,
} = require('../netlify/functions/_Lib/member-preferences');
const client = require('../assets/js/member-preferences.js');

const ROOT = path.join(__dirname, '..');

test('preference patch keeps unknown keys and clears an empty market', () => {
  const saved = applyPreferencePatch(
    { nudgeSensitivity: 'relaxed', voiceReplies: true, defaultMarket: 'Gary, IN', note: 'keep' },
    { voiceReplies: false, defaultMarket: '   ', nudgeSensitivity: 'nope' }
  );
  assert.deepEqual(saved, {
    nudgeSensitivity: 'default',
    voiceReplies: false,
    note: 'keep',
  });
});

test('preference patch stores a market and the three reminder paces', () => {
  const saved = applyPreferencePatch({}, {
    voiceReplies: true,
    nudgeSensitivity: 'frequent',
    defaultMarket: '  Crown Point,   IN 46307  ',
  });
  assert.equal(saved.voiceReplies, true);
  assert.equal(saved.nudgeSensitivity, 'frequent');
  assert.equal(saved.defaultMarket, 'Crown Point, IN 46307');
  assert.equal(saved.defaultMarket.length <= 80, true);

  const later = applyPreferencePatch(saved, { nudgeSensitivity: 'relaxed' });
  assert.equal(later.nudgeSensitivity, 'relaxed');
  assert.equal(later.defaultMarket, 'Crown Point, IN 46307');
  assert.equal(later.voiceReplies, true);
});

test('a partial patch does not turn voice off or invent a market', () => {
  const saved = applyPreferencePatch({ voiceReplies: true }, { nudgeSensitivity: 'relaxed' });
  assert.equal(saved.voiceReplies, true);
  assert.equal(saved.defaultMarket, undefined);
  assert.equal(voiceRepliesOn(undefined), true);
  assert.equal(voiceRepliesOn({}), true);
  assert.equal(voiceRepliesOn({ voiceReplies: false }), false);
  assert.equal(defaultMarket({}), '');
  assert.equal(defaultMarket({ defaultMarket: '  46617 ' }), '46617');
});

test('follow-up reminder pace scales the CRM stale threshold', () => {
  assert.equal(nudgeMultiplier(undefined), 1);
  assert.equal(nudgeMultiplier({}), 1);
  assert.equal(nudgeMultiplier({ nudgeSensitivity: 'default' }), 1);
  assert.equal(nudgeMultiplier({ nudgeSensitivity: 'frequent' }), 0.5);
  assert.equal(nudgeMultiplier({ nudgeSensitivity: 'relaxed' }), 1.75);
  assert.equal(nudgeMultiplier({ nudgeSensitivity: 'weekly' }), 1);

  // Same rounding crm-deals.js applies: Math.max(1, Math.round(base * multiplier)).
  const days = (base, prefs) => Math.max(1, Math.round(base * nudgeMultiplier(prefs)));
  assert.equal(days(1, { nudgeSensitivity: 'frequent' }), 1);
  assert.equal(days(3, { nudgeSensitivity: 'frequent' }), 2);
  assert.equal(days(1, { nudgeSensitivity: 'default' }), 1);
  assert.equal(days(5, { nudgeSensitivity: 'relaxed' }), 9);
});

test('the browser reader matches the saved profile values', () => {
  assert.equal(client.voiceRepliesOn({ voiceReplies: false }), false);
  assert.equal(client.voiceRepliesOn({}), true);
  assert.equal(client.nudgeSensitivity({ nudgeSensitivity: 'frequent' }), 'frequent');
  assert.equal(client.nudgeSensitivity({}), 'default');
  assert.equal(client.defaultMarket({ defaultMarket: ' South Bend, IN ' }), 'South Bend, IN');
  assert.equal(client.defaultMarket({ defaultMarket: false }), '');
});

test('profile card labels and the tools that honor them', () => {
  const profile = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
  assert.match(profile, /profile-card-label">Preferences</);
  assert.doesNotMatch(profile, /Preferences — Coming Soon/);
  assert.match(profile, />ARIS voice replies</);
  assert.match(profile, /Play ARIS's spoken replies/);
  assert.match(profile, />Follow-up reminders</);
  assert.match(profile, />Sooner</);
  assert.match(profile, />Standard</);
  assert.match(profile, />Later</);
  assert.match(profile, />Default market</);
  assert.match(profile, /placeholder="City, ST or ZIP"/);
  assert.match(profile, />Save Preferences</);
  assert.match(profile, /assets\/js\/member-preferences\.js/);

  const coach = fs.readFileSync(path.join(ROOT, 'aris-coach.html'), 'utf8');
  assert.match(coach, /ForgePreferences\.voiceRepliesOn/);
  assert.match(coach, /if \(!arisVoiceReplies\) return/);

  const lab = fs.readFileSync(path.join(ROOT, 'real-estate-lab.html'), 'utf8');
  assert.match(lab, /ForgePreferences\.voiceRepliesOn/);
  assert.match(lab, /voiceMuted = true/);

  const oracle = fs.readFileSync(path.join(ROOT, 'market-oracle.html'), 'utf8');
  assert.match(oracle, /ForgePreferences\.defaultMarket/);
  assert.match(oracle, /searchInput/);

  const search = fs.readFileSync(path.join(ROOT, 'property-search.html'), 'utf8');
  assert.match(search, /ForgePreferences\.defaultMarket/);
  assert.match(search, /Crown Point, IN 46307/);

  const deals = fs.readFileSync(path.join(ROOT, 'netlify/functions/crm-deals.js'), 'utf8');
  assert.match(deals, /nudgeMultiplier\(profileRow\?\.preferences\)/);

  const api = fs.readFileSync(path.join(ROOT, 'netlify/functions/profile-data.js'), 'utf8');
  assert.match(api, /applyPreferencePatch/);
});
