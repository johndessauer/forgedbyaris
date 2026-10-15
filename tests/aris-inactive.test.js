const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../netlify/functions/aris-inactive');

const NOW = new Date('2026-10-15T15:00:00Z');
const ago = d => new Date(NOW.getTime() - d * 86400000).toISOString();
const live = planId => ({ planConnections: [{ planId, status: 'ACTIVE' }] });
const EMPIRE = 'pln_empire--871c00ah3';

function members() {
  return [
    { id: 'm1', auth: { email: 'old@x.com' }, ...live(EMPIRE) },              // inactive 20d
    { id: 'm2', auth: { email: 'recent@x.com' }, ...live(EMPIRE) },           // used 3d ago
    { id: 'm3', auth: { email: 'never@x.com' }, ...live('pln_foundation--s11cv0hs9') }, // no row
    { id: 'm4', auth: { email: 'nullrow@x.com' }, planConnections: [{ planId: EMPIRE, status: 'trialing' }] }, // row, null ts
    { id: 'm5', auth: { email: 'canceled@x.com' }, planConnections: [{ planId: EMPIRE, status: 'CANCELED' }] },
    { id: 'm6', auth: { email: 'staff@x.com' }, ...live('pln_forge-zero-psnx0aea') },
    { id: 'm7', auth: { email: 'other@x.com' }, ...live('pln_not-forge') },
  ];
}
const ROWS = [
  { memberstack_id: 'm1', last_aris_at: ago(20), aris_sessions: 4 },
  { memberstack_id: 'm2', last_aris_at: ago(3), aris_sessions: 9 },
  { memberstack_id: 'm4', last_aris_at: null, aris_sessions: 2 },
  { memberstack_id: 'gone', last_aris_at: ago(40), aris_sessions: 1 }, // not in list -> retrieve
];

function setup(pageSize = 2) {
  const all = members(); const calls = [];
  const listMembers = async ({ limit, after }) => {
    calls.push({ limit, after });
    const start = after == null ? 0 : after;
    const data = all.slice(start, start + pageSize);
    return { data, hasNextPage: start + pageSize < all.length, endCursor: start + data.length };
  };
  const handler = createHandler({
    env: { ARIS_ADMIN_SECRET: 's3cret' }, now: () => NOW, fetchStats: async () => ROWS, listMembers,
    getMember: async id => (id === 'gone' ? { id, auth: { email: 'gone@x.com' } } : null),
    verifyMember: async () => { const e = new Error('no'); e.statusCode = 401; throw e; },
  });
  return { handler, calls };
}
const get = (h, headers = { 'x-admin-secret': 's3cret' }, qs = {}) =>
  h({ httpMethod: 'GET', headers, queryStringParameters: qs }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

test('returns inactive + never_used, paginating every Memberstack page', async () => {
  const { handler, calls } = setup(2);
  const { status, body } = await get(handler);
  assert.equal(status, 200);
  assert.equal(calls.length, 4); // 7 members, 2 per page
  assert.deepEqual(calls.map(c => c.after), [undefined, 2, 4, 6]);
  assert.ok(calls.every(c => c.limit === 100));
  const by = Object.fromEntries(body.members.map(m => [m.memberstackId, m]));
  assert.deepEqual(body.members.filter(m => m.status === 'inactive').map(m => m.memberstackId), ['gone', 'm1']);
  assert.equal(by.m1.daysInactive, 20);
  assert.equal(by.gone.email, 'gone@x.com');
  assert.deepEqual(body.members.filter(m => m.status === 'never_used').map(m => m.memberstackId).sort(), ['m3', 'm4']);
  assert.equal(by.m3.lastArisAt, null);
  assert.ok(!by.m2 && !by.m5 && !by.m6 && !by.m7);
  assert.equal(body.inactiveCount, 2); assert.equal(body.neverUsedCount, 2);
});

test('days param and auth', async () => {
  const { handler } = setup(100);
  const r = await get(handler, undefined, { days: '2' });
  assert.ok(r.body.members.some(m => m.memberstackId === 'm2' && m.status === 'inactive'));
  assert.equal((await get(handler, { 'x-admin-secret': 'wrong!' })).status, 401);
  assert.equal((await get(handler, {})).status, 401);
});
