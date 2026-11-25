// ARIS conversation memory: member-scoped chats, the token budget,
// and the rolling summary / durable facts calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');

const client = require('../assets/js/aris-memory-client');
const memory = require('../netlify/functions/_Lib/aris-memory');
const api = require('../netlify/functions/aris-memory');
const ROOT = path.join(__dirname, '..');

function user(text) { return { role: 'user', content: text }; }
function assistant(text) { return { role: 'assistant', content: text }; }

function createDb() {
  const state = { conversations: [], messages: [], facts: [], seq: 0 };
  function supabase() {
    return {
      from(table) {
        const ctx = { table, filters: [], op: 'select', payload: null, order: null, limit: null };
        const builder = {
          select() { return builder; },
          eq(col, val) { ctx.filters.push([col, val]); return builder; },
          order(col, opts) { ctx.order = { col, ascending: !!(opts && opts.ascending) }; return builder; },
          limit(n) { ctx.limit = n; return builder; },
          insert(payload) { ctx.op = 'insert'; ctx.payload = payload; return builder; },
          update(payload) { ctx.op = 'update'; ctx.payload = payload; return builder; },
          upsert(payload) { ctx.op = 'upsert'; ctx.payload = payload; return builder; },
          delete() { ctx.op = 'delete'; return builder; },
          maybeSingle() { return Promise.resolve(finish(true)); },
          single() { return Promise.resolve(finish(true)); },
          then(resolve, reject) {
            try { resolve(finish(false)); }
            catch (err) { reject(err); }
          },
        };
        function bucket() {
          if (ctx.table === 'aris_conversations') return state.conversations;
          if (ctx.table === 'aris_messages') return state.messages;
          if (ctx.table === 'aris_member_facts') return state.facts;
          throw new Error('unknown table ' + ctx.table);
        }
        function matched() {
          let rows = bucket().slice();
          for (const [col, val] of ctx.filters) rows = rows.filter((row) => row[col] === val);
          if (ctx.order) {
            const col = ctx.order.col;
            const dir = ctx.order.ascending ? 1 : -1;
            rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * dir);
          }
          if (ctx.limit != null) rows = rows.slice(0, ctx.limit);
          return rows;
        }
        function finish(single) {
          if (ctx.op === 'insert') {
            const rows = Array.isArray(ctx.payload) ? ctx.payload : [ctx.payload];
            const stored = rows.map((row) => {
              const copy = {
                ...row,
              id: row.id || ('11111111-1111-4111-8111-' + String(++state.seq).padStart(12, '0')),
                created_at: row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              bucket().push(copy);
              return copy;
            });
            return { data: single ? { ...stored[0] } : stored.map((row) => ({ ...row })), error: null };
          }
          if (ctx.op === 'upsert') {
            const row = { ...ctx.payload };
            const existing = bucket().find((item) => item.memberstack_id === row.memberstack_id);
            if (existing) Object.assign(existing, row);
            else bucket().push(row);
            return { data: { ...(existing || row) }, error: null };
          }
          if (ctx.op === 'update') {
            const rows = matched();
            rows.forEach((row) => Object.assign(row, ctx.payload));
            return { data: rows.map((row) => ({ ...row })), error: null };
          }
          if (ctx.op === 'delete') {
            const rows = matched();
            const ids = new Set(rows.map((row) => row.id));
            const list = bucket();
            for (let i = list.length - 1; i >= 0; i -= 1) {
              if (ids.has(list[i].id)) list.splice(i, 1);
            }
            if (ctx.table === 'aris_conversations') {
              state.messages = state.messages.filter((message) => !ids.has(message.conversation_id));
            }
            return { data: rows.map((row) => ({ id: row.id })), error: null };
          }
          const rows = matched();
          if (single) return { data: rows[0] ? { ...rows[0] } : null, error: null };
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        return builder;
      },
    };
  }
  return { supabase: supabase(), state };
}

function handlerFor(memberId, db, fetchImpl) {
  return api.createHandler({
    enforceMembership: async (event) => {
      const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
      if (!/^Bearer\s+\S+/.test(header)) {
        return { response: { statusCode: 401, headers: {}, body: JSON.stringify({ error: 'Missing or malformed Authorization header' }) } };
      }
      return { access: { memberId } };
    },
    supabase: db.supabase,
    env: { ANTHROPIC_API_KEY: 'test-key' },
    fetch: fetchImpl,
  });
}

async function call(handler, method, opts) {
  const options = opts || {};
  const res = await handler({
    httpMethod: method,
    headers: options.headers === undefined ? { authorization: 'Bearer tok' } : options.headers,
    queryStringParameters: options.query || {},
    body: options.body ? JSON.stringify(options.body) : '',
  });
  let body = null;
  if (res.body) {
    try { body = JSON.parse(res.body); } catch (e) { body = res.body; }
  }
  return { status: res.statusCode, body };
}

function modelFetch(calls, summaryText) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body, headers: init.headers });
    const text = String(body.system).includes('rolling summary')
      ? (summaryText || 'Wholesaling near Zillow in South Bend.')
      : '{"markets":["South Bend"],"activeDeals":["123 Main"],"goals":["first deal"],"buyBox":["SFH under 200k"]}';
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
}

test('budget keeps the newest turns and does not split a tool pair', () => {
  const short = [assistant('intro'), user('hi')];
  assert.deepEqual(client.trimMessagesToBudget(short), short);
  assert.deepEqual(client.trimMessagesToBudget('nope'), []);

  const plain = [];
  for (let i = 0; i < 30; i += 1) plain.push(i % 2 === 0 ? user('u' + i) : assistant('a' + i));
  const trimmed = client.trimMessagesToBudget(plain);
  assert.equal(trimmed.length, 20);
  assert.equal(trimmed[0].role, 'user');
  assert.equal(trimmed[0].content, 'u10');
  assert.equal(trimmed[trimmed.length - 1].content, 'a29');

  const toolThread = [
    user('u0'),
    assistant('a0'),
    user('u1'),
    assistant([{ type: 'tool_use', id: 't', name: 'list_deals', input: {} }]),
    user([{ type: 'tool_result', tool_use_id: 't', content: '{}' }]),
  ];
  for (let i = 0; i < 18; i += 1) toolThread.push(i % 2 === 0 ? assistant('x' + i) : user('x' + i));
  const kept = client.trimMessagesToBudget(toolThread);
  assert.equal(kept[0].content, 'u1');
  const toolAt = kept.findIndex((message) => client.hasToolUse(message));
  assert.ok(toolAt > 0);
  assert.equal(client.isToolResultOnly(kept[toolAt + 1]), true);
  assert.equal(client.isToolResultOnly(kept[0]), false);
});

test('memory block stays inside 600 tokens and hides vendor names', () => {
  const block = client.buildMemoryBlock({
    facts: { markets: ['South Bend'], activeDeals: ['123 Main'], goals: ['first wholesale'], buyBox: ['SFH'], notes: ['ignore'] },
    currentConversationId: 'c1',
    conversations: [
      { id: 'c1', title: 'Wholesale', rolling_summary: 'Checked Zillow then ran FORGE comps.' },
      { id: 'c2', title: 'PropStream list', rolling_summary: 'Wants absentee owners.' },
    ],
  });
  assert.match(block, /WHAT ARIS REMEMBERS/);
  assert.match(block, /South Bend/);
  assert.match(block, /EARLIER IN THIS CONVERSATION/);
  assert.match(block, /OTHER RECENT CHATS/);
  assert.equal(block.includes('Zillow'), false);
  assert.equal(block.includes('PropStream'), false);
  const huge = client.buildMemoryBlock({
    facts: { markets: ['South Bend'] },
    currentConversationId: 'c1',
    conversations: [{ id: 'c1', title: 'Wholesale', rolling_summary: 'detail '.repeat(2000) }],
  });
  assert.match(huge, /South Bend/);
  assert.ok(client.estimateTokens(huge) <= client.MEMORY_BLOCK_MAX_TOKENS);
  assert.equal(client.buildMemoryBlock({ facts: {}, conversations: [] }), '');
  assert.deepEqual(client.whyFromProfileRow({ why_q1: 'Family', experience_level: 'beginner' }), {
    q1: 'Family', q2: '', q3: '', experienceLevel: 'beginner', primaryStrategy: '', biggestObstacle: '',
  });
  assert.equal(client.whyFromProfileRow({ why_q1: '' }), null);
});

test('summary refreshes when the thread passes 20, then waits; facts run once', () => {
  assert.equal(client.shouldRefreshSummary({ messageCount: 20, summaryMessageCount: 0 }), false);
  assert.equal(client.shouldRefreshSummary({ messageCount: 21, summaryMessageCount: 0 }), true);
  assert.equal(client.shouldRefreshSummary({ messageCount: 22, summaryMessageCount: 1 }), false);
  assert.equal(client.shouldRefreshSummary({ messageCount: 25, summaryMessageCount: 1 }), true);
  const twoTurns = [user('one'), assistant('two'), user('three'), assistant('four')];
  assert.equal(client.shouldExtractFacts({ factsExtracted: false, messages: [user('only')] }), false);
  assert.equal(client.shouldExtractFacts({ factsExtracted: false, messages: twoTurns }), true);
  assert.equal(client.shouldExtractFacts({ factsExtracted: true, messages: twoTurns }), false);
  const stored = client.sanitizeMessageForStorage({
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', data: 'AAAA' } },
      { type: 'text', text: 'Read this' },
    ],
  });
  assert.equal(JSON.stringify(stored).includes('AAAA'), false);
  assert.match(JSON.stringify(stored), /uploaded a document/);
  const kept = client.sanitizeMessageForStorage({
    role: 'user',
    content: [
      { type: 'forge_file', path: 'mem_abc/coach/contract.pdf', mediaType: 'application/pdf', name: 'contract.pdf', data: 'SHOULD_NOT_STORE' },
      { type: 'text', text: 'Read this' },
    ],
  });
  assert.equal(JSON.stringify(kept).includes('SHOULD_NOT_STORE'), false);
  assert.match(JSON.stringify(kept), /mem_abc\/coach\/contract\.pdf/);
  assert.equal(client.titleFromMessages([assistant('hi'), user('  Wholesale on Zillow  ')]), 'Wholesale on an outside data site');
  const parsed = client.parseFacts('```json\n{"markets":["South Bend"],"goals":["go"]}\n```');
  assert.equal(parsed.markets[0], 'South Bend');
  assert.deepEqual(client.mergeFacts({ markets: ['Old'] }, { markets: ['Zillow'] }).markets, ['an outside data site']);
});

test('client and edge copies agree on trim, memory block, and Why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aris-memory-'));
  const copy = path.join(dir, 'aris-memory.mjs');
  fs.copyFileSync(path.join(ROOT, 'netlify/edge-functions/lib/aris-memory.js'), copy);
  const edge = await import(pathToFileURL(copy).href);
  const thread = [];
  for (let i = 0; i < 24; i += 1) thread.push(i % 2 === 0 ? user('turn ' + i) : assistant('reply ' + i));
  thread.push(assistant([{ type: 'tool_use', id: 't', name: 'list_deals', input: { q: 'x' } }]));
  thread.push(user([{ type: 'tool_result', tool_use_id: 't', content: '[]' }]));
  assert.deepEqual(edge.trimMessagesToBudget(thread), client.trimMessagesToBudget(thread));
  const input = {
    facts: { markets: ['46307'], goals: ['buy a rental'] },
    currentConversationId: 'current',
    conversations: [
      { id: 'current', title: 'Rental', rolling_summary: 'Looking at Redfin rents.' },
      { id: 'older', title: 'Capital', rolling_summary: 'Needs private money.' },
    ],
  };
  assert.equal(edge.buildMemoryBlock(input), client.buildMemoryBlock(input));
  const profile = { why_q1: 'Kids', why_q2: '', primary_strategy: 'wholesaling', biggest_obstacle: 'capital' };
  assert.deepEqual(edge.whyFromProfileRow(profile), client.whyFromProfileRow(profile));
  assert.equal(edge.hasWhyContent(edge.whyFromProfileRow(profile)), client.hasWhyContent(client.whyFromProfileRow(profile)));
  assert.equal(edge.RECENT_TURN_LIMIT, client.RECENT_TURN_LIMIT);
  assert.equal(edge.SUMMARY_MAX_TOKENS, 300);
  assert.equal(edge.MEMORY_BLOCK_MAX_TOKENS, 600);
});

test('a member can list, load, append, and delete only their own chats', async () => {
  const db = createDb();
  const calls = [];
  const mine = handlerFor('mem_a', db, modelFetch(calls));
  const theirs = handlerFor('mem_b', db, modelFetch(calls));

  assert.equal((await call(mine, 'GET', { headers: {} })).status, 401);
  assert.equal(db.state.conversations.length, 0);
  assert.equal((await call(mine, 'OPTIONS')).status, 200);

  const created = await call(mine, 'POST', {
    body: {
      action: 'append',
      memberstack_id: 'mem_b',
      messages: [user('Wholesale a house in South Bend'), assistant('Bring the numbers.')],
    },
  });
  assert.equal(created.status, 200);
  assert.equal(db.state.conversations.length, 1);
  assert.equal(db.state.conversations[0].memberstack_id, 'mem_a');
  assert.equal(db.state.conversations[0].title.includes('South Bend'), true);
  assert.equal(db.state.messages.length, 2);
  const id = created.body.conversationId;

  const listed = await call(mine, 'GET', { query: { action: 'list' } });
  assert.equal(listed.body.conversations.length, 1);
  assert.equal(listed.body.conversations[0].memberstack_id, undefined);
  const hidden = await call(theirs, 'GET', { query: { action: 'list' } });
  assert.deepEqual(hidden.body.conversations, []);
  assert.equal((await call(theirs, 'GET', { query: { action: 'load', id } })).status, 404);
  const stolen = await call(theirs, 'POST', { body: { action: 'append', conversationId: id, messages: [user('nope')] } });
  assert.equal(stolen.status, 404);
  assert.equal(db.state.messages.length, 2);

  const loaded = await call(mine, 'GET', { query: { action: 'load', id } });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.messages.length, 2);
  assert.equal(loaded.body.conversation.memberstack_id, undefined);
  const latest = await call(mine, 'GET', { query: { action: 'latest' } });
  assert.equal(latest.body.conversation.id, id);

  const removed = await call(theirs, 'POST', { body: { action: 'delete', id } });
  assert.equal(removed.body.deleted, false);
  assert.equal(db.state.conversations.length, 1);
  const gone = await call(mine, 'POST', { body: { action: 'delete', id } });
  assert.equal(gone.body.deleted, true);
  assert.equal(db.state.conversations.length, 0);
  assert.equal(db.state.messages.length, 0);
});

test('passing the budget updates a short summary and extracts facts once', async () => {
  const db = createDb();
  const calls = [];
  const mine = handlerFor('mem_a', db, modelFetch(calls));
  const messages = [];
  for (let i = 0; i < 21; i += 1) messages.push(i % 2 === 0 ? user('deal ' + i) : assistant('note ' + i));
  const saved = await call(mine, 'POST', { body: { action: 'append', messages } });
  assert.equal(saved.status, 200);
  assert.equal(calls.length, 2);
  for (const callInfo of calls) {
    assert.equal(callInfo.body.model, 'claude-haiku-5-5');
    assert.equal(callInfo.body.max_tokens, 300);
    assert.equal(callInfo.body.output_config.effort, 'low');
    assert.equal(callInfo.headers['x-api-key'], 'test-key');
  }
  assert.equal(db.state.conversations[0].rolling_summary.includes('Zillow'), false);
  assert.match(db.state.conversations[0].rolling_summary, /South Bend/);
  assert.equal(db.state.conversations[0].summary_message_count, 1);
  assert.equal(db.state.conversations[0].facts_extracted, true);
  assert.deepEqual(db.state.facts[0].facts.markets, ['South Bend']);

  calls.length = 0;
  const again = await call(mine, 'POST', {
    body: { action: 'append', conversationId: saved.body.conversationId, messages: [user('one more')] },
  });
  assert.equal(again.status, 200);
  assert.equal(calls.length, 0);

  const retry = await call(mine, 'POST', {
    body: {
      action: 'append',
      conversationId: saved.body.conversationId,
      idempotencyKey: 'same-key',
      messages: [user('one more')],
    },
  });
  assert.equal(retry.body.duplicate, undefined);
  const dup = await call(mine, 'POST', {
    body: {
      action: 'append',
      conversationId: saved.body.conversationId,
      idempotencyKey: 'same-key',
      messages: [user('one more')],
    },
  });
  assert.equal(dup.body.duplicate, true);
  assert.equal(db.state.messages.filter((row) => row.content === 'one more').length, 2);
});

test('a failed summary call still saves the chat', async () => {
  const db = createDb();
  const mine = handlerFor('mem_a', db, async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const messages = [user('first'), assistant('second'), user('third'), assistant('fourth')];
  const saved = await call(mine, 'POST', { body: { action: 'append', messages } });
  assert.equal(saved.status, 200);
  assert.equal(db.state.messages.length, 4);
  assert.equal(db.state.conversations[0].facts_extracted, false);
  assert.equal(db.state.facts.length, 0);
});

test('migration and coach page wire memory without vendor names in the note', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql/migrations/add-aris-memory.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.aris_conversations/i);
  assert.match(sql, /create table if not exists public\.aris_messages/i);
  assert.match(sql, /create table if not exists public\.aris_member_facts/i);
  assert.match(sql, /rolling_summary/);
  assert.match(sql, /facts jsonb/i);
  assert.match(sql, /on delete cascade/i);
  assert.match(sql, /begin;/i);
  assert.match(sql, /commit;/i);
  assert.equal(/drop\s+table/i.test(sql), false);

  const coach = fs.readFileSync(path.join(ROOT, 'aris-coach.html'), 'utf8');
  assert.match(coach, /\/assets\/js\/aris-memory-client\.js/);
  assert.match(coach, /\/api\/aris-memory/);
  assert.match(coach, /\/api\/profile-data\?action=get/);
  assert.match(coach, /conversationId: currentConversationId/);
  assert.match(coach, /trimMessagesToBudget/);
  assert.match(coach, /ARIS remembers your past chats on this account\. You can delete a chat anytime\./);
  assert.match(coach, /onclick="startNewChat\(\)"/);
  assert.match(coach, /onclick="deleteCurrentChat\(\)"/);
  assert.match(coach, /Past chats/);
  assert.match(coach, /sessionStorage\.setItem\('aris-chat-history'/);
  assert.equal(/PropStream|Zillow|Redfin/.test(coach.slice(coach.indexOf('memory-note'), coach.indexOf('memory-note') + 400)), false);
  const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/api\/aris-memory"/);
});

test('coach prompts tell ARIS it remembers past chats and do not deny memory', () => {
  const prompt = fs.readFileSync(path.join(ROOT, 'netlify/edge-functions/aris-stream.js'), 'utf8');
  assert.equal(/no memory/i.test(prompt), false);
  assert.equal(/retain memory/i.test(prompt), false);
  assert.equal(/between sessions/i.test(prompt), false);
  assert.match(prompt, /ACCOUNT MEMORY — YOU HAVE THIS:/);
  assert.match(prompt, /WHAT ARIS REMEMBERS/);
  assert.match(prompt, /markets, active deals, goals, and buy box/);
  assert.match(prompt, /not as a word-for-word transcript/);
  assert.match(prompt, /delete a chat anytime/);
  assert.match(prompt, /Do not invent a detail that is not in that block/);
  assert.match(prompt, /ACCOUNT MEMORY: Past ARIS coach chats are saved on the member's account/);
  assert.match(prompt, /Do not tell this visitor that ARIS itself lacks memory/);
});

test('aris-memory bundles without createRequire(import.meta.url)', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
  const dir = fs.mkdtempSync(path.join(ROOT, '.aris-memory-bundle-'));
  try {
    const outfile = path.join(dir, 'aris-memory.js');
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'netlify/functions/aris-memory.js')],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile,
      external: ['@supabase/supabase-js', '@memberstack/admin', '@netlify/blobs'],
      logLevel: 'silent',
    });
    const source = fs.readFileSync(outfile, 'utf8');
    assert.equal(
      /createRequire\s*\(\s*import\.meta\.url\s*\)|createRequire\)\(import_meta\.url\)/.test(source),
      false
    );
    const loaded = require(outfile);
    assert.equal(typeof loaded.handler, 'function');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadStream() {
  const edge = path.join(ROOT, 'netlify/edge-functions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aris-stream-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(edge, 'aris-stream.js'), path.join(dir, 'aris-stream.mjs'));
  for (const name of fs.readdirSync(path.join(edge, 'lib'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(edge, 'lib', name), path.join(dir, 'lib', name));
  }
  return import(pathToFileURL(path.join(dir, 'aris-stream.mjs')).href + '?t=' + Math.random());
}

test('coach stream trims to the budget and loads memory and Why on the server', async () => {
  const mod = await loadStream();
  globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_test', active: true, empire: true });
  const env = {
    ANTHROPIC_API_KEY: 'test-key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  };
  globalThis.Netlify = { env: { get: (key) => env[key] } };
  let sent = null;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    seen.push(target);
    if (target.includes('anthropic.com')) {
      sent = JSON.parse(init.body);
      return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (target.includes('/aris_member_facts')) {
      return new Response(JSON.stringify([{ facts: { markets: ['South Bend'], goals: ['first deal'] } }]), { status: 200 });
    }
    if (target.includes('/aris_conversations')) {
      return new Response(JSON.stringify([
        { id: '11111111-1111-1111-1111-111111111111', title: 'Wholesale', rolling_summary: 'Saw it on Zillow.', updated_at: '2026-11-01T00:00:00Z' },
      ]), { status: 200 });
    }
    if (target.includes('/member_profiles')) {
      return new Response(JSON.stringify([{ why_q1: 'For my family', experience_level: 'beginner' }]), { status: 200 });
    }
    throw new Error('unexpected ' + target);
  };
  const messages = [];
  for (let i = 0; i < 30; i += 1) messages.push(i % 2 === 0 ? user('m' + i) : assistant('m' + i));
  try {
    const res = await mod.default(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({
        promptKey: 'coach',
        conversationId: '11111111-1111-1111-1111-111111111111',
        messages,
      }),
    }), {});
    assert.equal(res.status, 200);
    assert.equal(sent.messages.length, 20);
    assert.equal(sent.messages[0].content, 'm10');
    assert.match(sent.system, /WHAT ARIS REMEMBERS/);
    assert.match(sent.system, /South Bend/);
    assert.match(sent.system, /MEMBER'S WHY/);
    assert.match(sent.system, /For my family/);
    assert.match(sent.system, /ACCOUNT MEMORY — YOU HAVE THIS:/);
    assert.match(sent.system, /delete a chat anytime/);
    assert.equal(/no memory|retain memory|between sessions/i.test(sent.system), false);
    const memorySection = sent.system.slice(sent.system.lastIndexOf('WHAT ARIS REMEMBERS'));
    assert.equal(memorySection.includes('Zillow'), false);
    assert.equal(JSON.stringify(sent.messages).includes('service-role-test'), false);
    assert.ok(seen.some((url) => url.includes('/aris_member_facts')));
    assert.equal(seen.some((url) => url.includes('service-role-test')), false);

    sent = null;
    const analyzerMessages = messages.slice();
    const analyzed = await mod.default(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'deal-analyzer', messages: analyzerMessages }),
    }), {});
    assert.equal(analyzed.status, 200);
    assert.equal(sent.messages.length, 20);
    assert.equal(sent.system.includes('WHAT ARIS REMEMBERS'), false);

    const before = seen.length;
    delete globalThis.__forgeTestMembership;
    const sales = await mod.default(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'sales', messages: [user('hi')] }),
    }), {});
    assert.equal(sales.status, 200);
    assert.equal(seen.slice(before).some((url) => url.includes('supabase.co')), false);

    globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_test', active: true, empire: true });
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('anthropic.com')) {
        sent = JSON.parse(init.body);
        return new Response('data: {}\n\n', { status: 200 });
      }
      throw new Error('database down');
    };
    const still = await mod.default(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', memberWhy: { q1: 'Client why' }, messages: [user('hi')] }),
    }), {});
    assert.equal(still.status, 200);
    assert.match(sent.system, /Client why/);
    assert.match(sent.system, /ACCOUNT MEMORY — YOU HAVE THIS:/);
    assert.equal(sent.system.includes('South Bend'), false);
    assert.equal(sent.system.includes('EARLIER IN THIS CONVERSATION'), false);
  } finally {
    delete globalThis.__forgeTestMembership;
  }
});
