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
  ['postcard', 'letter', 'handwritten', 'bandit', 'yard-sign', 'door-hanger', 'yellow-letter', 'jumbo-postcard', 'offer-letter'].forEach((id) => {
    assert.ok(catalog.templatesFor(id).length >= 4, id);
  });
  assert.ok(catalog.templatesFor('bandit').length >= 5);
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
    selected: { bandit: true, letter: true, 'yellow-letter': true, 'door-hanger': true },
  });
  state.recsFor = 'residential:sellers';
  state.designs = {
    bandit: { template: 'classic-yellow', signSize: '24x18', sides: 'double', stakes: 'h-stake' },
    letter: { envelope: 'plain' },
  };
  const wide = app.renderPicker(state);
  assert.match(pieceCard(wide, 'Bandit sign'), /Pricing coming soon/);
  assert.match(pieceCard(wide, 'Letter'), /Pricing coming soon/);
  assert.match(pieceCard(wide, 'Yellow letter'), /Pricing coming soon/);
  assert.equal((pieceCard(wide, 'Yellow letter').match(/mkt-pill is-soon/g) || []).length, 1);
  assert.match(pieceCard(wide, 'Yellow letter'), /mkt-template/);
  assert.equal(wide.includes('Flyer'), false);
  assert.equal(wide.includes('Business card'), false);

  state.designs.bandit.signSize = '18x24';
  state.designs.letter.envelope = 'window';
  const priced = app.renderPicker(state);
  assert.match(pieceCard(priced, 'Bandit sign'), /\$6\.47 each/);
  assert.match(pieceCard(priced, 'Bandit sign'), /\$323\.50 for 50/);
  assert.match(pieceCard(priced, 'Letter'), /\$1\.28 each/);
  assert.match(pieceCard(priced, 'Door hanger'), /\$1\.82 each/);

  state.designs.bandit.signSize = '24x18';
  state.quote = { lines: [] };
  state.approved = { 'residential:bandit': true };
  state.prints = { bandit: { quantity: 50, option: '18x24-hstake' } };
  assert.equal(app.renderCost(state).includes('data-print-pack="bandit"'), false);
  state.designs.bandit.signSize = '18x24';
  state.designs.bandit.sides = 'single';
  assert.equal(app.renderCost(state).includes('data-print-pack="bandit"'), false);
  state.designs.bandit.sides = 'double';
  assert.match(app.renderCost(state), /data-print-pack="bandit"/);

  const classic = catalog.stylePreview('bandit', '18x24-hstake');
  assert.match(classic, /WE BUY/);
  assert.match(classic, />HOUSES</);
  assert.match(classic, /555-0100/);
  assert.match(classic, /#6f9a55/);
  assert.equal(classic.includes('FORGE'), false);
  BANDIT: {
    const names = ['classic-yellow', 'red-urgent', 'white-blue', 'marker', 'orange-cash', 'big-phone'];
    const arts = names.map((id) => catalog.stylePreview('bandit', '18x24-hstake', { template: id, swatch: true }));
    assert.equal(new Set(arts).size, names.length);
    assert.match(arts[4], /CASH FOR/);
    assert.match(arts[3], /Caveat/);
  }
  assert.equal(catalog.priceMode('bandit', { signSize: '24x18' }), 'soon');
  assert.equal(catalog.priceMode('bandit', { signSize: '18x24', sides: 'double', stakes: 'h-stake' }), 'priced');
  assert.equal(catalog.priceMode('jumbo-postcard', {}), 'soon');
  assert.equal(catalog.designOrderable('bandit', { stakes: 'none' }), false);
  assert.equal(catalog.priceMode('yard-sign', {}), 'soon');
  assert.equal(catalog.designOrderable('yard-sign', { signSize: '18x24', sides: 'double', stakes: 'h-stake' }), false);
  const yardArt = catalog.stylePreview('yard-sign', '');
  assert.match(yardArt, /data-stake="step-in"/);
  assert.match(yardArt, /WE BUY/);
  assert.match(catalog.stylePreview('yard-sign', '', { template: 'sold' }), />SOLD</);
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

  preview.selected = { 'yellow-letter': true, 'jumbo-postcard': true, 'offer-letter': true, 'yard-sign': true, bandit: true };
  preview.approved = {
    'residential:yellow-letter': true,
    'residential:jumbo-postcard': true,
    'residential:offer-letter': true,
    'residential:yard-sign': true,
    'residential:bandit': true,
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
  assert.match(cost, /data-print-pack="bandit"/);
  assert.equal(cost.includes('data-print-pack="yard-sign"'), false);
  assert.equal(cost.includes('data-print-pack="yellow-letter"'), false);
  assert.equal(cost.includes('data-print-pack="jumbo-postcard"'), false);
  assert.equal(cost.includes('data-print-pack="offer-letter"'), false);
});
