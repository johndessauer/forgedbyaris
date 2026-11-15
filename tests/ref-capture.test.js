const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../assets/js/ref-capture.js');

function fakeWin(search, stored, cookie) {
  const entries = stored && typeof stored === 'object'
    ? Object.entries(stored)
    : (stored ? [[R.KEY, stored]] : []);
  const ls = new Map(entries);
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

test('all signup pages read referralSource via ForgeRef and keep omit-when-empty', () => {
  for (const f of ['signup.html', 'signup-97.html', 'signup-partner.html', 'signup-partner-125.html', 'signup-497.html', 'signup-fortiva-1497.html', 'signup-fortiva-1997.html', 'signup-foundation.html', 'signup-foundation-empire.html', 'payment-plan.html']) {
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

test('?rep= is stored apart from ?ref= and last-touch replaces only the rep', () => {
  const w = fakeWin('?ref=fortiva&rep=Chris');
  R.capture(w);
  assert.equal(w._ls.get(R.KEY), 'fortiva');
  assert.equal(w._ls.get(R.REP_KEY), 'chris');
  assert.match(w.document.lastSet, /^forge_rep=chris; max-age=7776000; path=\/; SameSite=Lax$/);
  assert.equal(R.getRep(w), 'chris');
  assert.equal(R.getRef(w), 'fortiva');

  const kept = fakeWin('', { [R.REP_KEY]: 'john' });
  R.capture(kept);
  assert.equal(kept._ls.get(R.REP_KEY), 'john');
  assert.equal(R.getRep(fakeWin('', null, 'forge_rep=chad')), 'chad');
  assert.equal(R.getRep(fakeWin('?rep=John', { [R.REP_KEY]: 'chad' })), 'john');

  const channel = fakeWin('?ref=blog&rep=chris', { [R.KEY]: 'fortiva', [R.REP_KEY]: 'john' });
  R.capture(channel);
  assert.equal(channel._ls.get(R.KEY), 'fortiva');
  assert.equal(channel._ls.get(R.REP_KEY), 'chris');
});

test('checkout metadata carries sales_rep without dropping ref or the price', () => {
  const both = R.withCheckout({ priceId: 'prc_same' }, fakeWin('', { [R.KEY]: 'fortiva', [R.REP_KEY]: 'chad' }));
  assert.equal(both.priceId, 'prc_same');
  assert.deepEqual(both.metadataForCheckout, { ref: 'fortiva', sales_rep: 'chad' });
  const repOnly = R.withCheckout({ priceId: 'prc_same', metadataForCheckout: { keep: '1' } }, fakeWin('', { [R.REP_KEY]: 'john' }));
  assert.deepEqual(repOnly.metadataForCheckout, { keep: '1', sales_rep: 'john' });
  assert.equal(R.withCheckout({ priceId: 'prc_same' }, fakeWin('')).metadataForCheckout, undefined);
});

test('booking links gain the stored rep and keep an existing ref', () => {
  const links = [
    hrefEl('/book'),
    hrefEl('https://forgedbyaris.com/book?ref=blog'),
    hrefEl('https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx?ref=blog'),
    hrefEl('https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx?rep=john'),
    hrefEl('/webinar/register?src=site'),
  ];
  const w = fakeWin('', { [R.REP_KEY]: 'chris' });
  w.location.href = 'https://forgedbyaris.com/';
  w.location.hostname = 'forgedbyaris.com';
  w.document.querySelectorAll = () => links;
  R.decorateBookingLinks(w);
  assert.equal(links[0].getAttribute('href'), '/book?rep=chris');
  assert.equal(links[1].getAttribute('href'), 'https://forgedbyaris.com/book?ref=blog&rep=chris');
  assert.match(links[2].getAttribute('href'), /ref=blog/);
  assert.match(links[2].getAttribute('href'), /rep=chris/);
  assert.equal(links[3].getAttribute('href'), 'https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx?rep=john');
  assert.equal(links[4].getAttribute('href'), '/webinar/register?src=site');
});

function hrefEl(href) {
  return {
    _h: href,
    getAttribute() { return this._h; },
    setAttribute(k, v) { if (k === 'href') this._h = v; },
  };
}

test('signup, checkout, webinar registration, and the booking page pass sales rep through', () => {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['signup.html', 'signup-97.html', 'signup-partner.html', 'signup-partner-125.html', 'signup-497.html', 'signup-fortiva-1497.html', 'signup-fortiva-1997.html', 'signup-foundation.html', 'signup-foundation-empire.html', 'payment-plan.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(html, /ForgeRef\.getRep\(window\)/, f);
    assert.match(html, /'sales-rep': salesRep/, f);
  }
  for (const f of ['assets/js/fwn-checkout.js', 'assets/js/webinar-checkout.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /salesRepValue\(\)/, f);
    assert.match(src, /'sales-rep': salesRep/, f);
    assert.match(src, /sales_rep = salesRep/, f);
  }
  const register = fs.readFileSync(path.join(__dirname, '..', 'webinar/register.html'), 'utf8');
  assert.match(register, /ForgeRef\.getRep/);
  assert.match(register, /rep: rep/);
  const replay = fs.readFileSync(path.join(__dirname, '..', 'webinar/replay.html'), 'utf8');
  assert.match(replay, /ForgeRef\.getRep/);
  assert.match(replay, /&rep=/);
  const booking = fs.readFileSync(path.join(__dirname, '..', 'apartment-confidential.html'), 'utf8');
  assert.match(booking, /key === 'rep'/);
  assert.match(booking, /ForgeRef\.getRep/);
});

test('blog posts include ref-capture.js', () => {
  const dir = path.join(__dirname, '..', 'blog');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.html'))) {
    assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /ref-capture\.js/, f);
  }
});
