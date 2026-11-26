// Anthropic rejects extra message keys. Restored aris_messages rows include
// id and created_at, and upload resolution copies the whole message through.
// These fixtures are the shapes that were reaching the model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const local = require('../netlify/functions/_Lib/anthropic-messages');
const { createHandler } = require('../netlify/functions/aris-quote');
const uploads = require('../netlify/functions/_Lib/member-uploads');

function implementation(src) {
  const start = src.indexOf('function isPlainObject');
  const end = src.indexOf('\nmodule.exports');
  const slice = end === -1 ? src.slice(start) : src.slice(start, end);
  return slice.replace(/^export /gm, '').trim();
}

async function importEdgeLib(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthropic-msg-'));
  const dest = path.join(dir, name.replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(ROOT, 'netlify/edge-functions/lib', name), dest);
  return import(pathToFileURL(dest).href);
}

function historyAndUploads() {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-11-25T12:00:00.000Z',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    role: 'user',
    content: 'What about the duplex?',
  };
  const blocks = {
    id: '33333333-3333-4333-8333-333333333333',
    created_at: '2026-11-25T12:04:00.000Z',
    role: 'user',
    content: [
      { type: 'text', text: 'extracted rent roll', name: 'rent.pdf', storage_path: 'mem_test/coach/rent.pdf', forge_file: true },
      { type: 'text', text: 'Here is the rent roll.', created_at: 'no' },
      { type: 'forge_file', path: 'mem_test/coach/leftover.pdf', mediaType: 'application/pdf', name: 'leftover.pdf' },
      { type: 'forge_link', url: 'https://docs.google.com/document/d/abc/edit' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ==', storage_path: 'nope' },
        id: 'img',
        forge_file: { path: 'old' },
        cache_control: { type: 'ephemeral', ttl: '5m', extra: true },
      },
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'Qg==', name: 'scan.pdf' },
        title: 'Scan',
        context: 'page 1',
        citations: { enabled: true, extra: 1 },
        storage_path: 'nope',
      },
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'get_notes',
        input: { dealId: 'd1' },
        created_at: 'no',
      },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        is_error: false,
        id: 'nope',
        content: [
          { type: 'text', text: 'note', created_at: 'no' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==', path: 'x' }, forge_file: true },
          { type: 'forge_file', path: 'mem_test/coach/nested.pdf' },
        ],
      },
    ],
  };
  return { row, blocks };
}

function expectedBlocks() {
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'extracted rent roll' },
      { type: 'text', text: 'Here is the rent roll.' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ==' },
        cache_control: { type: 'ephemeral', ttl: '5m' },
      },
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'Qg==' },
        title: 'Scan',
        context: 'page 1',
        citations: { enabled: true },
      },
      { type: 'tool_use', id: 'toolu_123', name: 'get_notes', input: { dealId: 'd1' } },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        content: [
          { type: 'text', text: 'note' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' } },
        ],
        is_error: false,
      },
    ],
  };
}

test('edge and function copies sanitize the same history rows and resolved blocks', async () => {
  const edgeSrc = fs.readFileSync(path.join(ROOT, 'netlify/edge-functions/lib/anthropic-messages.js'), 'utf8');
  const localSrc = fs.readFileSync(path.join(ROOT, 'netlify/functions/_Lib/anthropic-messages.js'), 'utf8');
  assert.equal(implementation(edgeSrc), implementation(localSrc));
  assert.equal(edgeSrc.includes('createRequire'), false);
  assert.equal(localSrc.includes('createRequire'), false);

  const edge = await importEdgeLib('anthropic-messages.js');
  const { row, blocks } = historyAndUploads();
  const input = [row, blocks, { id: 'drop', role: 'system', content: 'no' }, { role: 'user', content: [{ type: 'forge_file', path: 'only.pdf' }] }];
  const expected = [
    { role: 'user', content: 'What about the duplex?' },
    expectedBlocks(),
  ];
  assert.deepEqual(local.sanitizeAnthropicMessages(input), expected);
  assert.deepEqual(edge.sanitizeAnthropicMessages(input), expected);
  assert.equal(typeof local.sanitizeAnthropicMessages(input)[0].content, 'string');
  assert.equal(row.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(row.created_at, '2026-11-25T12:00:00.000Z');
  assert.equal(blocks.content[0].storage_path, 'mem_test/coach/rent.pdf');
  assert.deepEqual(local.sanitizeAnthropicMessages([{ id: 'e', role: 'assistant', content: '' }]), [{ role: 'assistant', content: '' }]);
  assert.deepEqual(local.sanitizeAnthropicMessages(null), []);
});

test('resolved upload blocks are cleaned after the path is replaced', async () => {
  const edgeUploads = await importEdgeLib('resolve-uploads.js');
  const edge = await importEdgeLib('anthropic-messages.js');
  const messages = [{
    id: 'row-9',
    created_at: '2026-11-25T12:00:00.000Z',
    role: 'user',
    content: [
      { type: 'forge_file', path: 'mem_abc/coach/a.pdf', name: 'a.pdf' },
      { type: 'forge_link', url: 'https://docs.google.com/document/d/abc/edit' },
      { type: 'text', text: 'please read' },
    ],
  }];
  const applied = edgeUploads.applyResolvedBlocks(messages, {
    files: [{ path: 'mem_abc/coach/a.pdf', block: { type: 'text', text: 'extracted', storage_path: 'mem_abc/coach/a.pdf', forge_file: true } }],
    links: [{ url: 'https://docs.google.com/document/d/abc/edit', block: { type: 'text', text: 'doc text', forge_link: true } }],
  });
  assert.equal(applied[0].id, 'row-9');
  const clean = edge.sanitizeAnthropicMessages(applied);
  assert.deepEqual(clean, [{
    role: 'user',
    content: [
      { type: 'text', text: 'extracted' },
      { type: 'text', text: 'doc text' },
      { type: 'text', text: 'please read' },
    ],
  }]);
  assert.equal(JSON.stringify(clean).includes('forge_file'), false);
  assert.equal(JSON.stringify(clean).includes('forge_link'), false);
  assert.equal(JSON.stringify(clean).includes('storage_path'), false);
});

async function loadEdge(name) {
  const edge = path.join(ROOT, 'netlify/edge-functions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anthropic-edge-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(edge, name), path.join(dir, name.replace(/\.js$/, '.mjs')));
  for (const file of fs.readdirSync(path.join(edge, 'lib'))) {
    if (file.endsWith('.js')) fs.copyFileSync(path.join(edge, 'lib', file), path.join(dir, 'lib', file));
  }
  return import(pathToFileURL(path.join(dir, name.replace(/\.js$/, '.mjs'))).href + '?t=' + Math.random());
}

test('coach and lab streams strip history ids after upload resolution', async () => {
  const previousFetch = globalThis.fetch;
  const previousNetlify = globalThis.Netlify;
  const previousMembership = globalThis.__forgeTestMembership;
  try {
    const stream = await loadEdge('aris-stream.js');
    const env = { ANTHROPIC_API_KEY: 'test-key' };
    globalThis.Netlify = { env: { get: (key) => env[key] } };
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ url: target, body });
      if (target.includes('anthropic.com')) {
        return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (target.includes('/.netlify/functions/storage-upload')) {
        return new Response(JSON.stringify({
          files: [{
            path: 'mem_test/coach/rent.pdf',
            block: { type: 'text', text: 'extracted rent roll', storage_path: 'mem_test/coach/rent.pdf', forge_file: true },
          }],
          links: [{
            url: 'https://docs.google.com/document/d/abc/edit',
            block: { type: 'text', text: 'google doc text', forge_link: true, storage_path: 'x' },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('unexpected ' + target);
    };

    const plain = [
      { id: 'm1', created_at: '2026-11-25T12:00:00.000Z', role: 'user', content: 'What about the duplex?' },
      { id: 'm2', created_at: '2026-11-25T12:01:00.000Z', role: 'assistant', content: 'Tell me the rent.' },
    ];
    const sales = await stream.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'sales', messages: plain }),
    }), {});
    assert.equal(sales.status, 200);
    assert.deepEqual(calls[0].body.messages, [
      { role: 'user', content: 'What about the duplex?' },
      { role: 'assistant', content: 'Tell me the rent.' },
    ]);
    assert.equal(typeof calls[0].body.messages[0].content, 'string');
    assert.equal(calls.some((call) => call.url.includes('storage-upload')), false);

    calls.length = 0;
    globalThis.__forgeTestMembership = async () => ({ ok: true, status: 200, memberId: 'mem_test', active: true, empire: true });
    const coachPlain = await stream.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({ promptKey: 'coach', messages: plain }),
    }), {});
    assert.equal(coachPlain.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes('anthropic.com'), true);
    assert.deepEqual(calls[0].body.messages, [
      { role: 'user', content: 'What about the duplex?' },
      { role: 'assistant', content: 'Tell me the rent.' },
    ]);
    assert.equal(JSON.stringify(calls[0].body.messages).includes('created_at'), false);
    assert.equal(JSON.stringify(calls[0].body.messages).includes('"id"'), false);

    calls.length = 0;
    const withFile = await stream.default(new Request('https://x/api/aris-stream', {
      method: 'POST',
      body: JSON.stringify({
        promptKey: 'coach',
        messages: [
          ...plain,
          {
            id: 'm3',
            created_at: '2026-11-25T12:02:00.000Z',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Looking that up.', created_at: 'no' },
              { type: 'tool_use', id: 'toolu_123', name: 'get_notes', input: { dealId: 'd1' }, created_at: 'no' },
            ],
          },
          {
            id: 'm4',
            created_at: '2026-11-25T12:03:00.000Z',
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: '{"notes":[]}', is_error: false, id: 'nope' }],
          },
          {
            id: 'm5',
            created_at: '2026-11-25T12:04:00.000Z',
            role: 'user',
            content: [
              { type: 'forge_file', path: 'mem_test/coach/rent.pdf', mediaType: 'application/pdf', name: 'rent.pdf' },
              { type: 'text', text: 'Here is the rent roll.' },
              { type: 'forge_link', url: 'https://docs.google.com/document/d/abc/edit' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ==', storage_path: 'nope' },
                forge_file: { path: 'old' },
              },
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: 'Qg==' },
                title: 'Scan',
                citations: { enabled: true, extra: 1 },
                storage_path: 'nope',
              },
            ],
          },
        ],
      }),
    }), {});
    assert.equal(withFile.status, 200);
    assert.equal(calls[0].url.includes('storage-upload'), true);
    assert.equal(calls[0].body.files[0].path, 'mem_test/coach/rent.pdf');
    assert.equal(calls[0].body.links[0].url, 'https://docs.google.com/document/d/abc/edit');
    assert.equal(calls[1].url.includes('anthropic.com'), true);
    const sent = calls[1].body.messages;
    assert.equal(sent[0].content, 'What about the duplex?');
    assert.equal(typeof sent[0].content, 'string');
    assert.deepEqual(sent[2], {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking that up.' },
        { type: 'tool_use', id: 'toolu_123', name: 'get_notes', input: { dealId: 'd1' } },
      ],
    });
    assert.deepEqual(sent[3], {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: '{"notes":[]}', is_error: false }],
    });
    assert.deepEqual(sent[4].content, [
      { type: 'text', text: 'extracted rent roll' },
      { type: 'text', text: 'Here is the rent roll.' },
      { type: 'text', text: 'google doc text' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QQ==' } },
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: 'Qg==' },
        title: 'Scan',
        citations: { enabled: true },
      },
    ]);
    const raw = JSON.stringify(sent);
    assert.equal(raw.includes('created_at'), false);
    assert.equal(raw.includes('forge_file'), false);
    assert.equal(raw.includes('forge_link'), false);
    assert.equal(raw.includes('storage_path'), false);
    assert.equal(raw.includes('m5'), false);
    assert.equal(raw.includes('toolu_123'), true);

    calls.length = 0;
    env.SUPABASE_URL = 'https://example.supabase.co';
    env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    const lab = await loadEdge('lab-stream.js');
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ url: target, body });
      if (target.includes('lab_scenarios')) {
        return new Response(JSON.stringify([{ role_prompt: 'You are a seller.', title: 'Seller' }]), { status: 200 });
      }
      if (target.includes('anthropic.com')) {
        return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      throw new Error('unexpected ' + target);
    };
    const labRes = await lab.default(new Request('https://x/api/lab-stream', {
      method: 'POST',
      body: JSON.stringify({ scenarioId: 'scen-1', messages: plain }),
    }), {});
    assert.equal(labRes.status, 200);
    const labSent = calls.find((call) => call.url.includes('anthropic.com'));
    assert.deepEqual(labSent.body.messages, [
      { role: 'user', content: 'What about the duplex?' },
      { role: 'assistant', content: 'Tell me the rent.' },
    ]);
    assert.equal(JSON.stringify(labSent.body.messages).includes('created_at'), false);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
    if (previousMembership) globalThis.__forgeTestMembership = previousMembership;
    else delete globalThis.__forgeTestMembership;
  }
});

test('quote strips history ids after a stored file is resolved', async () => {
  const sent = [];
  const handler = createHandler({
    env: { ANTHROPIC_API_KEY: 'test-key' },
    verifyMember: async () => 'mem_abc',
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
    },
    prepareMessages: (messages, ctx) => uploads.resolveMessages(messages, {
      memberId: ctx.memberId,
      binaryMax: uploads.DIRECT_IMAGE_MAX_BYTES,
      loadObject: async () => ({ buffer: Buffer.from('Item,Amount\nAsking,250000\n', 'utf8'), contentType: 'text/csv' }),
    }),
  });
  const plain = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({
      messages: [{ id: 'row-1', created_at: '2026-11-25T12:00:00.000Z', role: 'user', content: 'Give me a quote' }],
    }),
  });
  assert.equal(plain.statusCode, 200);
  assert.deepEqual(sent[0].messages, [{ role: 'user', content: 'Give me a quote' }]);
  assert.equal(typeof sent[0].messages[0].content, 'string');

  const stored = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({
      messages: [{
        id: 'row-2',
        created_at: '2026-11-25T12:05:00.000Z',
        role: 'user',
        content: [
          { type: 'forge_file', path: 'mem_abc/quote/rent.csv', mediaType: 'text/csv', name: 'rent.csv' },
          { type: 'text', text: 'Extract the numbers.' },
        ],
      }],
    }),
  });
  assert.equal(stored.statusCode, 200);
  const content = sent[1].messages[0].content;
  assert.deepEqual(Object.keys(sent[1].messages[0]).sort(), ['content', 'role']);
  assert.equal(content.some((block) => block.type === 'text' && /250000/.test(block.text)), true);
  assert.equal(content.some((block) => block.type === 'text' && block.text === 'Extract the numbers.'), true);
  const raw = JSON.stringify(sent[1].messages);
  assert.equal(raw.includes('forge_file'), false);
  assert.equal(raw.includes('created_at'), false);
  assert.equal(raw.includes('row-2'), false);
});

test('outbound model calls sanitize after resolve and do not use createRequire', async () => {
  const stream = fs.readFileSync(path.join(ROOT, 'netlify/edge-functions/aris-stream.js'), 'utf8');
  const lab = fs.readFileSync(path.join(ROOT, 'netlify/edge-functions/lab-stream.js'), 'utf8');
  const quote = fs.readFileSync(path.join(ROOT, 'netlify/functions/aris-quote.js'), 'utf8');
  const coach = fs.readFileSync(path.join(ROOT, 'aris-coach.html'), 'utf8');
  const resolveAt = stream.indexOf('outgoingMessages = await resolveUploadBlocks');
  const sanitizeAt = stream.indexOf('sanitizeAnthropicMessages(');
  assert.ok(resolveAt > 0 && sanitizeAt > resolveAt);
  assert.match(stream, /sanitizeAnthropicMessages\(\s*Array\.isArray\(outgoingMessages\) \? trimMessagesToBudget\(outgoingMessages\)/);
  assert.match(lab, /messages: sanitizeAnthropicMessages\(body\.messages\)/);
  const prepareAt = quote.indexOf('await prepare(');
  const quoteSanitize = quote.indexOf('messages = sanitizeAnthropicMessages(messages)');
  assert.ok(prepareAt > 0 && quoteSanitize > prepareAt);
  for (const src of [stream, lab, quote]) assert.equal(src.includes('createRequire'), false);
  assert.match(coach, /function messageForHistory/);
  assert.match(coach, /return \{ role: message\.role, content: message\.content \}/);
  assert.match(coach, /messages: messagesForModel\(\)/);
  assert.equal(/conversationHistory\.push\(message\)/.test(coach), false);

  const dir = fs.mkdtempSync(path.join(ROOT, '.anthropic-messages-bundle-'));
  try {
    const outfile = path.join(dir, 'aris-quote.js');
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'netlify/functions/aris-quote.js')],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile,
      external: ['@supabase/supabase-js', '@memberstack/admin', '@netlify/blobs', 'xlsx', 'mammoth', 'unpdf', 'heic-convert'],
      logLevel: 'silent',
    });
    const bundled = fs.readFileSync(outfile, 'utf8');
    assert.equal(
      /createRequire\s*\(\s*import\.meta\.url\s*\)|createRequire\)\(import_meta\.url\)/.test(bundled),
      false
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
