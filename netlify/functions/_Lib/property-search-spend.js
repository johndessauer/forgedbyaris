// netlify/functions/_Lib/property-search-spend.js
//
// Spend safeguard for Property Search record purchases (Purchase=1).
// Count-only previews do not come through here.
//
// Counters live in the Netlify Blobs store "property-search-spend", the
// same Blobs service the book download already uses. Two keys:
//   member:<memberstack id>:<YYYY-MM-DD>   per-member records that UTC day
//   global:<YYYY-MM>                        records purchased that UTC month
//
// A check-then-write is not atomic. Two searches at the same moment can
// both pass and both purchase. The cap is a safeguard, not a ledger.
//
// Env:
//   PROPERTY_SEARCH_MEMBER_DAILY_CAP   default 100 (four pages of 25)
//   PROPERTY_SEARCH_MONTHLY_CAP        default 5000
// 0 is a real cap (block purchases). A blank or non-numeric value uses the default.

const STORE_NAME = 'property-search-spend';
const DEFAULT_MEMBER_DAILY_CAP = 100;
const DEFAULT_MONTHLY_CAP = 5000;

let memory = new Map();

function resetMemory() {
  memory = new Map();
}

function memoryStore() {
  return {
    async get(key, opts) {
      if (!memory.has(key)) return null;
      const value = memory.get(key);
      if (opts && opts.type === 'json') return value;
      return JSON.stringify(value);
    },
    async setJSON(key, value) {
      memory.set(key, value);
    },
  };
}

function parseCap(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function capsFromEnv(env) {
  const source = env || {};
  return {
    daily: parseCap(source.PROPERTY_SEARCH_MEMBER_DAILY_CAP, DEFAULT_MEMBER_DAILY_CAP),
    monthly: parseCap(source.PROPERTY_SEARCH_MONTHLY_CAP, DEFAULT_MONTHLY_CAP),
  };
}

function dayKey(memberId, now) {
  return `member:${memberId}:${now.toISOString().slice(0, 10)}`;
}

function monthKey(now) {
  return `global:${now.toISOString().slice(0, 7)}`;
}

function dailyMessage(cap) {
  return `You've reached today's Property Search limit of ${cap} records. It resets tomorrow. Leads you already pulled are still in Saved Leads.`;
}

function monthlyMessage(cap) {
  return `Property Search has reached its monthly limit of ${cap} records. Try again next month, or email support@forgedbyaris.com.`;
}

function isStoreUnavailable(err) {
  const msg = String((err && err.message) || err || '');
  return /not been configured|Missing Blobs|Cannot find module|blobs context|No such module/i.test(msg);
}

function openStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    return getStore(STORE_NAME);
  } catch (err) {
    if (isStoreUnavailable(err)) return memoryStore();
    throw err;
  }
}

async function readRecords(store, key) {
  const value = await store.get(key, { type: 'json' });
  if (!value || typeof value !== 'object') return 0;
  const n = Number(value.records);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// How many more records this member may purchase right now.
// blocked.message is the member-facing sentence when the room is zero.
async function inspect(store, memberId, now, caps) {
  const dailyUsed = await readRecords(store, dayKey(memberId, now));
  const monthlyUsed = await readRecords(store, monthKey(now));
  const dailyRoom = Math.max(0, caps.daily - dailyUsed);
  const monthlyRoom = Math.max(0, caps.monthly - monthlyUsed);
  let blocked = null;
  if (monthlyRoom <= 0) blocked = { scope: 'monthly', message: monthlyMessage(caps.monthly) };
  else if (dailyRoom <= 0) blocked = { scope: 'daily', message: dailyMessage(caps.daily) };
  return {
    dailyUsed,
    monthlyUsed,
    room: blocked ? 0 : Math.min(dailyRoom, monthlyRoom),
    blocked,
  };
}

async function record(store, memberId, count, now) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return;
  const daily = dayKey(memberId, now);
  const month = monthKey(now);
  const dailyUsed = await readRecords(store, daily);
  const monthlyUsed = await readRecords(store, month);
  await store.setJSON(daily, { records: dailyUsed + n });
  await store.setJSON(month, { records: monthlyUsed + n });
}

module.exports = {
  STORE_NAME,
  DEFAULT_MEMBER_DAILY_CAP,
  DEFAULT_MONTHLY_CAP,
  capsFromEnv,
  dailyMessage,
  monthlyMessage,
  isStoreUnavailable,
  openStore,
  memoryStore,
  resetMemory,
  inspect,
  record,
  dayKey,
  monthKey,
};
