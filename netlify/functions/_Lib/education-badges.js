// Education level badges, shared by the lesson list and the book download.
// A badge is earned only when every currently published module has been
// passed at that tier. Rookie, Investor, and Mogul are the level names
// members see. A higher badge counts as the levels below it for book access.

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

function badgesFromProgress(modules, progressRows) {
  const progressByModule = {};
  for (const row of progressRows || []) {
    if (!row || !row.module_id) continue;
    if (!progressByModule[row.module_id]) progressByModule[row.module_id] = {};
    progressByModule[row.module_id][row.tier] = row;
  }
  const list = modules || [];
  const badges = {};
  for (const tier of TIER_ORDER) {
    badges[tier] =
      list.length > 0 &&
      list.every((module) => {
        const saved = progressByModule[module.id] && progressByModule[module.id][tier];
        return !!(saved && saved.passed);
      });
  }
  return badges;
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
  badgesFromProgress,
  meetsLevel,
  denialMessage,
  missingMessage,
};
