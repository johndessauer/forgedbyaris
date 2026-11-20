// Property Search -> Marketing handoff. Every lead type must become a
// street, city, state, and ZIP. Absentee mail uses the owner mailing
// address when the county has one.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

const entry = require('../assets/js/marketing-entry');
const lob = require('../netlify/functions/_Lib/marketing-lob');
const pricing = require('../netlify/functions/_Lib/marketing-pricing');
const { LEAD_CRITERIA } = require('../netlify/functions/_Lib/lead-criteria');
const app = require('../assets/js/marketing-app');

function loadPropertySearch() {
  const stubs = {
    [path.join(__dirname, '../netlify/functions/_Lib/verify-member.js')]: { verifyMember: async () => 'mem_1', AuthError: class extends Error {} },
    [path.join(__dirname, '../netlify/functions/_Lib/membership.js')]: {
      enforceMembership: async () => ({ access: { memberId: 'mem_1', active: true, empire: true, comps: true } }),
    },
    [path.join(__dirname, '../netlify/functions/_Lib/supabase-client.js')]: { supabase: {} },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (stubs[resolved]) return stubs[resolved];
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../netlify/functions/property-search')];
    return require('../netlify/functions/property-search');
  } finally { Module._load = orig; }
}

function radar(id, absentee) {
  return {
    RadarID: 'R-' + id,
    Address: '100 ' + id + ' St',
    City: 'Crown Point',
    State: 'IN',
    ZipFive: '46307',
    Owner: 'Owner ' + id,
    OwnerAddress: '500 Mail St',
    OwnerCity: 'Chicago',
    OwnerState: 'IL',
    OwnerZipFive: '60601',
    isSameMailingOrExempt: absentee ? 0 : 1,
    PType: 'SFR',
  };
}

test('every lead type maps to a mailable address, and absentees use the owner mailing address', () => {
  const ps = loadPropertySearch();
  assert.ok(ps.PROPERTYRADAR_FIELDS.includes('OwnerAddress'));
  assert.ok(ps.PROPERTYRADAR_FIELDS.includes('OwnerCity'));
  assert.ok(ps.PROPERTYRADAR_FIELDS.includes('OwnerState'));
  assert.ok(ps.PROPERTYRADAR_FIELDS.includes('OwnerZipFive'));

  const leads = Object.keys(LEAD_CRITERIA).map(function (id) {
    const absentee = id === 'absentee' || id === 'bored';
    const row = ps.mapRadarRecord(radar(id, absentee), 0, [id]);
    return entry.leadForMarketing(row);
  });

  leads.forEach(function (lead) {
    assert.equal(lob.mailable(lead), true, lead.playIds[0]);
    assert.equal(lead.owner, 'Owner ' + lead.playIds[0]);
    if (lead.playIds[0] === 'absentee' || lead.playIds[0] === 'bored') {
      assert.equal(lead.mailSource, 'owner');
      assert.equal(lead.address, '500 Mail St');
      assert.equal(lead.city, 'Chicago');
      assert.equal(lead.state, 'IL');
      assert.equal(lead.zip, '60601');
    } else {
      assert.equal(lead.mailSource, 'property');
      assert.equal(lead.address, '100 ' + lead.playIds[0] + ' St');
      assert.equal(lead.city, 'Crown Point');
      assert.equal(lead.state, 'IN');
      assert.equal(lead.zip, '46307');
    }
  });

  const noMail = ps.mapRadarRecord({
    RadarID: 'R-none',
    Address: '9 Pine St',
    City: 'Gary',
    State: 'IN',
    ZipFive: '46404',
    Owner: 'No Mail',
    isSameMailingOrExempt: 0,
  }, 0, ['absentee']);
  const fallback = entry.leadForMarketing(noMail);
  assert.equal(fallback.mailSource, 'property');
  assert.equal(fallback.address, '9 Pine St');
  assert.equal(fallback.zip, '46404');

  const formatted = entry.leadForMarketing({
    id: 'demo-1',
    address: '1188 S Court St, Crown Point, IN 46307',
    owner: 'J. Whitfield',
    playIds: ['prefore'],
    details: {},
  });
  assert.equal(formatted.mailSource, 'property');
  assert.equal(formatted.address, '1188 S Court St');
  assert.equal(formatted.city, 'Crown Point');
  assert.equal(formatted.state, 'IN');
  assert.equal(formatted.zip, '46307');
  assert.equal(lob.mailable(formatted), true);

  const quote = pricing.quoteOrder(['postcard'], leads.length, {});
  assert.equal(quote.leadCount, leads.length);
  assert.equal(quote.chargedCents, 109 * leads.length);
  const listed = app.renderGoal(app.createState({ leads: leads.slice(0, 1), empire: true }));
  assert.match(listed, /Mailing to the owner mailing address/);
  const prefore = entry.leadForMarketing(ps.mapRadarRecord(radar('prefore', false), 0, ['prefore']));
  const arrival = app.createState({ leads: [prefore], empire: true });
  assert.equal(app.arriveFromSearch(arrival, {
    source: 'property-search',
    leadTypes: ['prefore'],
    leads: [prefore],
  }), true);
  assert.equal(arrival.step, 2);
  assert.equal(arrival.goal, 'sellers');
  assert.match(arrival.goalNote, /ARIS picked Find motivated sellers because this is a Pre-Foreclosures lead/);
  assert.match(app.renderPicker(arrival), /Change it if you want/);
  assert.match(app.renderGoal(arrival), /\+ Add another address/);
  assert.equal(app.renderGoal(arrival).includes('<h3>Add an address</h3>'), false);
  const buyers = app.pickCampaignGoal({ source: 'property-search', leads: [{ playIds: ['cashbuyer'] }] });
  assert.equal(buyers.goal, 'buyers');
  const imported = app.pickCampaignGoal({ source: 'lead-list', leads: [{ playIds: [] }] });
  assert.equal(imported.goal, 'followup');
  const plain = app.createState({});
  assert.equal(app.arriveFromSearch(plain, null), false);
  assert.equal(plain.step, 1);
  assert.match(app.renderGoal(plain), /<h3>Add an address<\/h3>/);
});
