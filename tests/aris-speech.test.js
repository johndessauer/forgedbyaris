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

test('speech spells USD as words, keeps explicit pounds, and does not convert the amount', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const spoken = normalizeSpeechText(
    '**ARV** is $185,000 pounds. MAO is $120,500.50. Spread is $-3,251 and cash flow is -$1,250.50 or ($1,250.50). ' +
    'A UK asking price of £250,000 ($315,000) stays put. Also 100 GBP and USD 80.'
  );
  assert.match(spoken, /after-repair value is one hundred eighty-five thousand dollars/);
  assert.doesNotMatch(spoken, /one hundred eighty-five thousand pounds/);
  assert.match(spoken, /maximum allowable offer is one hundred twenty thousand five hundred dollars and fifty cents/);
  assert.match(spoken, /Spread is negative three thousand two hundred fifty-one dollars/);
  assert.match(spoken, /negative one thousand two hundred fifty dollars and fifty cents or \(one thousand two hundred fifty dollars and fifty cents\)/);
  assert.match(spoken, /two hundred fifty thousand pounds \(three hundred fifteen thousand dollars\)/);
  assert.match(spoken, /one hundred pounds/);
  assert.match(spoken, /eighty dollars/);
  assert.equal(spoken.includes('£'), false);
  assert.equal(spoken.includes('$'), false);
  assert.equal(/\d/.test(spoken), false);
});

test('explicit code after a dollar sign follows the code and does not convert', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const spoken = normalizeSpeechText('The figure given as $250,000 GBP is not a US amount. A$185,000 and C$90 are separate.');
  assert.match(spoken, /as two hundred fifty thousand pounds/);
  assert.doesNotMatch(spoken, /two hundred fifty thousand dollars/);
  assert.match(spoken, /one hundred eighty-five thousand Australian dollars/);
  assert.match(spoken, /ninety Canadian dollars/);
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
  assert.match(spoken, /loan-to-value seventy-five percent/);
  assert.match(spoken, /loan-to-cost/);
  assert.match(spoken, /debt-service coverage ratio one point two five/);
  assert.match(spoken, /debt coverage ratio one point one zero/);
  assert.match(spoken, /return on investment/);
  assert.match(spoken, /net operating income/);
  assert.match(spoken, /capitalization rate six point five percent/);
  assert.match(
    normalizeSpeechText('NOI / cap rate = $1,200,000 and LTV = 0.75.'),
    /net operating income \/ capitalization rate = one million two hundred thousand dollars and loan-to-value = zero point seven five\./
  );
  assert.match(spoken, /HARVARD CARVING NOISE MAOIST capacity recap rate/);
  assert.match(spoken, /https:\/\/example\.com\/ARV\?price=\$100/);
  assert.match(spoken, /<span class="ARV">fifty dollars<\/span>/);
  const prose = spoken.split('See https')[0];
  assert.doesNotMatch(prose, /\bARV\b/);
  assert.doesNotMatch(prose, /\bROI\b/);
  assert.doesNotMatch(prose, /\bMAO\b/);
});

test('a partial token is not expanded, and the speech cap does not cut an amount', async () => {
  const { normalizeSpeechText, prepareSpeechText } = await loadSpeech();
  assert.equal(normalizeSpeechText('The AR'), 'The AR');
  assert.match(normalizeSpeechText('The ARV'), /after-repair value/);

  assert.equal(
    normalizeSpeechText('$1,234.56 stays whole'),
    'one thousand two hundred thirty-four dollars and fifty-six cents stays whole'
  );

  const head = 'word '.repeat(8);
  const cut = prepareSpeechText(`${head}$1,234.56 stays whole`, 48);
  assert.ok(cut.length <= 48, cut);
  assert.equal(cut.includes('$'), false);
  assert.equal(cut.includes('1,234'), false);
  assert.equal(/\d/.test(cut), false);
  assert.ok(cut.startsWith('word'));
});

test('spoken numbers follow the approved pronunciation list', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const cases = [
    ['186,421 dollars', 'one hundred eighty-six thousand four hundred twenty-one dollars'],
    ['$186,421', 'one hundred eighty-six thousand four hundred twenty-one dollars'],
    ['185,000 dollars', 'one hundred eighty-five thousand dollars'],
    ['1,200,000 dollars', 'one million two hundred thousand dollars'],
    ['$1,200,000', 'one million two hundred thousand dollars'],
    ['120,500.50 dollars', 'one hundred twenty thousand five hundred dollars and fifty cents'],
    ['$120,500.50', 'one hundred twenty thousand five hundred dollars and fifty cents'],
    ['$120,500.00', 'one hundred twenty thousand five hundred dollars'],
    ['negative 3,251 dollars', 'negative three thousand two hundred fifty-one dollars'],
    ['$-3,251', 'negative three thousand two hundred fifty-one dollars'],
    ['$101', 'one hundred one dollars'],
    ['$1', 'one dollar'],
    ['$1.01', 'one dollar and one cent'],
    ['75%', 'seventy-five percent'],
    ['6.5%', 'six point five percent'],
    ['0.75 LTV', 'zero point seven five loan-to-value'],
    ['DSCR 1.25', 'debt-service coverage ratio one point two five'],
    ['78701', 'seven eight seven oh one'],
    ['06103', 'oh six one oh three'],
    ['33101-1234', 'three three one oh one, one two three four'],
    ['12345-6789', 'one two three four five, six seven eight nine'],
    ['512-555-0123', 'five one two, five five five, oh one two three'],
    ['(512) 555-0123', 'five one two, five five five, oh one two three'],
    ['512.555.0123', 'five one two, five five five, oh one two three'],
    ['555-123-4567', 'five five five, one two three, four five six seven'],
    ['property ID 83702', 'property ID eight three seven oh two'],
    ['123 Main St', '123 Main St'],
    ['100 NE 45th', '100 NE 45th'],
    ['12345 Main St', '12345 Main St'],
    ['Built in 2026.', 'Built in 2026.'],
    ['A 1998 roof.', 'A 1998 roof.'],
    ['1998-2026', '1998-2026'],
    [
      '123 Main St, Austin, TX 78701 was built in 1998 and refinanced in 2026.',
      '123 Main St, Austin, Texas seven eight seven oh one was built in 1998 and refinanced in 2026.',
    ],
    [
      'Call (512) 555-0123 about the $186,421 offer at 78701.',
      'Call five one two, five five five, oh one two three about the one hundred eighty-six thousand four hundred twenty-one dollars offer at seven eight seven oh one.',
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeSpeechText(input), expected, input);
  }

  const whole = normalizeSpeechText('$186,421');
  assert.equal(whole.includes(' and '), false);
  const cents = normalizeSpeechText('$120,500.50');
  const [dollars, minor] = cents.split(' and ');
  assert.equal(dollars.includes(' and '), false);
  assert.equal(minor, 'fifty cents');
  const phone = normalizeSpeechText('555-123-4567');
  assert.doesNotMatch(phone, /hundred|thousand|fifty/);
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
  assert.match(oracle, /Harter Heights, 46617/);
  assert.match(oracle, /cite only these; never invent/i);
  assert.match(oracle, /Authorization.*Bearer/);
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

const POSTAL_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

test('city/state pairs for all 50 states and DC are spoken as names', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  assert.equal(Object.keys(POSTAL_NAMES).length, 51);
  for (const [abbr, name] of Object.entries(POSTAL_NAMES)) {
    assert.equal(normalizeSpeechText(`Springfield, ${abbr}`), `Springfield, ${name}`, abbr);
    assert.equal(normalizeSpeechText(`Springfield, ${abbr}.`), `Springfield, ${name}.`, abbr);
  }
});

test('addresses, ZIPs, and market phrases use the state name', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  assert.equal(normalizeSpeechText('Dallas, TX'), 'Dallas, Texas');
  assert.equal(normalizeSpeechText('Dallas, Tx'), 'Dallas, Texas');
  assert.equal(normalizeSpeechText('DALLAS, TX'), 'DALLAS, Texas');
  assert.equal(normalizeSpeechText('SOUTH BEND, IN'), 'SOUTH BEND, Indiana');
  assert.equal(normalizeSpeechText('Miami, FL 33101'), 'Miami, Florida three three one oh one');
  assert.equal(normalizeSpeechText('Miami, FL 33101-1234'), 'Miami, Florida three three one oh one, one two three four');
  assert.equal(
    normalizeSpeechText('Property address: 123 Main St, Austin, TX 78701. ARV: $185,000, MAO: $120,500.50.'),
    'Property address: 123 Main St, Austin, Texas seven eight seven oh one. after-repair value: one hundred eighty-five thousand dollars, maximum allowable offer: one hundred twenty thousand five hundred dollars and fifty cents.'
  );
  assert.equal(normalizeSpeechText('St. Louis, MO'), 'St. Louis, Missouri');
  assert.equal(normalizeSpeechText('Winston-Salem, NC'), 'Winston-Salem, North Carolina');
  assert.equal(normalizeSpeechText("O'Fallon, IL"), "O'Fallon, Illinois");
  assert.equal(normalizeSpeechText('Fort Worth, TX'), 'Fort Worth, Texas');
  assert.equal(normalizeSpeechText('Washington, DC'), 'Washington, District of Columbia');
  assert.equal(normalizeSpeechText('Washington, D.C.'), 'Washington, District of Columbia');
  assert.equal(normalizeSpeechText('Washington, D.C. 20001'), 'Washington, District of Columbia two oh oh oh one');
  assert.equal(normalizeSpeechText('Crown Point, IN 46307'), 'Crown Point, Indiana four six three oh seven');
  assert.equal(normalizeSpeechText('South Bend, IN'), 'South Bend, Indiana');
  assert.equal(normalizeSpeechText('123 main st, south bend, IN'), '123 main st, south bend, Indiana');
  assert.equal(normalizeSpeechText('Portland, OR'), 'Portland, Oregon');
  assert.equal(normalizeSpeechText('Portland, OR 97201'), 'Portland, Oregon nine seven two oh one');
  assert.equal(normalizeSpeechText('Portland, ME'), 'Portland, Maine');
  assert.equal(normalizeSpeechText('Tulsa, OK'), 'Tulsa, Oklahoma');
  assert.equal(normalizeSpeechText('Honolulu, HI 96813'), 'Honolulu, Hawaii nine six eight one three');
  assert.equal(normalizeSpeechText('Baltimore, MD 21201'), 'Baltimore, Maryland two one two oh one');
  assert.equal(normalizeSpeechText('New Orleans, LA 70112'), 'New Orleans, Louisiana seven oh one one two');
  assert.equal(normalizeSpeechText('Denver, CO'), 'Denver, Colorado');
  assert.equal(normalizeSpeechText('Seattle, WA'), 'Seattle, Washington');
  assert.equal(normalizeSpeechText('Boise, ID 83702'), 'Boise, Idaho eight three seven oh two');
  assert.equal(normalizeSpeechText('Boise ID 83702'), 'Boise Idaho eight three seven oh two');
  assert.equal(normalizeSpeechText('Omaha, NE 68102'), 'Omaha, Nebraska six eight one oh two');
  assert.equal(normalizeSpeechText('Hartford, CT'), 'Hartford, Connecticut');
  assert.equal(normalizeSpeechText('Little Rock, AR'), 'Little Rock, Arkansas');
  assert.equal(normalizeSpeechText('Columbus, OH'), 'Columbus, Ohio');
  assert.equal(normalizeSpeechText('the TX market and markets in FL'), 'the Texas market and markets in Florida');
  assert.equal(normalizeSpeechText('the IN market'), 'the Indiana market');
  assert.equal(normalizeSpeechText('Investors across WA'), 'Investors across Washington');
  assert.equal(normalizeSpeechText('the state of LA'), 'the state of Louisiana');
  assert.equal(normalizeSpeechText('CT 06103'), 'Connecticut oh six one oh three');
  assert.equal(normalizeSpeechText('LA 70112'), 'Louisiana seven oh one one two');
  assert.equal(normalizeSpeechText('Compare Dallas, TX with Miami, FL.'), 'Compare Dallas, Texas with Miami, Florida.');
});

test('two-letter words and lookalikes are not spoken as states', async () => {
  const { normalizeSpeechText } = await loadSpeech();
  const prose = normalizeSpeechText('Buy or sell in Dallas, call me, and say hi if the deal is OK.');
  assert.equal(prose, 'Buy or sell in Dallas, call me, and say hi if the deal is OK.');
  assert.equal(normalizeSpeechText('The AR'), 'The AR');
  assert.equal(normalizeSpeechText('See Smith et al. and ET AL today.'), 'See Smith et al. and ET AL today.');
  assert.equal(
    normalizeSpeechText('Compare Phoenix, AZ, OR Dallas, TX.'),
    'Compare Phoenix, Arizona, OR Dallas, Texas.'
  );
  assert.equal(
    normalizeSpeechText('Compare NOI, OR ARV, before Portland, OR.'),
    'Compare net operating income, OR after-repair value, before Portland, Oregon.'
  );
  assert.equal(normalizeSpeechText('BUY, WATCH, OR AVOID'), 'BUY, WATCH, OR AVOID');
  assert.equal(normalizeSpeechText('Sounds good, OK.'), 'Sounds good, OK.');
  assert.equal(normalizeSpeechText('OK, the ARV is $100.'), 'OK, the after-repair value is one hundred dollars.');
  assert.equal(normalizeSpeechText('HI there.'), 'HI there.');
  assert.equal(normalizeSpeechText('Oh, Columbus, OH is different.'), 'Oh, Columbus, Ohio is different.');
  assert.equal(
    normalizeSpeechText('Markets in the South, IN particular, differ from South Bend, IN.'),
    'Markets in the South, IN particular, differ from South Bend, Indiana.'
  );
  assert.equal(normalizeSpeechText('Markets, IN my view, are softer.'), 'Markets, IN my view, are softer.');
  assert.equal(normalizeSpeechText('The plan, IN order to close, needs cash.'), 'The plan, IN order to close, needs cash.');
  assert.equal(
    normalizeSpeechText('123 NE Main St, Seattle, WA 98101'),
    '123 NE Main St, Seattle, Washington nine eight one oh one'
  );
  assert.equal(normalizeSpeechText('100 NE 68102'), '100 NE six eight one oh two');
  assert.equal(normalizeSpeechText('100 NE 45th'), '100 NE 45th');
  assert.equal(normalizeSpeechText('123 Oak Ct, Hartford, CT'), '123 Oak Ct, Hartford, Connecticut');
  assert.equal(normalizeSpeechText('123 Oak CT 06103'), '123 Oak CT oh six one oh three');
  assert.equal(normalizeSpeechText('property ID 46307'), 'property ID four six three oh seven');
  assert.equal(normalizeSpeechText('property ID 83702'), 'property ID eight three seven oh two');
  assert.equal(normalizeSpeechText('Property ID 83702'), 'Property ID eight three seven oh two');
  assert.equal(normalizeSpeechText('See ID 83702'), 'See ID eight three seven oh two');
  assert.equal(normalizeSpeechText('LA 90001'), 'LA nine oh oh oh one');
  assert.equal(normalizeSpeechText('Los Angeles, LA'), 'Los Angeles, LA');
  assert.equal(normalizeSpeechText('Los Angeles, LA 90001'), 'Los Angeles, LA nine oh oh oh one');
  assert.equal(
    normalizeSpeechText('A rental in LA, not New Orleans, LA.'),
    'A rental in LA, not New Orleans, Louisiana.'
  );
  assert.equal(normalizeSpeechText('the LA market'), 'the LA market');
  assert.equal(normalizeSpeechText('near ME, unlike Portland, ME'), 'near ME, unlike Portland, Maine');
  assert.equal(normalizeSpeechText('believe in ME'), 'believe in ME');
  assert.equal(normalizeSpeechText('ACME CO reported'), 'ACME CO reported');
  assert.equal(normalizeSpeechText('A$185,000 and C$90 and CA$10.'), 'one hundred eighty-five thousand Australian dollars and ninety Canadian dollars and ten Canadian dollars.');
  assert.equal(normalizeSpeechText('code D.C.A stays'), 'code D.C.A stays');
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
      body: JSON.stringify({
        text: '**ARV** is $185,000 in Dallas, TX. The UK price is £250,000. ARIS agrees. Buy or sell.',
      }),
    }), {});
    assert.equal(res.status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(sent.url.includes('/text-to-speech/'));
  assert.match(sent.body.text, /after-repair value is one hundred eighty-five thousand dollars/);
  assert.match(sent.body.text, /Dallas, Texas/);
  assert.match(sent.body.text, /two hundred fifty thousand pounds/);
  assert.match(sent.body.text, /ARIS agrees/);
  assert.match(sent.body.text, /Buy or sell/);
  assert.equal(sent.body.text.includes('$'), false);
  assert.equal(sent.body.text.includes('TX'), false);
  assert.equal(sent.body.pronunciation_dictionary_locators[0].pronunciation_dictionary_id, 'xnEmPYZk1ReyZxXJB0I4');
  assert.equal(sent.body.pronunciation_dictionary_locators[0].version_id, 'K4NSU6bIVNNrQHZl1PDT');
  assert.equal(sent.body.model_id, 'eleven_flash_v2_5');
  assert.equal(sent.body.voice_settings.stability, 0.58);
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

test('inline Market Oracle scripts parse as JavaScript', () => {
  const oracle = fs.readFileSync(path.join(ROOT, 'market-oracle.html'), 'utf8');
  const scripts = [...oracle.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  const file = path.join(os.tmpdir(), 'market-oracle-inline.js');
  fs.writeFileSync(file, scripts.join('\n;\n'));
  const { status, stderr } = require('child_process').spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(status, 0, stderr);
});
