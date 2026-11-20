const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const catalog = require('../assets/js/marketing-catalog');
const images = require('../netlify/functions/_Lib/marketing-images');
const access = require('../netlify/functions/_Lib/marketing-access');
const storeLib = require('../netlify/functions/_Lib/marketing-store');
const brandApi = require('../netlify/functions/marketing-brand');
const copyApi = require('../netlify/functions/marketing-copy');
const accessApi = require('../netlify/functions/marketing-access');
const app = require('../assets/js/marketing-app');
const pricing = require('../netlify/functions/_Lib/marketing-pricing');
const marketingStore = require('../netlify/functions/_Lib/marketing-store');

const root = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function png(width, height, extra) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdr,
    Buffer.from([0, 0, 0, 0]),
  ]);
  const iend = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    Buffer.from([0, 0, 0, 0]),
  ]);
  return Buffer.concat([sig, chunk, extra || Buffer.alloc(0), iend]);
}

function jpeg(width, height) {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function world(opts) {
  const o = opts || {};
  const blob = storeLib.createMemoryBlobStore();
  const members = o.members || {
    mem_john: { email: 'john@thedessauergroup.com', empire: true },
    mem_foundation: { email: 'member@example.com', empire: false },
  };
  const env = Object.assign({ ANTHROPIC_API_KEY: 'test-key', CONTEXT: 'production' }, o.env || {});
  const memberId = o.memberId || 'mem_john';
  const deps = {
    env: env,
    context: o.context || env.CONTEXT,
    getStore: () => blob,
    requireMembership: async () => {
      if (o.deny) { const err = new Error('Missing or malformed Authorization header'); err.statusCode = 401; throw err; }
      const row = members[memberId] || {};
      return { memberId: memberId, empire: !!row.empire, active: true, planConnections: [] };
    },
    getMember: async (id) => ({ auth: { email: (members[id] && members[id].email) || '' }, planConnections: [] }),
    fetch: o.fetch,
  };
  const call = async (handler, body, method) => {
    const res = await handler({
      httpMethod: method || 'POST',
      headers: { authorization: 'Bearer tok' },
      queryStringParameters: o.query || {},
      body: body == null ? '' : JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { blob: blob, deps: deps, call: call };
}

test('property class splits residential, commercial, and unknown', () => {
  assert.equal(catalog.classifyPropertyType('SFR'), 'residential');
  assert.equal(catalog.classifyPropertyType('Single Family'), 'residential');
  assert.equal(catalog.classifyPropertyType('duplex', 2), 'residential');
  assert.equal(catalog.classifyPropertyType('APT'), 'commercial');
  assert.equal(catalog.classifyPropertyType('retail'), 'commercial');
  assert.equal(catalog.classifyPropertyType('land'), 'commercial');
  assert.equal(catalog.classifyPropertyType('warehouse', 2), 'commercial');
  assert.equal(catalog.classifyPropertyType('MFR'), 'unknown');
  assert.equal(catalog.classifyPropertyType('', 8), 'commercial');
  const split = catalog.splitLeads([
    { id: 'a', propertyType: 'SFR' },
    { id: 'b', propertyType: 'office' },
    { id: 'c', propertyType: 'MFR' },
    { id: 'd', propertyType: 'MFR', assignedClass: 'residential' },
  ]);
  assert.equal(split.residential.length, 2);
  assert.equal(split.commercial.length, 1);
  assert.equal(split.unknown.length, 1);
});

test('commercial hides bandit signs, door hangers, and door-knock scripts', () => {
  const residential = catalog.channelsForClass('residential').map(row => row.id);
  const commercial = catalog.channelsForClass('commercial').map(row => row.id);
  assert.ok(residential.includes('bandit'));
  assert.ok(residential.includes('door-hanger'));
  assert.ok(residential.includes('door-knock'));
  assert.equal(commercial.includes('bandit'), false);
  assert.equal(commercial.includes('door-hanger'), false);
  assert.equal(commercial.includes('door-knock'), false);
  assert.ok(commercial.includes('letter'));
  assert.equal(catalog.displayName(catalog.channelById('flyer'), 'commercial'), 'One-page property summary');
  const recommended = catalog.recommendChannelIds({ propertyClass: 'commercial', goal: 'sellers' });
  assert.equal(recommended.includes('bandit'), false);
  assert.equal(recommended.includes('door-knock'), false);
  assert.ok(recommended.includes('letter'));
  assert.ok(catalog.recommendChannelIds({ propertyClass: 'residential', goal: 'sellers' }).includes('postcard'));
});

test('vendor names are stripped and never appear in starter copy or the prompt', () => {
  const dirty = 'Mail this with Lob and pull it from PropertyRadar, then text via Twilio.';
  const clean = catalog.filterVendorNames(dirty);
  assert.equal(catalog.containsVendorName(clean), false);
  assert.match(clean, /FORGE's mail service/);
  assert.match(clean, /FORGE's lead data/);
  catalog.CHANNELS.forEach(channel => {
    if (channel.copy === false) return;
    const piece = catalog.starterPiece(channel.id, { propertyClass: channel.commercial ? 'commercial' : 'residential', leads: [catalog.SAMPLE_LEAD] });
    assert.equal(catalog.containsVendorName(piece.variantA + piece.variantB), false, channel.id);
  });
  assert.equal(catalog.containsVendorName(copyApi.systemPrompt('residential')), false);
  assert.equal(catalog.containsVendorName(copyApi.systemPrompt('commercial')), false);
  assert.match(copyApi.systemPrompt('residential'), /real estate deal/);
  assert.match(copyApi.systemPrompt('commercial'), /Never recommend bandit signs or door hangers/);
});

test('production flag stays on the admin allowlist and previews open', () => {
  const closed = access.decideMarketingAccess({ email: 'member@example.com', empire: false, env: { CONTEXT: 'production' } });
  assert.equal(closed.allowed, false);
  assert.equal(closed.brandLimit, 1);
  const john = access.decideMarketingAccess({ email: 'John@TheDessauerGroup.com', empire: true, env: { CONTEXT: 'production' } });
  assert.equal(john.allowed, true);
  assert.equal(john.reviewer, true);
  assert.equal(john.brandLimit, 3);
  const extra = access.decideMarketingAccess({ email: 'guest@example.com', empire: false, env: { CONTEXT: 'production', MARKETING_ALLOWLIST: 'guest@example.com' } });
  assert.equal(extra.allowed, true);
  assert.equal(extra.reviewer, true);
  const preview = access.decideMarketingAccess({ email: 'member@example.com', empire: false, env: { CONTEXT: 'deploy-preview' } });
  assert.equal(preview.allowed, true);
  assert.equal(preview.reviewer, false);
  const unset = access.decideMarketingAccess({ email: 'john@thedessauergroup.com', empire: true, env: {} });
  assert.equal(unset.allowed, true);
  const stranger = access.decideMarketingAccess({ email: 'member@example.com', empire: true, env: {} });
  assert.equal(stranger.allowed, false);
  const forced = access.decideMarketingAccess({ email: 'member@example.com', empire: false, env: { CONTEXT: 'deploy-preview', MARKETING_FEATURE: 'closed' } });
  assert.equal(forced.allowed, false);
});

test('logo and headshot validation cleans SVG and rejects animation', () => {
  const logo = images.validateImage({
    kind: 'logo',
    fileName: 'mark.svg',
    dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><script>alert(1)</script><rect fill="#112233" width="10" height="10"/><a href="https://evil.example/x">x</a></svg>').toString('base64'),
  });
  assert.equal(logo.contentType, 'image/svg+xml');
  assert.equal(/<script/i.test(logo.bytes.toString('utf8')), false);
  assert.equal(/https:/.test(logo.bytes.toString('utf8')), false);
  assert.equal(logo.width, 800);
  assert.deepEqual(logo.swatches, ['#112233']);
  assert.throws(() => images.validateImage({
    kind: 'logo',
    fileName: 'spin.svg',
    dataBase64: Buffer.from('<svg><animate attributeName="x"/></svg>').toString('base64'),
  }), /Animated/);
  const soft = images.validateImage({ kind: 'logo', fileName: 'tiny.png', dataBase64: png(200, 80).toString('base64') });
  assert.ok(soft.warnings.join(' ').includes('600'));
  const shot = images.validateImage({ kind: 'headshot', fileName: 'me.jpg', dataBase64: jpeg(900, 900).toString('base64') });
  assert.equal(shot.width, 900);
  assert.equal(shot.height, 900);
  const stray = Buffer.concat([
    Buffer.from([0, 0, 0, 4]),
    Buffer.from('IDAT'),
    Buffer.from('acTL'),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const ordinary = images.validateImage({ kind: 'logo', fileName: 'logo.png', bytes: png(500, 500, stray) });
  assert.equal(ordinary.width, 500);
  assert.equal(ordinary.height, 500);
  assert.match(ordinary.warnings.join(' '), /600/);
  const actl = Buffer.concat([
    Buffer.from([0, 0, 0, 8]),
    Buffer.from('acTL'),
    Buffer.alloc(8),
    Buffer.alloc(4),
  ]);
  assert.throws(() => images.validateImage({ kind: 'logo', fileName: 'anim.png', bytes: png(800, 800, actl) }), /Animated/);
  const jpgLogo = images.validateImage({ kind: 'logo', fileName: 'mark.jpg', bytes: jpeg(640, 640) });
  assert.equal(jpgLogo.contentType, 'image/jpeg');
  const webp = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([18, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
    Buffer.from([10, 0, 0, 0]),
    Buffer.alloc(10),
  ]);
  const webpLogo = images.validateImage({ kind: 'logo', fileName: 'mark.webp', bytes: webp });
  assert.equal(webpLogo.contentType, 'image/webp');
  assert.throws(() => images.validateImage({
    kind: 'logo',
    fileName: 'big.png',
    bytes: Buffer.alloc(images.LOGO_MAX_BYTES + 1),
  }), /5 MB/);
  assert.equal(images.looksAlikeBrand('irs-seal.png'), true);
  assert.ok(images.contrastRatio('#ffffff', '#000000') > 4.5);
  assert.equal(images.readableTextColor('#ffffff'), '#1A1A1A');
});

test('Brand Kit is per member, rights are logged, and Empire stops at 3 brands', async () => {
  const john = world({ memberId: 'mem_john' });
  const handler = brandApi.createHandler(john.deps);
  const denied = await john.call(handler, { action: 'upload', brandId: 'x', kind: 'logo', fileName: 'a.svg', dataBase64: 'YQ==', rightsAccepted: false });
  assert.equal(denied.status, 400);
  const saved = await john.call(handler, {
    action: 'save',
    brand: {
      businessName: 'Example Buys',
      phone: '555-0100',
      signOff: 'Jordan Example',
      returnAddress: { line1: '1 Main', city: 'Sampletown', state: 'ST', zip: '00000' },
      fontFamily: 'Comic Sans',
    },
  });
  assert.equal(saved.status, 400);
  const ok = await john.call(handler, {
    action: 'save',
    brand: {
      label: 'Residential',
      businessName: 'Example Buys',
      phone: '(555) 010-0000',
      website: 'https://example.test',
      email: 'hello@example.test',
      signOff: 'Jordan Example',
      tagline: 'As-is, on your timeline',
      returnAddress: { line1: '1 Main', city: 'Sampletown', state: 'ST', zip: '00000' },
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mail.ready, true);
  assert.equal(ok.body.brand.disclosure, catalog.DISCLOSURE_DEFAULT);
  const brandId = ok.body.brand.id;
  const upload = await john.call(handler, {
    action: 'upload',
    brandId: brandId,
    kind: 'logo',
    fileName: 'irs-seal.svg',
    rightsAccepted: true,
    dataBase64: Buffer.from('<svg width="700" height="200"><rect fill="#224466"/></svg>').toString('base64'),
  });
  assert.equal(upload.status, 200);
  assert.equal(upload.body.flagged, true);
  assert.equal(upload.body.brand.logo.fileName, 'irs-seal.svg');
  const rights = JSON.parse(await john.blob.get('rights/mem_john.json'));
  assert.equal(rights[0].text, catalog.RIGHTS_TEXT);
  assert.equal(rights[0].memberId, 'mem_john');
  const file = await john.call(handler, null, 'GET');
  assert.equal(file.body.brands[0].logo.fileName, 'irs-seal.svg');
  const other = world({ memberId: 'mem_foundation', context: 'deploy-preview' });
  const otherHandler = brandApi.createHandler(Object.assign({}, other.deps, { getStore: () => john.blob }));
  const peeked = await other.call(otherHandler, null, 'GET');
  assert.equal(peeked.body.brands.length, 0);
  const asset = await otherHandler({
    httpMethod: 'GET',
    headers: { authorization: 'Bearer tok' },
    queryStringParameters: { brandId: brandId, asset: 'logo' },
  });
  assert.equal(asset.statusCode, 404);
  const second = await other.call(otherHandler, { action: 'save', brand: { businessName: 'One' } });
  assert.equal(second.status, 200);
  const third = await other.call(otherHandler, { action: 'save', brand: { businessName: 'Two' } });
  assert.equal(third.status, 403);
  for (let n = 0; n < 2; n += 1) {
    const extra = await john.call(handler, { action: 'save', brand: { businessName: 'Brand ' + n, phone: '5550100000' } });
    assert.equal(extra.status, 200, 'empire brand ' + n);
  }
  const fourth = await john.call(handler, { action: 'save', brand: { businessName: 'Too many' } });
  assert.equal(fourth.status, 403);
  const queue = await john.call(handler, { action: 'review-list' });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.items[0].notification.status, 'not-sent');
  const hidden = await other.call(otherHandler, { action: 'review-list' });
  assert.equal(hidden.status, 403);
});

test('ARIS copy uses the existing model, filters vendors, and will not export mail or calls early', async () => {
  let sent = null;
  const rig = world({
    memberId: 'mem_john',
    fetch: async (url, init) => {
      sent = JSON.parse(init.body);
      return { json: async () => ({ content: [{ type: 'text', text: '{"recommendation":"Use Lob.","copies":[{"channel":"postcard","variantA":"Mailed by Lob","variantB":"Hi from PropertyRadar"}]}' }] }) };
    },
  });
  const brandHandler = brandApi.createHandler(rig.deps);
  const saved = await rig.call(brandHandler, {
    action: 'save',
    brand: {
      businessName: 'Example Buys',
      phone: '555-010-0000',
      returnAddress: { line1: '1 Main', city: 'Sampletown', state: 'ST', zip: '00000' },
    },
  });
  const copy = copyApi.createHandler(rig.deps);
  const locked = world({ memberId: 'mem_foundation', context: 'deploy-preview', fetch: rig.deps.fetch });
  const foundation = copyApi.createHandler(Object.assign({}, locked.deps, { getStore: () => rig.blob }));
  const commercial = await locked.call(foundation, { action: 'generate', propertyClass: 'commercial', channels: ['letter'], leads: [] });
  assert.equal(commercial.status, 403);
  const generated = await rig.call(copy, {
    action: 'generate',
    goal: 'sellers',
    propertyClass: 'residential',
    channels: ['postcard', 'door-hanger', 'bandit'],
    brandId: saved.body.brand.id,
    leads: [{ address: '10 Oak', city: 'Gary', state: 'IN', zip: '46404', owner: 'Pat Example', propertyType: 'SFR', playIds: ['absentee'], phone: 'secret' }],
  });
  assert.equal(generated.status, 200);
  assert.equal(sent.model, copyApi.MODEL);
  assert.equal(sent.max_tokens, copyApi.MAX_TOKENS);
  assert.equal(JSON.stringify(sent).includes('secret'), false);
  assert.equal(catalog.containsVendorName(generated.body.copies.map(piece => piece.variantA + piece.variantB).join(' ')), false);
  assert.equal(catalog.containsVendorName(generated.body.recommendation), false);
  const unready = world({ memberId: 'mem_foundation', context: 'deploy-preview' });
  const bare = copyApi.createHandler(unready.deps);
  const blockedMail = await unready.call(bare, {
    action: 'export',
    propertyClass: 'residential',
    channels: ['postcard'],
    pieces: [{ channel: 'postcard', variantA: 'A', variantB: 'B', approved: true }],
  });
  assert.equal(blockedMail.status, 400);
  assert.match(blockedMail.body.error, /return address/);
  const noBox = await rig.call(copy, {
    action: 'export',
    propertyClass: 'residential',
    channels: ['call'],
    pieces: [{ channel: 'call', variantA: 'A', variantB: 'B', approved: true }],
    accepted: false,
  });
  assert.equal(noBox.status, 400);
  const exported = await rig.call(copy, {
    action: 'export',
    propertyClass: 'residential',
    channels: ['postcard', 'call'],
    brandId: saved.body.brand.id,
    accepted: true,
    pieces: [
      { channel: 'postcard', variantA: 'Hello from Lob', variantB: 'B', approved: true },
      { channel: 'call', variantA: 'Call script', variantB: 'Other', approved: true },
    ],
  });
  assert.equal(exported.status, 200);
  assert.match(exported.body.text, /You are responsible for consent/);
  assert.match(exported.body.text, /You, and not FORGE/);
  assert.equal(exported.body.text.includes('Lob'), false);
  const log = JSON.parse(await rig.blob.get('attestations/mem_john.json'));
  assert.equal(log[0].wordingVersion, catalog.ATTESTATION_VERSION);
  assert.equal(log[0].text, catalog.ATTESTATION_TEXT);
  const dropped = copyApi.allowedChannels('commercial', ['bandit', 'door-knock', 'letter'], true);
  assert.deepEqual(dropped, ['letter']);
});

test('the home card stays Coming soon and the flagged surfaces are wired', () => {
  const dashboard = read('dashboard.html');
  assert.match(dashboard, /id="module-marketing"/);
  assert.match(dashboard, /<div class="module-card coming" id="module-marketing" aria-disabled="true">[\s\S]*Send mail and outreach campaigns to your leads, right from FORGE\.[\s\S]*Coming soon!/);
  assert.match(dashboard, /ForgeMarketingEntry\.mount/);
  const search = read('property-search.html');
  assert.match(search, /Market to these/);
  assert.match(search, /Market to this property/);
  assert.match(search, /Market to all loaded/);
  assert.match(search, /ps-market-bar/);
  assert.match(search, /enableMarketingEntry/);
  const page = read('marketing.html');
  assert.match(page, /Test mode\. Mail is not really printed or delivered/);
  assert.match(page, /FORGE does not send email or text/);
  assert.match(page, /planNeedsPayment \? 'billing\.html\?payment=failed' : 'signup\.html'/);
  assert.match(read('netlify/edge-functions/member-page.js'), /'\/marketing\.html'/);
  assert.match(read('netlify.toml'), /\/api\/marketing-copy/);
  const home = app.createState({ empire: false, propertyClass: 'residential', goal: 'sellers' });
  const picker = app.renderPicker(home);
  assert.match(picker, /Who are you marketing to\?/);
  assert.match(picker, /<strong>Residential<\/strong><span>Homeowners<\/span>/);
  assert.match(picker, /<strong>Commercial<\/strong><span>Business and property owners<\/span>/);
  assert.match(picker, />Empire</);
  assert.match(picker, /ARIS recommends/);
  assert.match(picker, /We mail it/);
  assert.match(picker, /You send it/);
  assert.match(picker, /Nothing is really printed yet/);
  assert.match(picker, /FORGE does not send email or text/);
  const steps = app.renderSteps(home);
  assert.match(steps, /data-step="5"/);
  assert.match(steps, /data-step="6"/);
  assert.equal(steps.includes('coming soon'), false);
  assert.match(picker, /More options/);
  assert.equal(picker.includes('Recommended first'), false);
  assert.equal(picker.includes('FORGE fulfills'), false);
  assert.equal(home.selected.postcard, true);
  assert.equal(home.selected['door-knock'], true);
  assert.equal(home.selected['door-hanger'], undefined);
  const commercialState = app.createState({ empire: true, propertyClass: 'commercial', goal: 'sellers' });
  const commercial = app.renderPicker(commercialState);
  assert.equal(commercial.includes('Bandit sign'), false);
  assert.equal(commercial.includes('Door hanger'), false);
  assert.equal(commercial.includes('Door-knock script'), false);
  assert.match(commercial, /One-page property summary/);
  assert.equal(commercialState.selected.letter, true);
  assert.equal(catalog.containsVendorName(picker + commercial), false);
  const goal = app.renderGoal(app.createState({
    leads: [{ id: '1', address: '9 Pine', propertyType: 'MFR' }],
    empire: false,
  }));
  assert.match(goal, /ARIS will not guess/);
  assert.match(goal, /real estate deal/);
  assert.match(app.renderApprove(app.createState({
    propertyClass: 'residential',
    selected: { call: true },
    copies: { residential: { call: { variantA: 'A', variantB: 'B' } }, commercial: {} },
  })), new RegExp(catalog.ATTESTATION_TEXT.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('order lines keep vendor cost, markup, and student price without showing the provider', () => {
  const postcard = pricing.orderLine('postcard', 47);
  assert.equal(postcard.unitVendorCostCents, 91);
  assert.equal(postcard.unitStudentPriceCents, 109);
  assert.equal(postcard.vendorCostCents + postcard.markupCents, postcard.studentPriceCents);
  assert.equal(postcard.markupRate, pricing.MAIL_MARKUP_RATE);
  assert.equal(postcard.provider, pricing.MAIL_PROVIDER);
  assert.equal(postcard.billing.method, null);
  assert.equal(postcard.billing.stripeReference, null);
  assert.equal(postcard.billing.walletDebitCents, null);

  const letter = pricing.orderLine('letter', 1);
  assert.equal(letter.vendorCostCents + letter.markupCents, letter.studentPriceCents);
  assert.equal(letter.markupRate, 0.20);
  assert.equal(letter.provider, pricing.MAIL_PROVIDER);

  const hanger = pricing.orderLine('door-hanger', 1000);
  const sign = pricing.orderLine('bandit', 100);
  assert.equal(hanger.markupRate, pricing.PRINT_MARKUP_RATE);
  assert.equal(sign.markupRate, pricing.PRINT_MARKUP_RATE);
  assert.ok(pricing.PRINT_MARKUP_RATE >= 0.25 && pricing.PRINT_MARKUP_RATE <= pricing.PRINT_MARKUP_RATE_MAX);
  assert.equal(hanger.shippingCents, null);
  assert.equal(hanger.vendorCostCents + hanger.markupCents, hanger.studentPriceCents);
  assert.equal(sign.vendorCostCents + sign.markupCents, sign.studentPriceCents);
  assert.equal(pricing.BASIS.handwritten.provider, null);
  assert.equal(pricing.BASIS.handwritten.markupRate, 0.20);

  const shown = pricing.publicQuote(postcard);
  assert.equal(Object.prototype.hasOwnProperty.call(shown, 'provider'), false);
  assert.equal(JSON.stringify(shown).toLowerCase().includes(pricing.MAIL_PROVIDER), false);

  assert.equal(pricing.orderLine('call', 3).priced, false);
  assert.equal(pricing.orderLine('skip-trace', 10).priced, false);
  assert.equal(pricing.orderLine('skip-trace', 10).studentPriceCents, null);

  const memberFiles = ['marketing.html', 'assets/js/marketing-app.js', 'assets/js/marketing-entry.js', 'assets/css/marketing.css']
    .map(read).join('\n');
  assert.equal(new RegExp('\\b' + pricing.MAIL_PROVIDER + '\\b', 'i').test(memberFiles), false);
  assert.equal(catalog.containsVendorName(app.renderPicker(app.createState({ empire: true, propertyClass: 'residential' }))), false);
});

function installMarketingDocument() {
  const nodes = {};
  function node(id) {
    if (!nodes[id]) {
      nodes[id] = {
        id: id,
        hidden: id === 'mkt-app' || id === 'mkt-locked',
        innerHTML: '',
        addEventListener() {},
      };
    }
    return nodes[id];
  }
  const previousDocument = global.document;
  const previousFetch = global.fetch;
  global.document = {
    getElementById(id) { return node(id); },
    querySelectorAll() { return []; },
  };
  return {
    nodes: nodes,
    restore() {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (previousFetch === undefined) delete global.fetch;
      else global.fetch = previousFetch;
    },
  };
}

test('an allowlisted member sees the Marketing screen, and a failed check is visible', async () => {
  assert.equal(/\broot\b/.test(app.start.toString()), false);
  const page = installMarketingDocument();
  try {
    global.fetch = async (url) => {
      const path = String(url);
      if (path.includes('marketing-access')) {
        return { ok: true, json: async () => ({ allowed: true, empire: true, brandLimit: 3, reviewer: true }) };
      }
      if (path.includes('marketing-brand')) return { ok: true, json: async () => ({ brands: [] }) };
      throw new Error('unexpected ' + path);
    };
    await app.start({ token: 'tok', sender: { name: 'John', phone: '' } });
    assert.equal(page.nodes['mkt-loading'].hidden, true);
    assert.equal(page.nodes['mkt-app'].hidden, false);
    assert.equal(page.nodes['mkt-locked'].hidden, true);
    assert.match(page.nodes['mkt-main'].innerHTML, /What do you want this campaign to do/);

    page.nodes['mkt-app'].hidden = true;
    page.nodes['mkt-locked'].hidden = true;
    page.nodes['mkt-locked'].innerHTML = '';
    global.fetch = async () => { throw new Error('network down'); };
    await app.start({ token: 'tok' });
    assert.equal(page.nodes['mkt-app'].hidden, true);
    assert.equal(page.nodes['mkt-loading'].hidden, true);
    assert.equal(page.nodes['mkt-locked'].hidden, false);
    assert.match(page.nodes['mkt-locked'].innerHTML, /Marketing could not be opened/);

    global.fetch = async () => ({ ok: true, json: async () => ({ allowed: false, reason: 'flagged' }) });
    page.nodes['mkt-locked'].innerHTML = '';
    await app.start({ token: 'tok' });
    assert.equal(page.nodes['mkt-app'].hidden, true);
    assert.match(page.nodes['mkt-locked'].innerHTML, /Coming soon!/);
  } finally {
    page.restore();
  }
});

test('a 500 by 500 PNG uploads as the raw file, and the rights box is required', async () => {
  const rig = world({ memberId: 'mem_john' });
  const handler = brandApi.createHandler(rig.deps);
  const saved = await rig.call(handler, { action: 'save', brand: { businessName: 'Example Buys', phone: '555-010-0000' } });
  const brandId = saved.body.brand.id;
  const bytes = png(500, 500);
  const denied = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'image/png' },
    queryStringParameters: { action: 'upload', brandId: brandId, kind: 'logo', fileName: 'logo.png' },
    isBase64Encoded: true,
    body: bytes.toString('base64'),
  });
  assert.equal(denied.statusCode, 400);
  assert.match(JSON.parse(denied.body).error, /own this logo or image/);
  const uploaded = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'image/png' },
    queryStringParameters: { action: 'upload', brandId: brandId, kind: 'logo', fileName: 'logo.png', rights: '1' },
    isBase64Encoded: true,
    body: bytes.toString('base64'),
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const body = JSON.parse(uploaded.body);
  assert.equal(body.brand.logo.fileName, 'logo.png');
  assert.equal(body.brand.logo.width, 500);
  assert.match((body.warnings || []).join(' '), /600/);
  const stored = await rig.blob.get('assets/mem_john/' + brandId + '/logo', { type: 'arrayBuffer' });
  assert.equal(Buffer.from(stored).slice(0, 4).toString('hex'), bytes.slice(0, 4).toString('hex'));
  const page = app.renderBrand(Object.assign(app.createState({}), { message: 'Check the rights box to upload.' }));
  assert.match(page, /Check the rights box to upload\./);
  assert.ok(page.indexOf('role="status"') < page.indexOf('Business name'));
  assert.match(page, /image\/webp/);
  assert.match(read('assets/js/marketing-app.js'), /Check the rights box to upload\./);
  const brand = app.renderBrand(app.createState({ empire: true }));
  const rightsAt = brand.indexOf('class="mkt-check"');
  const uploadsAt = brand.indexOf('class="mkt-uploads"');
  const saveAt = brand.indexOf('class="mkt-save"');
  assert.ok(rightsAt > -1 && uploadsAt > rightsAt && saveAt > uploadsAt);
  assert.match(brand.slice(rightsAt - 7, uploadsAt), /<label class="mkt-check"><input type="checkbox" name="rights"><span>I own this logo or image/);
  assert.equal((brand.match(/class="mkt-file"/g) || []).length, 2);
  assert.match(read('assets/css/marketing.css'), /input:not\(\[type="checkbox"\]\):not\(\[type="file"\]\)/);
  assert.match(read('assets/css/marketing.css'), /\.mkt-uploads \{ display: grid; grid-template-columns: 1fr 1fr/);
});

test('the postcard preview shows the saved logo, one disclosure, and a QR caption', () => {
  const brand = {
    id: 'b1',
    businessName: 'Example Buys',
    phone: '555-0100',
    disclosure: catalog.DISCLOSURE_DEFAULT,
    logo: { fileName: 'logo.png', contentType: 'image/png', width: 500, height: 500 },
    colors: { primary: '#112233' },
  };
  const state = app.createState({
    brandId: 'b1',
    brands: [brand],
    previewId: 'postcard',
    logoUrls: { b1: 'blob:john-logo' },
    propertyClass: 'residential',
  });
  const html = app.renderPreview(state);
  assert.match(html, /<img class="mkt-logo" src="blob:john-logo"/);
  assert.equal(html.split(catalog.DISCLOSURE_DEFAULT).length - 1, 1);
  assert.match(html, /QR code \(placeholder\)/);
  assert.equal(html.includes('Logo on file'), false);
  const note = app.renderPreview(app.createState({
    brandId: 'b1',
    brands: [brand],
    previewId: 'handwritten',
    logoUrls: { b1: 'blob:john-logo' },
  }));
  assert.equal(note.includes('mkt-logo'), false);
  assert.equal(note.split(catalog.DISCLOSURE_DEFAULT).length - 1, 1);
});

test('the blob store is connected from the Lambda event before it opens', () => {
  const calls = [];
  const event = { blobs: 'from-netlify', headers: { 'x-nf-site-id': 'site' } };
  const store = marketingStore.openBlobStore(event, {
    connectLambda(got) { calls.push(['connect', got]); },
    getNamedStore(name) { calls.push(['store', name]); return { ready: true }; },
  });
  assert.deepEqual(calls, [['connect', event], ['store', 'marketing']]);
  assert.equal(store.ready, true);
  assert.equal(marketingStore.STORE_NAME, 'marketing');
  assert.doesNotMatch(marketingStore.STORE_NAME, /\//);
  assert.match(read('netlify/functions/marketing-brand.js'), /openBlobStore\(event\)/);
  assert.match(read('netlify/functions/marketing-copy.js'), /openBlobStore\(event\)/);
  assert.throws(() => marketingStore.openBlobStore(event, {
    connectLambda() { const err = new Error('The environment has not been configured to use Netlify Blobs'); throw err; },
  }), /not been configured/);
});

test('marketing access denies a signed-out caller', async () => {
  const rig = world({ deny: true });
  const handler = accessApi.createHandler(rig.deps);
  const res = await rig.call(handler, null, 'GET');
  assert.equal(res.status, 401);
});
