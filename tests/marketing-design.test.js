const test = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../assets/js/marketing-catalog');
const pricing = require('../netlify/functions/_Lib/marketing-pricing');
const copyApi = require('../netlify/functions/marketing-copy');
const app = require('../assets/js/marketing-app');

function pieceCard(html, name) {
  const marker = '<strong>' + name + '</strong>';
  const at = html.indexOf(marker);
  const start = html.lastIndexOf('<article', at);
  const end = html.indexOf('</article>', start);
  return html.slice(start, end);
}

test('each mail and print piece has at least four templates', () => {
  ['postcard', 'letter', 'handwritten', 'yard-sign', 'door-hanger', 'yellow-letter', 'jumbo-postcard', 'offer-letter'].forEach((id) => {
    assert.ok(catalog.templatesFor(id).length >= 4, id);
  });
  assert.equal(catalog.templatesFor('bandit').length, 0);
  assert.equal(catalog.channelById('bandit'), null);
  assert.equal(catalog.templatesFor('call').length, 0);
  assert.equal(catalog.CHANNELS.some((row) => row.id === 'flyer' || row.id === 'business-card'), false);
});

test('the message angle is filtered by property class and passed into the copy prompt', () => {
  const residential = catalog.anglesFor('residential').map((row) => row.id);
  const commercial = catalog.anglesFor('commercial').map((row) => row.id);
  assert.ok(residential.includes('neighbor'));
  assert.ok(residential.includes('divorce'));
  assert.equal(commercial.includes('neighbor'), false);
  assert.equal(commercial.includes('divorce'), false);
  assert.ok(commercial.includes('landlord'));
  assert.equal(catalog.angleById('neighbor', 'commercial'), null);

  const system = copyApi.systemPrompt('residential', 'prefore');
  const user = copyApi.userPrompt({
    goal: 'sellers',
    propertyClass: 'residential',
    channels: ['postcard'],
    angle: 'landlord',
  });
  assert.match(system, /Behind on Payments \/ Pre-foreclosure/);
  assert.match(system, /Do not say you know they are behind or in foreclosure/);
  assert.match(user, /Tired Landlord/);
  assert.equal(catalog.containsVendorName(system + user), false);
  assert.equal(copyApi.systemPrompt('commercial', 'neighbor').includes('Neighbor'), false);

  const piece = catalog.starterPiece('postcard', {
    propertyClass: 'residential',
    angle: 'vacant',
    leads: [catalog.SAMPLE_LEAD],
  });
  assert.match(piece.variantA, /sitting empty/);
  assert.equal(catalog.containsVendorName(piece.variantA + piece.variantB), false);
  const plain = catalog.starterPiece('postcard', { propertyClass: 'residential', leads: [catalog.SAMPLE_LEAD] });
  assert.equal(plain.variantA.startsWith('If the property is sitting empty'), false);
});

test('unpriced sign choices are not given a made-up price and are not orderable', () => {
  const menu = pricing.publicMenu({});
  const state = app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    menu: menu,
    selected: { letter: true, 'yellow-letter': true, 'door-hanger': true },
  });
  state.recsFor = 'residential:sellers';
  state.designs = { letter: { envelope: 'plain' } };
  const wide = app.renderPicker(state);
  assert.equal(wide.includes('Bandit sign'), false);
  assert.equal(wide.includes('WE BUY HOUSES'), false);
  assert.equal(wide.includes('We buy houses'), false);
  assert.match(pieceCard(wide, 'Letter'), /Pricing coming soon/);
  assert.match(pieceCard(wide, 'Yellow letter'), /Pricing coming soon/);
  assert.equal((pieceCard(wide, 'Yellow letter').match(/mkt-pill is-soon/g) || []).length, 1);
  assert.match(pieceCard(wide, 'Yellow letter'), /mkt-template/);
  assert.equal(wide.includes('Flyer'), false);
  assert.equal(wide.includes('Business card'), false);

  state.designs.letter.envelope = 'window';
  const priced = app.renderPicker(state);
  assert.match(pieceCard(priced, 'Letter'), /\$1\.28 each/);
  assert.match(pieceCard(priced, 'Door hanger'), /\$1\.82 each/);

  state.quote = { lines: [] };
  state.approved = { 'residential:bandit': true };
  state.prints = { bandit: { quantity: 50, option: '18x24-hstake' } };
  assert.equal(app.renderCost(state).includes('data-print-pack="bandit"'), false);
  assert.equal(pricing.quoteOrder(['bandit'], 12, {}, state.prints.bandit && [{ channelId: 'bandit', quantity: 50, option: '18x24-hstake' }]).printChargedCents, 0);

  assert.equal(catalog.priceMode('bandit', {}), 'soon');
  assert.equal(catalog.designOrderable('bandit'), false);
  assert.equal(catalog.priceMode('jumbo-postcard', {}), 'soon');
  assert.equal(catalog.priceMode('yard-sign', {}), 'soon');
  assert.equal(catalog.designOrderable('yard-sign'), false);
  const yardArt = catalog.stylePreview('yard-sign', '');
  assert.match(yardArt, /data-stake="step-in"/);
  assert.match(yardArt, /CASH/);
  assert.match(yardArt, />OFFER</);
  assert.equal(/WE BUY|We buy houses/i.test(yardArt), false);
  assert.match(catalog.stylePreview('yard-sign', '', { template: 'sold' }), />SOLD</);
  assert.match(catalog.stylePreview('yard-sign', '', { template: 'any-condition' }), /ANY/);
  assert.match(catalog.stylePreview('yard-sign', '', { template: 'no-repairs' }), /No repairs/);
  assert.equal(yardArt.includes('#ffe14a'), false);

  const preview = app.createState({
    step: 2,
    goal: 'sellers',
    propertyClass: 'residential',
    empire: true,
    menu: menu,
  });
  preview.recsFor = 'residential:sellers';
  const yardCard = pieceCard(app.renderPicker(preview), 'Yard sign');
  assert.equal((yardCard.match(/mkt-pill is-soon/g) || []).length, 1);
  assert.equal(yardCard.includes('type="checkbox"'), false);
  assert.equal(yardCard.includes('Ship to me'), false);
  assert.equal(yardCard.includes('$6.47'), false);
  assert.equal(yardCard.includes('data-print-pack'), false);
  assert.match(yardCard, /Pricing coming soon/);
  assert.match(yardCard, /mkt-template/);
  assert.match(yardCard, /Sold/);
  assert.match(yardCard, /data-stake="step-in"/);

  preview.selected = { 'yellow-letter': true, 'jumbo-postcard': true, 'offer-letter': true, 'yard-sign': true };
  preview.approved = {
    'residential:yellow-letter': true,
    'residential:jumbo-postcard': true,
    'residential:offer-letter': true,
    'residential:yard-sign': true,
  };
  preview.quote = { lines: [] };
  preview.prints = {
    'yard-sign': { quantity: 50, option: '18x24-hstake' },
    bandit: { quantity: 50, option: '18x24-hstake' },
  };
  const chosen = app.renderPicker(preview);
  ['Yellow letter', 'Jumbo postcard', 'Offer letter'].forEach((name) => {
    const card = pieceCard(chosen, name);
    assert.equal((card.match(/mkt-pill is-soon/g) || []).length, 1, name);
    assert.match(card, /Pricing coming soon/);
    assert.equal(card.includes('data-print-pack'), false, name);
  });
  const cost = app.renderCost(preview);
  assert.equal(cost.includes('Bandit sign'), false);
  assert.equal(cost.includes('data-print-pack="bandit"'), false);
  assert.equal(cost.includes('data-print-pack="yard-sign"'), false);
  assert.equal(cost.includes('data-print-pack="yellow-letter"'), false);
  assert.equal(cost.includes('data-print-pack="jumbo-postcard"'), false);
  assert.equal(cost.includes('data-print-pack="offer-letter"'), false);
});
