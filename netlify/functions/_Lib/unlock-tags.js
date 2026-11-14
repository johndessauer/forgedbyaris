// Tags a FORGE GoHighLevel contact the first time a member earns Rookie
// or Investor. Uses dunning.js ghlRequest (same location, same tag POST).
// The tag is added only, never removed, and skipped when it is already on
// the contact so a workflow does not fire twice. Failures are logged and
// never thrown to the quiz handler.

const { ghlRequest } = require('./dunning');

const UNLOCK_TAGS = {
  rookie: 'forge-unlock-rookie',
  investor: 'forge-unlock-investor',
};

function newlyEarnedLevels(before, after) {
  return ['rookie', 'investor'].filter((level) => !(before && before[level]) && !!(after && after[level]));
}

function progressAfterPass(progress, moduleId, tier) {
  const rows = (progress || []).filter((row) => !(row && row.module_id === moduleId && row.tier === tier));
  rows.push({ module_id: moduleId, tier, passed: true });
  return rows;
}

async function findContact(request, env, email) {
  const res = await request(
    env.GHL_API_KEY,
    'GET',
    '/contacts/search/duplicate?locationId=' + encodeURIComponent(env.GHL_LOCATION_ID)
      + '&email=' + encodeURIComponent(email)
  );
  const contact = res && res.body && res.body.contact;
  return contact && contact.id ? contact : null;
}

async function addUnlockTag(email, level, env, request) {
  const tag = UNLOCK_TAGS[level];
  if (!tag) return { action: 'ignored', reason: 'unknown_level' };
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { action: 'skipped', reason: 'no_email' };
  if (!env || !env.GHL_API_KEY || !env.GHL_LOCATION_ID) return { action: 'skipped', reason: 'no_ghl_env' };
  const ghl = request || ghlRequest;
  const contact = await findContact(ghl, env, normalized);
  if (!contact) return { action: 'skipped', reason: 'no_contact' };
  const tags = Array.isArray(contact.tags) ? contact.tags.map((item) => String(item).toLowerCase()) : [];
  if (tags.includes(tag)) return { action: 'already', tag };
  const res = await ghl(env.GHL_API_KEY, 'POST', '/contacts/' + encodeURIComponent(contact.id) + '/tags', { tags: [tag] });
  const ok = res && res.statusCode >= 200 && res.statusCode < 300;
  if (!ok) console.error('unlock tag failed', tag, res && res.statusCode);
  return { action: ok ? 'tagged' : 'ghl_failed', tag };
}

async function memberEmail(memberId, getMember) {
  if (!memberId || typeof getMember !== 'function') return '';
  const member = await getMember(memberId);
  const email = member && ((member.auth && member.auth.email) || member.email);
  return String(email || '').trim().toLowerCase();
}

async function tagNewlyEarned(memberId, before, after, deps) {
  const levels = newlyEarnedLevels(before, after);
  if (!levels.length) return { action: 'none', results: [] };
  const options = deps || {};
  const env = options.env || process.env;
  let email = options.email;
  if (!email) email = await memberEmail(memberId, options.getMember);
  const results = [];
  for (const level of levels) {
    try {
      results.push(await addUnlockTag(email, level, env, options.ghlRequest));
    } catch (err) {
      console.error('unlock tag error', level, err && err.message);
      results.push({ action: 'ghl_failed', level });
    }
  }
  return { action: 'done', results };
}

function scheduleUnlockTags(memberId, before, after, deps) {
  if (!newlyEarnedLevels(before, after).length) return;
  Promise.resolve()
    .then(() => tagNewlyEarned(memberId, before, after, deps))
    .catch((err) => console.error('unlock tag failed', err && err.message));
}

module.exports = {
  UNLOCK_TAGS,
  newlyEarnedLevels,
  progressAfterPass,
  addUnlockTag,
  tagNewlyEarned,
  scheduleUnlockTags,
};
