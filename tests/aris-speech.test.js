// US-property currency and speech normalization.
// Synthetic fixtures only — no member records and no paid TTS calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const EDGE = path.join(ROOT, 'netlify', 'edge-functions');

async function loadSpeech() {
  return import(pathToFileURL(path.join(EDGE, 'lib', 'speech-text.js')).href);
}

async function loadEdge(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aris-speech-'));
  fs.copyFileSync(path.join(EDGE, file), path.join(dir, file.replace(/\.js$/, '.mjs')));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(EDGE, 'lib', 'speech-text.js'), path.join(dir, 'lib', 'speech-text.js'));
  return import(pathToFileURL(path.join(dir, file.replace(/\.js$/, '.mjs'))).href + '?t=' + Math.random());
}

const FRESH_PROFILE = {
  memberstack_id: 'mem_fresh',
  avatar_url: null,
  phone: null,
  why_q1: null,
  why_q2: null,
  why_q3: null,
  why_saved_at: null,
  preferences: {},
  calendar_feed_token: null,
  buy_box: null,
};

const EXISTING_PROFILE = {
  memberstack_id: 'mem_existing',
  preferences: { nudgeSensitivity: 'relaxed' },
  why_q1: 'Build income',
  buy_box: { fields: { markets: 'London' } },
  experience_level: 'intermediate',
};

const US_DEAL = 'Property address: 123 Main St, Austin, TX 78701. ARV: $185,000, MAO: $120,500.50, Spread: $-3,251.';
const UK_DEAL = 'This is a London property in the United Kingdom. Asking price £250,000. Do not convert.';

test('formatUsd uses US grouping for any browser locale and does not rescale', async () => {
  const { formatUsd } = await loadSpeech();
  assert.equal(formatUsd(185000.4), '$185,000');
  assert.equal(formatUsd(-3250.75), '$-3,251');
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(Number.NaN), '$0');
  const german = Math.round(185000.4).toLocaleString('de-DE');
  assert.equal(german, '185.000');
  assert.notEqual(formatUsd(185000.4), `$${german}`);
});

test('fresh profile, existing profile, and en-GB browser all default to USD', async () => {
  const { analysisCurrencyInstruction } = await loadSpeech();
  const fresh = analysisCurrencyInstruction({ text: US_DEAL, profile: FRESH_PROFILE, browserLocale: 'en-GB' });
  const existing = analysisCurrencyInstruction({ text: US_DEAL, profile: EXISTING_PROFILE, browserLocale: 'en-US' });
  const noSettings = analysisCurrencyInstruction({ text: US_DEAL, profile: null, browserLocale: null });
  assert.equal(fresh, existing);
  assert.equal(fresh, noSettings);
  assert.match(fresh, /United States dollars/);
  assert.match(fresh, /No non-US currency was requested/);
  assert.doesNotMatch(fresh, /explicitly used GBP/);
  assert.match(fresh, /new account with no settings/);
});

test('explicit foreign context is kept and is not converted', async () => {
  const { analysisCurrencyInstruction } = await loadSpeech();
  const gbp = analysisCurrencyInstruction({
    text: UK_DEAL,
    profile: FRESH_PROFILE,
    browserLocale: 'en-US',
  });
  assert.match(gbp, /explicitly used GBP/);
  assert.match(gbp, /Do not convert/);
  assert.match(gbp, /do not relabel it as dollars/i);

  const switched = analysisCurrencyInstruction({
    messages: [
      { role: 'user', content: US_DEAL },
      { role: 'assistant', content: 'That ARV is one hundred eighty-five thousand pounds.' },
      { role: 'user', content: UK_DEAL },
    ],
    profile: EXISTING_PROFILE,
    browserLocale: 'en-GB',
  });
  assert.match(switched, /explicitly used GBP/);

  const assistantMistakeDoesNotStick = analysisCurrencyInstruction({
    messages: [
      { role: 'user', content: US_DEAL },
      { role: 'assistant', content: 'The ARV is £185,000 pounds.' },
      { role: 'user', content: 'What is the biggest risk?' },
    ],
  });
  assert.match(assistantMistakeDoesNotStick, /No non-US currency was requested/);
});

test('an older explicit currency still applies when the newest line does not name one', async () => {
  const { analysisCurrencyInstruction } = await loadSpeech();
  const text = analysisCurrencyInstruction({
    messages: [
      { role: 'user', content: UK_DEAL },
      { role: 'user', content: 'Tell me more about the risk.' },
    ],
  });
  assert.match(text, /explicitly used GBP/);
});

test('speech spells USD, keeps explicit pounds, and does not change the digits', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const spoken = normalizeSpeechText(
    '**ARV** is $185,000 pounds. MAO is $120,500.50. Spread is $-3,251 and cash flow is -$1,250.50 or ($1,250.50). ' +
    'A UK asking price of £250,000 ($315,000) stays put. Also 100 GBP and USD 80.'
  );
  assert.match(spoken, /after-repair value is 185,000 dollars/);
  assert.doesNotMatch(spoken, /185,000 pounds/);
  assert.match(spoken, /maximum allowable offer is 120,500\.50 dollars/);
  assert.match(spoken, /Spread is negative 3,251 dollars/);
  assert.match(spoken, /negative 1,250\.50 dollars or \(1,250\.50 dollars\)/);
  assert.match(spoken, /250,000 pounds \(315,000 dollars\)/);
  assert.match(spoken, /100 pounds/);
  assert.match(spoken, /80 dollars/);
  assert.equal(spoken.includes('£'), false);
  assert.equal(spoken.includes('$'), false);
});

test('explicit code after a dollar sign follows the code and does not convert', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const spoken = normalizeSpeechText('The figure given as $250,000 GBP is not a US amount. A$185,000 and C$90 are separate.');
  assert.match(spoken, /as 250,000 pounds/);
  assert.doesNotMatch(spoken, /250,000 dollars/);
  assert.match(spoken, /185,000 Australian dollars/);
  assert.match(spoken, /90 Canadian dollars/);
});

test('abbreviations expand on word boundaries and leave ARIS, URLs, HTML, and lookalike words', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const spoken = normalizeSpeechText(
    'ARIS reviews ARV, MAO, LTV 75%, LTC, DSCR 1.25, DCR 1.10, ROI, NOI, and cap rate 6.5%. ' +
    'HARVARD CARVING NOISE MAOIST capacity recap rate. ' +
    'See https://example.com/ARV?price=$100 and <span class="ARV">$50</span>.'
  );
  assert.match(spoken, /^ARIS reviews after-repair value/);
  assert.match(spoken, /maximum allowable offer/);
  assert.match(spoken, /loan-to-value 75%/);
  assert.match(spoken, /loan-to-cost/);
  assert.match(spoken, /debt-service coverage ratio 1\.25/);
  assert.match(spoken, /debt coverage ratio 1\.10/);
  assert.match(spoken, /return on investment/);
  assert.match(spoken, /net operating income/);
  assert.match(spoken, /capitalization rate 6\.5%/);
  assert.match(
    normalizeSpeechText('NOI / cap rate = $1,200,000 and LTV = 0.75.'),
    /net operating income \/ capitalization rate = 1,200,000 dollars and loan-to-value = 0\.75\./
  );
  assert.match(spoken, /HARVARD CARVING NOISE MAOIST capacity recap rate/);
  assert.match(spoken, /https:\/\/example\.com\/ARV\?price=\$100/);
  assert.match(spoken, /<span class="ARV">50 dollars<\/span>/);
  const prose = spoken.split('See https')[0];
  assert.doesNotMatch(prose, /\bARV\b/);
  assert.doesNotMatch(prose, /\bROI\b/);
  assert.doesNotMatch(prose, /\bMAO\b/);
});

test('a partial token is not expanded, and the speech cap does not cut an amount', async () => {
  const { normalizeSpeechText, prepareSpeechText } = await loadSpeech();
  assert.equal(normalizeSpeechText('The AR'), 'The AR');
  assert.match(normalizeSpeechText('The ARV'), /after-repair value/);

  const head = 'word '.repeat(8);
  const cut = prepareSpeechText(`${head}$1,234.56 stays whole`, 48);
  assert.ok(cut.length <= 48, cut);
  assert.equal(cut.includes('$'), false);
  assert.equal(/1,234(?!\.56)/.test(cut), false);
  assert.ok(cut.startsWith('word'));
});

test('deal analyzer, capital radar, and market oracle pin US grouping', () => {
  const analyzer = fs.readFileSync(path.join(ROOT, 'deal-analyzer.html'), 'utf8');
  assert.match(analyzer, /function fmt\(n\) \{ return '\$' \+ Math\.round\(n\)\.toLocaleString\('en-US'\); \}/);
  assert.match(analyzer, /Property address: \$\{propertyAddress\}/);
  assert.match(analyzer, /United States dollars, the Deal Analyzer's unit/);
  assert.doesNotMatch(analyzer, /Math\.round\(n\)\.toLocaleString\(\)/);

  const capital = fs.readFileSync(path.join(ROOT, 'capital-radar.html'), 'utf8');
  assert.match(capital, /toLocaleString\('en-US'\)/);
  assert.doesNotMatch(capital, /toLocaleString\(\)/);

  const oracle = fs.readFileSync(path.join(ROOT, 'market-oracle.html'), 'utf8');
  assert.match(oracle, /n\.toLocaleString\('en-US'\)/);
  assert.match(oracle, /US dollars from US Census figures/);
});

test('a fresh profile row does not store a currency or locale', () => {
  const src = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'profile-data.js'), 'utf8');
  const insertAt = src.indexOf('.insert(');
  assert.ok(insertAt > 0);
  const insert = src.slice(insertAt, insertAt + 180);
  assert.match(insert, /memberstack_id/);
  assert.doesNotMatch(insert, /currency|locale|gbp|usd/i);
  assert.match(src, /preferences: \{\}/);
});

test('voice request normalizes speech and still sends the pronunciation dictionary', async () => {
  const mod = await loadEdge('aris-voice.js');
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.Netlify = { env: { get: (key) => (key === 'ELEVENLABS_API_KEY' ? 'test-key' : undefined) } };
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return new Response('audio', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  };
  try {
    const res = await mod.default(new Request('https://x/api/aris-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '**ARV** is $185,000. The UK price is £250,000. ARIS agrees.' }),
    }), {});
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(sent.url.includes('/text-to-speech/'));
  assert.match(sent.body.text, /after-repair value is 185,000 dollars/);
  assert.match(sent.body.text, /250,000 pounds/);
  assert.match(sent.body.text, /ARIS agrees/);
  assert.equal(sent.body.text.includes('$'), false);
  assert.equal(sent.body.pronunciation_dictionary_locators[0].pronunciation_dictionary_id, 'xnEmPYZk1ReyZxXJB0I4');
  assert.equal(sent.body.model_id, 'eleven_flash_v2_5');
});

test('deal-analyzer and coach prompts carry the currency rule for a new session and a resumed one', async () => {
  const mod = await loadEdge('aris-stream.js');
  const realFetch = globalThis.fetch;
  globalThis.Netlify = { env: { get: (key) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : undefined) } };
  const systems = {};
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('anthropic.com')) {
      systems.last = JSON.parse(init.body).system;
      return new Response('data: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('', { status: 404 });
  };
  try {
    for (const promptKey of ['deal-analyzer', 'coach']) {
      await mod.default(new Request('https://x/', {
        method: 'POST',
        body: JSON.stringify({
          promptKey,
          messages: [{ role: 'user', content: US_DEAL }],
        }),
      }), {});
      assert.match(systems.last, /No non-US currency was requested/, promptKey);
      assert.match(systems.last, /new account with no settings/, promptKey);
    }
    await mod.default(new Request('https://x/', {
      method: 'POST',
      body: JSON.stringify({
        promptKey: 'deal-analyzer',
        messages: [
          { role: 'user', content: US_DEAL },
          { role: 'assistant', content: 'Previous reply said pounds by mistake.' },
          { role: 'user', content: UK_DEAL },
        ],
      }),
    }), {});
    assert.match(systems.last, /explicitly used GBP/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
