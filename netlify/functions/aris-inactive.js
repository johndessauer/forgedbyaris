// netlify/functions/aris-inactive.js
//
// GET /api/aris-inactive?days=14
//   -> { days, count, inactiveCount, neverUsedCount, members: [...], warnings: [...] }
// Each member: { memberstackId, email, status, lastArisAt, daysInactive, arisSessions }
//   status 'inactive'   = has an ARIS record, last_aris_at older than N days (default 14)
//   status 'never_used' = active FORGE member (live plan, see below) with NO usable ARIS
//                         record (no member_stats row, or a row with last_aris_at null)
// "Active FORGE member" = at least one ACTIVE/TRIALING plan connection on a FORGE plan
// in _Lib/plans.js, excluding FORGE Zero (free staff plan).
//
// Auth, either of:
//   - header  x-admin-secret: <ARIS_ADMIN_SECRET env var>   (for scripts / bots)
//   - a FORGE admin's Memberstack Bearer token              (John's admin emails)
// Requires add-aris-usage-tracking.sql (member_stats.last_aris_at). Read-only.

const crypto = require('crypto');
const { PLAN_IDS, isLive } = require('./_Lib/plans');
const { json, preflight } = require('./_Lib/http');

const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];
const FORGE_PLAN_IDS = new Set(Object.values(PLAN_IDS).filter(id => id !== PLAN_IDS.FORGE_ZERO));
const PAGE_LIMIT = 100;      // Memberstack max per page
const MAX_PAGES = 200;       // safety stop: 20,000 members
const DAY_MS = 86400000;

function isActiveForgeMember(m) {
  return (m.planConnections || []).some(pc => isLive(pc) && FORGE_PLAN_IDS.has(pc.planId));
}

function secretOk(event, env) {
  const expected = env.ARIS_ADMIN_SECRET || '';
  const h = event.headers || {};
  const got = h['x-admin-secret'] || h['X-Admin-Secret'] || '';
  if (!expected || !got || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Walks every Memberstack page via endCursor/hasNextPage.
async function listAllMembers(listMembers) {
  const all = [];
  let after;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listMembers({ limit: PAGE_LIMIT, after, order: 'ASC' });
    const data = (res && res.data) || [];
    all.push(...data);
    if (!res || !res.hasNextPage || !data.length || res.endCursor == null || res.endCursor === after) {
      return { members: all, truncated: false };
    }
    after = res.endCursor;
  }
  return { members: all, truncated: true };
}

function createHandler(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const now = d.now || (() => new Date());
  let ms;
  const memberstack = () => ms || (ms = require('@memberstack/admin').init(env.MEMBERSTACK_SECRET_KEY));
  const listMembers = d.listMembers || (p => memberstack().members.list(p));
  const getMember = d.getMember || (async id => (await memberstack().members.retrieve({ id })).data);
  const verifyMember = d.verifyMember || (ev => require('./_Lib/verify-member').verifyMember(ev));
  const fetchStats = d.fetchStats || (async () => {
    const { supabase } = require('./_Lib/supabase-client');
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('member_stats')
        .select('memberstack_id, last_aris_at, aris_sessions').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  });

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    if (!secretOk(event, env)) {
      try {
        const memberId = await verifyMember(event);
        const m = await getMember(memberId);
        const email = String((m && m.auth && m.auth.email) || '').toLowerCase();
        if (!ADMIN_EMAILS.includes(email)) return json(403, { error: 'Not authorized' });
      } catch (err) {
        return json(err.statusCode || 401, { error: err.statusCode ? err.message : 'Authentication failed' });
      }
    }

    const days = Math.max(1, Math.min(365, parseInt((event.queryStringParameters || {}).days, 10) || 14));
    const nowMs = now().getTime();
    const cutoff = nowMs - days * DAY_MS;
    try {
      const [rows, list] = await Promise.all([fetchStats(), listAllMembers(listMembers)]);
      const byId = new Map(list.members.map(m => [m.id, m]));
      const statsById = new Map(rows.map(r => [r.memberstack_id, r]));
      const out = [];

      for (const r of rows) {
        if (!r.last_aris_at) continue;
        const t = Date.parse(r.last_aris_at);
        if (!(t < cutoff)) continue;
        let m = byId.get(r.memberstack_id);
        if (!m) { try { m = await getMember(r.memberstack_id); } catch (e) { m = null; } }
        out.push({
          memberstackId: r.memberstack_id,
          email: (m && m.auth && m.auth.email) || null,
          status: 'inactive',
          lastArisAt: r.last_aris_at,
          daysInactive: Math.floor((nowMs - t) / DAY_MS),
          arisSessions: r.aris_sessions || 0,
        });
      }
      out.sort((a, b) => Date.parse(a.lastArisAt) - Date.parse(b.lastArisAt));

      for (const m of list.members) {
        if (!isActiveForgeMember(m)) continue;
        const r = statsById.get(m.id);
        if (r && r.last_aris_at) continue;
        out.push({
          memberstackId: m.id,
          email: (m.auth && m.auth.email) || null,
          status: 'never_used',
          lastArisAt: null,
          daysInactive: null,
          arisSessions: (r && r.aris_sessions) || 0,
        });
      }

      const warnings = [];
      if (list.truncated) warnings.push(`Memberstack listing stopped after ${MAX_PAGES} pages; never_used may be incomplete.`);
      const inactiveCount = out.filter(x => x.status === 'inactive').length;
      return json(200, { days, count: out.length, inactiveCount, neverUsedCount: out.length - inactiveCount, members: out, warnings });
    } catch (err) {
      console.error('aris-inactive error:', err);
      return json(500, { error: 'Server error' });
    }
  };
}

exports.createHandler = createHandler;
exports.isActiveForgeMember = isActiveForgeMember;
exports.handler = (event, context) => createHandler()(event, context);
