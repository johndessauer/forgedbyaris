// In-memory stand-in for _Lib/comps-store.js. reserveCall() mirrors the
// logic of reserve_rentcast_call() in add-comping-engine-tables.sql; the
// SQL itself is tested against real Postgres by scripts/test-sql.sh.
const crypto = require('crypto');

function createMemoryStore(opts) {
  const o = opts || {};
  const cache = new Map();
  const budget = new Map();
  const calls = [];
  const reports = new Map();

  return {
    cache, budget, calls, reports,
    failReserve: !!o.failReserve,

    async getCache(key, now) {
      const row = cache.get(key);
      if (!row) return null;
      if (Date.parse(row.expires_at) <= (now || new Date()).getTime()) return null;
      return { response: row.response, fetched_at: row.fetched_at, expires_at: row.expires_at };
    },
    async putCache(row) { cache.set(row.key, { ...row }); },

    async reserveCall({ month, cap, baseFee, included, overage }) {
      if (this.failReserve) throw new Error('simulated budget outage');
      if (!budget.has(month)) budget.set(month, { month, calls: 0, spend_usd: baseFee, cap_usd: cap, alert_80_sent: false, alert_100_sent: false, alert_1000_sent: false });
      const b = budget.get(month);
      b.cap_usd = cap;
      const cost = b.calls >= included ? overage : 0;
      if (b.spend_usd + cost > b.cap_usd + 1e-9) {
        let a100 = false;
        if (!b.alert_100_sent) { b.alert_100_sent = true; a100 = true; }
        return { allowed: false, cost, calls: b.calls, spend: b.spend_usd, cap: b.cap_usd, alert80: false, alert100: a100, alert1000: false };
      }
      b.calls += 1;
      b.spend_usd = Math.round((b.spend_usd + cost) * 10000) / 10000;
      const a80 = !b.alert_80_sent && b.spend_usd >= 0.8 * b.cap_usd;
      const a100 = !b.alert_100_sent && b.spend_usd >= b.cap_usd;
      const a1000 = !b.alert_1000_sent && b.calls >= 1000;
      b.alert_80_sent = b.alert_80_sent || a80;
      b.alert_100_sent = b.alert_100_sent || a100;
      b.alert_1000_sent = b.alert_1000_sent || a1000;
      return { allowed: true, cost, calls: b.calls, spend: b.spend_usd, cap: b.cap_usd, alert80: a80, alert100: a100, alert1000: a1000 };
    },
    async releaseCall({ month, cost }) {
      const b = budget.get(month); if (!b) return;
      b.calls = Math.max(0, b.calls - 1);
      b.spend_usd = Math.max(0, b.spend_usd - cost);
    },
    async logCall(row) { calls.push({ ...row }); },
    async countMemberLiveCalls(memberId, sinceIso) {
      return calls.filter(c => c.memberstack_id === memberId && !c.cache_hit && c.http_status < 400 && c.created_at >= sinceIso).length;
    },
    async getBudget(month) { return budget.get(month) || null; },
    async listCallsSince(sinceIso) { return calls.filter(c => c.created_at >= sinceIso); },
    async insertReport(row) {
      const r = { id: crypto.randomUUID(), share_token: null, snapshot: null, created_at: new Date('2026-10-12T00:00:00Z').toISOString(), ...row };
      reports.set(r.id, r); return { ...r };
    },
    async updateReport(id, memberId, patch) {
      const r = reports.get(id);
      if (!r || r.memberstack_id !== memberId) return null;
      Object.assign(r, patch); return { ...r };
    },
    async getReport(id, memberId) {
      const r = reports.get(id);
      return r && r.memberstack_id === memberId ? { ...r } : null;
    },
    async getReportByToken(token) {
      for (const r of reports.values()) if (r.share_token && r.share_token === token) return { ...r };
      return null;
    },
  };
}

module.exports = { createMemoryStore };
