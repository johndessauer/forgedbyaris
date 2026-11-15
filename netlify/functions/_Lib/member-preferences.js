// Member profile preferences stored on member_profiles.preferences.
// The profile page sends a patch. Unknown keys already on the row are kept.
// A missing voice or nudge value means the product default: replies on,
// follow-up reminders on the usual schedule.

const NUDGE_MULTIPLIERS = { frequent: 0.5, default: 1, relaxed: 1.75 };
const NUDGE_VALUES = Object.keys(NUDGE_MULTIPLIERS);
const MARKET_MAX = 80;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanMarket(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MARKET_MAX);
}

function voiceRepliesOn(preferences) {
  return !(preferences && preferences.voiceReplies === false);
}

function defaultMarket(preferences) {
  if (!preferences || typeof preferences.defaultMarket !== 'string') return '';
  return cleanMarket(preferences.defaultMarket);
}

function nudgeSensitivity(preferences) {
  const value = preferences && preferences.nudgeSensitivity;
  return NUDGE_VALUES.includes(value) ? value : 'default';
}

function nudgeMultiplier(preferences) {
  return NUDGE_MULTIPLIERS[nudgeSensitivity(preferences)];
}

function applyPreferencePatch(existing, patch) {
  const base = plainObject(existing) ? existing : {};
  const incoming = plainObject(patch) ? patch : {};
  const next = {};

  for (const [key, value] of Object.entries(base)) {
    if (BLOCKED_KEYS.has(key)) continue;
    next[key] = value;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (key === 'nudgeSensitivity' || key === 'voiceReplies' || key === 'defaultMarket') continue;
    next[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(incoming, 'nudgeSensitivity')) {
    next.nudgeSensitivity = NUDGE_VALUES.includes(incoming.nudgeSensitivity) ? incoming.nudgeSensitivity : 'default';
  } else if (next.nudgeSensitivity !== undefined && !NUDGE_VALUES.includes(next.nudgeSensitivity)) {
    next.nudgeSensitivity = 'default';
  }

  if (Object.prototype.hasOwnProperty.call(incoming, 'voiceReplies')) {
    next.voiceReplies = !(incoming.voiceReplies === false || incoming.voiceReplies === 'false' || incoming.voiceReplies === 0 || incoming.voiceReplies === '0');
  } else if (next.voiceReplies === 'false' || next.voiceReplies === 0 || next.voiceReplies === '0') {
    next.voiceReplies = false;
  }

  if (Object.prototype.hasOwnProperty.call(incoming, 'defaultMarket')) {
    const market = cleanMarket(incoming.defaultMarket);
    if (market) next.defaultMarket = market;
    else delete next.defaultMarket;
  } else if (typeof next.defaultMarket === 'string') {
    const market = cleanMarket(next.defaultMarket);
    if (market) next.defaultMarket = market;
    else delete next.defaultMarket;
  }

  return next;
}

module.exports = {
  MARKET_MAX,
  NUDGE_MULTIPLIERS,
  applyPreferencePatch,
  defaultMarket,
  nudgeMultiplier,
  nudgeSensitivity,
  voiceRepliesOn,
};
