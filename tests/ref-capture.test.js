const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../assets/js/ref-capture.js');

function fakeWin(search, stored, cookie) {
  const ls = new Map(stored ? [[R.KEY, stored]] : []);
  const doc = { _c: cookie || '', get cookie() { return this._c; }, set cookie(v) { this.lastSet = v; this._c = v.split(';')[0]; } };
  return { location: { search: search || '' }, document: doc,
    localStorage: { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, v) }, _ls: ls };
}

test('sanitize: lowercase, [a-z0-9_-], max 64', () => {
  assert.equal(R.sanitize('023K-Eddie'), '023k-eddie');
  assert.equal(R.sanitize('lex<script>ort!'), 'lexscriptort');
  assert.equal(R.sanitize('a'.repeat(100)).length, 64);
  assert.equal(R.sanitize(null), '');
});

test('capture stores ref in localStorage and 90-day Lax cookie', () => {
  const w = fakeWin('?ref=023k-eddie');
  R.capture(w);
  assert.equal(w._ls.get(R.KEY), '023k-eddie');
  assert.match(w.document.lastSet, /^forge_ref=023k-eddie; max-age=7776000; path=\/; SameSite=Lax$/);
  assert.ok(R.MAX_AGE >= 30 * 24 * 60 * 60);
});

test('checkout metadata carries the stored ref and does not change the price', async () => {
  for (const ref of ['023k-eddie', 'lexort', 'lexort-jeremy', 'lexort-kelly', 'ian']) {
    const args = R.withCheckout({ priceId: 'prc_same' }, fakeWin('', ref));
    assert.equal(args.priceId, 'prc_same');
    assert.deepEqual(args.metadataForCheckout, { ref: ref });
  }
  assert.equal(R.withCheckout({ priceId: 'prc_same' }, fakeWin('')).metadataForCheckout, undefined);

  const calls = [];
  const memberstack = {
    async purchasePlansWithCheckout(params) {
      calls.push(params);
      if (calls.length === 1) throw new Error('metadata rejected');
      return { data: { url: 'https://checkout.stripe.com/c/pay/cs_test' } };
    },
  };
  const result = await R.purchase(memberstack, { priceId: 'prc_same' }, fakeWin('?ref=Ian'));
  assert.equal(result.data.url.startsWith('https://checkout.stripe.com/'), true);
  assert.equal(calls[0].metadataForCheckout.ref, 'ian');
  assert.equal(calls[0].priceId, 'prc_same');
  assert.equal(calls[1].priceId, 'prc_same');
  assert.equal(calls[1].metadataForCheckout, undefined);
});

test('no ?ref leaves stored value alone; getRef falls back to stored, then cookie, then empty', () => {
  const w = fakeWin('', 'lexort'); R.capture(w);
  assert.equal(w._ls.get(R.KEY), 'lexort');
  assert.equal(R.getRef(w), 'lexort');
  assert.equal(R.getRef(fakeWin('', null, 'forge_ref=lexort-kelly')), 'lexort-kelly');
  assert.equal(R.getRef(fakeWin('')), '');
});

test('getRef prefers URL ?ref over stored', () => {
  assert.equal(R.getRef(fakeWin('?ref=lexort-jeremy', 'lexort')), 'lexort-jeremy');
});

test('last touch wins between rep refs', () => {
  const w = fakeWin('?ref=lexort-kelly', '023k-eddie'); R.capture(w);
  assert.equal(w._ls.get(R.KEY), 'lexort-kelly');
});

test('channel ref (blog) never overwrites a stored rep ref', () => {
  assert.deepEqual(R.CHANNEL_REFS, ['blog']);
  const w = fakeWin('?ref=blog', '023k-eddie'); R.capture(w);
  assert.equal(w._ls.get(R.KEY), '023k-eddie');
  assert.equal(w.document.lastSet, undefined);
});

test('channel ref fills empty value or replaces another channel ref; rep replaces channel', () => {
  const w1 = fakeWin('?ref=blog'); R.capture(w1); assert.equal(w1._ls.get(R.KEY), 'blog');
  assert.equal(R.shouldReplace('blog', 'blog'), true);
  const w2 = fakeWin('?ref=lexort', 'blog'); R.capture(w2); assert.equal(w2._ls.get(R.KEY), 'lexort');
});

test('the 4 signup pages read referralSource via ForgeRef and keep omit-when-empty', () => {
  for (const f of ['signup.html', 'signup-97.html', 'signup-partner.html', 'signup-partner-125.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(html, /<script src="\/assets\/js\/ref-capture\.js"><\/script>/, f);
    assert.match(html, /ForgeRef\.getRef\(window\)/, f);
    assert.match(html, /\.\.\.\(referralSource && \{ 'referral-source': referralSource \}\)/, f);
  }
});

test('FORGE checkout pages pass the stored ref into Memberstack checkout', () => {
  const pages = [
    'signup.html', 'signup-97.html', 'signup-497.html', 'signup-partner.html', 'signup-partner-125.html',
    'signup-foundation.html', 'signup-foundation-empire.html', 'signup-fortiva-1497.html', 'signup-fortiva-1997.html',
    'payment-plan.html', 'fwn/launch.html',
  ];
  for (const f of pages) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(html, /ref-capture\.js/, f);
  }
  for (const f of pages.slice(0, 10)) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(html, /ForgeRef\.purchase\(memberstack, checkoutArgs, window\)/, f);
    assert.match(html, /priceId: currentPhase\.priceId/, f);
  }
  const client = fs.readFileSync(path.join(__dirname, '..', 'assets/js/fwn-checkout.js'), 'utf8');
  assert.match(client, /ForgeRef\.withCheckout\(params, window\)/);
  assert.match(client, /purchasePlansWithCheckout/);
});

test('blog posts include ref-capture.js', () => {
  const dir = path.join(__dirname, '..', 'blog');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
    assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /ref-capture\.js/, f);
  }
});
