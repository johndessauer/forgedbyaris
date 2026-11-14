// Education level badges, shared by the lesson list and the book download.
// A level is earned by passing every published topic that member is allowed
// to take. Empire categories stay in the list, but they count only for a
// member whose plan includes Empire — Foundation members cannot open those
// quizzes, so those topics cannot block Rookie, Investor, or Mogul.
//
// Once a level is stored in education_level_awards it stays, including after
// a new topic is published. A higher level still counts as the levels below it.

const { isEmpireCategory } = require('./plans');

const TIER_ORDER = ['rookie', 'investor', 'mogul'];

const LEVEL_LABEL = { rookie: 'Rookie', investor: 'Investor', mogul: 'Mogul' };

const BOOK_STORE = 'forge-books';

const BOOKS = {
  'real-estate-h2o': {
    id: 'real-estate-h2o',
    title: 'Real Estate H2O',
    minLevel: 'rookie',
    blobKey: 'real-estate-h2o.pdf',
    filename: 'Real-Estate-H2O.pdf',
  },
  'apartment-confidential': {
    id: 'apartment-confidential',
    title: 'Apartment Confidential',
    minLevel: 'investor',
    blobKey: 'apartment-confidential.pdf',
    filename: 'Apartment-Confidential.pdf',
  },
};

function awardFlags(earnedRows) {
  const flags = { rookie: false, investor: false, mogul: false };
  for (const row of earnedRows || []) {
    const level = row && (row.level || row.tier);
    if (Object.prototype.hasOwnProperty.call(flags, level)) flags[level] = true;
  }
  return flags;
}

// Mogul counts as Investor and Rookie. Investor counts as Rookie.
function cascadeLevels(badges) {
  const out = {
    rookie: !!(badges && badges.rookie),
    investor: !!(badges && badges.investor),
    mogul: !!(badges && badges.mogul),
  };
  if (out.mogul) out.investor = true;
  if (out.investor) out.rookie = true;
  return out;
}

// access omitted: every published module counts (the strict historical rule).
// access.empire false: Empire categories are visible but not required.
function modulesForLevel(modules, access) {
  const list = modules || [];
  if (!access || access.empire) return list;
  return list.filter((module) => !isEmpireCategory(module && module.category));
}

function badgesFromProgress(modules, progressRows, earnedRows, access) {
  const progressByModule = {};
  for (const row of progressRows || []) {
    if (!row || !row.module_id) continue;
    if (!progressByModule[row.module_id]) progressByModule[row.module_id] = {};
    progressByModule[row.module_id][row.tier] = row;
  }
  const countable = modulesForLevel(modules, access);
  const stored = awardFlags(earnedRows);
  const badges = {};
  for (const tier of TIER_ORDER) {
    const passedAll =
      countable.length > 0 &&
      countable.every((module) => {
        const saved = progressByModule[module.id] && progressByModule[module.id][tier];
        return !!(saved && saved.passed);
      });
    badges[tier] = passedAll || stored[tier];
  }
  return cascadeLevels(badges);
}

// Rows to insert. Already-stored levels are left alone so earned_at stays put.
function levelsToRecord(badges, earnedRows) {
  const stored = awardFlags(earnedRows);
  return TIER_ORDER.filter((tier) => badges && badges[tier] && !stored[tier]);
}

// before is the cascade of what is already stored, not the live quiz set.
// A new topic cannot clear a stored level, so this does not ask for another tag.
function levelSyncPlan(modules, progressRows, earnedRows, access) {
  const before = cascadeLevels(awardFlags(earnedRows));
  const badges = badgesFromProgress(modules, progressRows, earnedRows, access);
  const { newlyEarnedLevels } = require('./unlock-tags');
  return {
    before,
    badges,
    toRecord: levelsToRecord(badges, earnedRows),
    tagLevels: newlyEarnedLevels(before, badges),
  };
}

function meetsLevel(badges, minLevel) {
  const need = TIER_ORDER.indexOf(minLevel);
  if (need < 0) return false;
  return TIER_ORDER.some((tier, index) => index >= need && !!(badges && badges[tier]));
}

function denialMessage(book) {
  return `Earn the ${LEVEL_LABEL[book.minLevel]} level to download ${book.title}.`;
}

function missingMessage(book) {
  return `${book.title} isn't available for download yet. Check back soon.`;
}

module.exports = {
  TIER_ORDER,
  LEVEL_LABEL,
  BOOK_STORE,
  BOOKS,
  awardFlags,
  cascadeLevels,
  modulesForLevel,
  badgesFromProgress,
  levelsToRecord,
  levelSyncPlan,
  meetsLevel,
  denialMessage,
  missingMessage,
};
