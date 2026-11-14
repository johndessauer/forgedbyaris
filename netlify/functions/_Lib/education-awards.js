// Persists Rookie, Investor, and Mogul the first time a member earns them.
// education_level_awards is created by add-education-level-awards.sql, which
// John runs in the Supabase SQL editor. Until that table exists, badges stay
// on the live rule and nothing is written or tagged from here.

const { levelSyncPlan } = require('./education-badges');
const { scheduleUnlockTags } = require('./unlock-tags');

const AWARDS_TABLE = 'education_level_awards';

let missingTableLogged = false;

function isMissingAwardsTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || error.details || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /education_level_awards/i.test(message) && /does not exist|schema cache|could not find the table/i.test(message);
}

function logMissingTable() {
  if (missingTableLogged) return;
  missingTableLogged = true;
  console.error('education_level_awards is missing; run add-education-level-awards.sql before publishing a new topic');
}

async function loadAwards(supabase, memberId) {
  const { data, error } = await supabase
    .from(AWARDS_TABLE)
    .select('level')
    .eq('memberstack_id', memberId);
  if (error) {
    if (isMissingAwardsTable(error)) {
      logMissingTable();
      return { rows: [], missingTable: true };
    }
    throw error;
  }
  return { rows: data || [], missingTable: false };
}

async function recordAwards(supabase, memberId, levels) {
  const rows = [];
  const seen = new Set();
  for (const level of levels || []) {
    if (!level || seen.has(level)) continue;
    seen.add(level);
    rows.push({ memberstack_id: memberId, level });
  }
  if (!rows.length) return { ok: true, recorded: [] };
  const { error } = await supabase
    .from(AWARDS_TABLE)
    .upsert(rows, { onConflict: 'memberstack_id,level', ignoreDuplicates: true });
  if (error) {
    if (isMissingAwardsTable(error)) {
      logMissingTable();
      return { ok: false, missingTable: true, recorded: [] };
    }
    console.error('education level award save failed:', error.message || error);
    return { ok: false, recorded: [] };
  }
  return { ok: true, recorded: rows.map((row) => row.level) };
}

// Saves levels that are true and not stored yet. Unlock tags fire only for
// that first save. A second call, or a call after the SQL backfill, does not
// tag again.
async function persistNewlyEarned(supabase, memberId, modules, progress, access, deps) {
  const loaded = await loadAwards(supabase, memberId);
  const plan = levelSyncPlan(modules, progress, loaded.rows, access);
  if (!loaded.missingTable && plan.toRecord.length) {
    const saved = await recordAwards(supabase, memberId, plan.toRecord);
    if (saved.ok && plan.tagLevels.length) {
      const schedule = (deps && deps.scheduleUnlockTags) || scheduleUnlockTags;
      schedule(memberId, plan.before, plan.badges, deps);
    }
  }
  return plan.badges;
}

module.exports = {
  AWARDS_TABLE,
  isMissingAwardsTable,
  loadAwards,
  recordAwards,
  persistNewlyEarned,
};
