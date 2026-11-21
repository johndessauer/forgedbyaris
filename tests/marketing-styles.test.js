const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function pieceCard(html, name) {
  const marker = '<strong>' + name + '</strong>';
  const at = html.indexOf(marker);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', start);
  return html.slice(start, end);
}

const pricing = require('../netlify/functions/_Lib/marketing-pricing');
const thanks = require('../netlify/functions/_Lib/marketing-thanks');
const orderApi = require('../netlify/functions/_Lib/marketing-order-http');
const wallet = require('../netlify/functions/_Lib/marketing-wallet');
const storeLib = require('../netlify/functions/_Lib/marketing-store');
const app = require('../assets/js/marketing-app');

test('style prices are vendor cost plus the approved markup', () => {
  const menu = pricing.publicMenu({});
  const byId = (rows) => Object.fromEntries(rows.map(row => [row.id, row.studentPriceCents]));
  assert.deepEqual(byId(menu.postcard), { '4x6': 109, '6x9': 124, '6x11': 155 });
  assert.deepEqual(byId(menu.letter), { bw: 128, color: 147 });
  assert.deepEqual(byId(menu.handwritten), { notecard: 365, '4x6': 142, '6x9': 198 });
  assert.deepEqual(byId(menu.signs), { '50': 647, '100': 514 });
  const soon = byId(menu.comingSoon);
  assert.equal(soon['door-hanger'], 182);
  assert.equal(soon.flyer, undefined);
  assert.equal(soon['business-card'], undefined);
  assert.equal(soon.handwritten, 365);
  assert.equal(menu.handwrittenOrderable, false);
  const body = JSON.stringify(menu).toLowerCase();
  assert.equal(body.includes('lob'), false);
  assert.equal(body.includes('thanks'), false);
  assert.equal(body.includes('dirt'), false);
  assert.equal(body.includes('pelican'), false);

  const color = pricing.quoteOrder(['letter'], 2, {}, null, { letter: { finish: 'color' } });
  assert.equal(color.lines[0].unitStudentPriceCents, 147);
  assert.equal(color.lines[0].styleLabel, 'Color');
  assert.equal(color.lines[0].vendorCostCents + color.lines[0].markupCents, color.chargedCents);
  const signs = pricing.quoteOrder(['bandit'], 12, {}, [{ channelId: 'bandit', quantity: 50, option: '18x24-hstake' }]);
  assert.equal(signs.lines[0].quantity, 50);
  assert.notEqual(signs.lines[0].quantity, 12);
  assert.equal(signs.printChargedCents, 32350);
  assert.equal(signs.lines[0].vendorCostCents + signs.lines[0].markupCents, signs.printChargedCents);
});

test('a handwritten order is refused while the note service is not connected', async () => {
  const ready = thanks.readiness({});
  assert.equal(ready.ok, false);
  assert.equal(ready.error.message, 'Handwritten notes are coming soon.');
  const built = thanks.buildRequest(
    { channel: 'handwritten', variantA: 'Hello' },
    [{ owner: 'Pat', address: '210 King St', city: 'San Francisco', state: 'CA', zip: '94107' }],
    { handwritten: { product: 'notecard', hand: 'hi-clarice' } }
  );
  assert.equal(built.path, '/send/notecard');
  assert.equal(built.body.realism_mode, true);
  assert.equal(built.body.handwriting_style, 'Hi Clarice');
  assert.equal(built.body.ink_color, 'blue');
  const calls = [];
  await assert.rejects(
    () => thanks.sendNotes({ env: { THANKSIO_API_KEY: 'secret', MARKETING_LIVE_MAIL: 'true' }, fetch: async (url) => { calls.push(url); return { ok: false, json: async () => ({}) }; }, pieces: [{ channel: 'handwritten', variantA: 'Hi' }], leads: [], styles: {} }),
    /Handwritten notes are coming soon/
  );
  assert.equal(calls[0], 'https://api.thanks.io/api/v2/send/notecard');

  const blob = storeLib.createMemoryBlobStore();
  await blob.setJSON('brands/mem_john.json', { brands: [{ id: 'brand_1', businessName: 'Sample Buys', phone: '555-0100', returnAddress: { line1: '1 Main St', city: 'Sampletown', state: 'ST', zip: '00000' } }] });
  await wallet.credit(blob, { memberId: 'mem_john', amountCents: 5000, stripeSessionId: 'cs_note' });
  const handler = orderApi.createHandler({
    env: { CONTEXT: 'production', LOB_API_KEY: 'test_lob_key' },
    getStore: () => blob,
    requireMembership: async () => ({ memberId: 'mem_john', empire: true, active: true, planConnections: [] }),
    getMember: async () => ({ auth: { email: 'john@thedessauergroup.com' }, planConnections: [] }),
    fetch: async () => { throw new Error('no network'); },
  });
  const refused = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({
      action: 'confirm',
      brandId: 'brand_1',
      channels: ['postcard', 'handwritten'],
      leads: [{ address: '210 King St', city: 'San Francisco', state: 'CA', zip: '94107' }],
      pieces: [
        { channel: 'postcard', variantA: 'Card', approved: true },
        { channel: 'handwritten', variantA: 'Note', approved: true },
      ],
    }),
  });
  const body = JSON.parse(refused.body);
  assert.equal(refused.statusCode, 400);
  assert.equal(body.error, 'Handwritten notes are coming soon.');
  assert.equal((await wallet.readWallet(blob, 'mem_john')).balanceCents, 5000);

  const picker = app.renderPicker(app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    selected: { handwritten: true, postcard: true },
    menu: pricing.publicMenu({}),
  }));
  assert.match(picker, /Coming soon/);
  assert.match(picker, /Folded notecard/);
  assert.match(picker, /Hi Clarice/);
  assert.match(picker, /\$3\.65 each/);
  assert.equal(picker.toLowerCase().includes('thanks'), false);
  assert.equal(picker.toLowerCase().includes('lob'), false);
  const note = pieceCard(picker, 'Handwritten note');
  assert.match(note, /<article class="mkt-piece-card is-on">[\s\S]*mkt-style/);
  assert.match(note, /class="mkt-field"><span>Style<\/span>/);
  assert.match(note, /class="mkt-field"><span>Handwriting<\/span>/);
  assert.match(note, /class="mkt-style-help"/);
  assert.equal((note.match(/mkt-pill is-soon/g) || []).length, 1);
  const postcard = pieceCard(picker, 'Postcard');
  assert.match(postcard, /class="mkt-field"><span>Size<\/span>/);
  assert.match(postcard, /\$1\.09 each/);
  const letter = pieceCard(picker, 'Letter');
  assert.match(letter, /class="mkt-field"><span>Print<\/span>/);
  assert.match(letter, /\$1\.28 each/);
  const sign = pieceCard(picker, 'Bandit sign');
  assert.match(sign, /class="mkt-field is-short"><span>Pack<\/span>/);
  assert.match(sign, /\$6\.47 each/);
  assert.match(sign, /\$323\.50 for 50/);
  const closed = app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    selected: { letter: true },
    menu: pricing.publicMenu({}),
  });
  closed.recsFor = 'residential:sellers';
  const closedCard = pieceCard(app.renderPicker(closed), 'Postcard');
  assert.equal(closedCard.includes('mkt-style'), false);
  const hangerState = app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    selected: { 'door-hanger': true },
    menu: pricing.publicMenu({}),
  });
  hangerState.recsFor = 'residential:sellers';
  const hanger = pieceCard(app.renderPicker(hangerState), 'Door hanger');
  assert.equal((hanger.match(/mkt-pill is-soon/g) || []).length, 1);
  assert.match(hanger, /\$1\.82 each/);
  assert.match(hanger, /\$91\.00 for 50/);
  const catalog = require('../assets/js/marketing-catalog');
  const postcard46 = catalog.stylePreview('postcard', '4x6');
  const postcard611 = catalog.stylePreview('postcard', '6x11');
  assert.match(postcard46, /viewBox="0 0 160 110"/);
  assert.notEqual(postcard46, postcard611);
  assert.notEqual(postcard46, catalog.stylePreview('postcard', '6x9'));
  assert.match(catalog.stylePreview('letter', 'color'), /#2f6f86/);
  assert.equal(catalog.stylePreview('letter', 'bw').includes('#2f6f86'), false);
  assert.match(catalog.stylePreview('handwritten', 'notecard', { hand: 'hi-clarice' }), /Great Vibes/);
  assert.match(catalog.stylePreview('handwritten', 'notecard', { hand: 'shopping-list' }), /Caveat/);
  assert.match(catalog.stylePreview('handwritten', 'notecard', { hand: 'normal-print' }), /Patrick Hand/);
  assert.notEqual(
    catalog.stylePreview('handwritten', '4x6', { hand: 'hi-clarice' }),
    catalog.stylePreview('handwritten', '6x9', { hand: 'shopping-list' })
  );
  const banditArt = catalog.stylePreview('bandit', '18x24-hstake');
  assert.match(banditArt, /WE BUY/);
  assert.match(banditArt, />HOUSES</);
  assert.match(banditArt, /555-0100/);
  assert.equal(banditArt.includes('FORGE'), false);
  assert.match(catalog.stylePreview('door-hanger', '4.25x11'), /fill-rule="evenodd"/);
  assert.match(picker, /Enlarge Postcard preview/);
  const zoomed = app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    menu: pricing.publicMenu({}),
  });
  zoomed.zoomChannel = 'bandit';
  assert.match(app.renderPicker(zoomed), /class="mkt-lightbox"/);
  assert.match(app.renderPicker(zoomed), /WE BUY/);
  assert.match(app.renderPicker(zoomed), />HOUSES</);
  const page = ['marketing.html', 'assets/js/marketing-app.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.equal(/thanks\.io|dirt cheap|wise pelican|\blob\b/i.test(page), false);
});
