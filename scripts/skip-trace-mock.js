#!/usr/bin/env node
// Hits the free sandbox lookup and checks the field names this app reads.
// No real credits are spent. Any non-empty bearer token is accepted there.
const shared = require('../assets/js/skip-trace-shared');
const present = require('../netlify/functions/_Lib/skip-trace-present');

const base = (process.env.TRACERFY_BASE_URL || 'https://mock.tracerfy.com').replace(/\/+$/, '');
const key = process.env.TRACERFY_API_KEY || 'sandbox_test_token';

async function post(body) {
  const response = await fetch(base + '/v1/api/trace/lookup/', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'User-Agent': 'FORGE/1.0',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data };
}

function assertShape(view) {
  if (!view || typeof view.hit !== 'boolean') throw new Error('missing hit');
  if (!Array.isArray(view.persons)) throw new Error('missing persons');
  view.persons.forEach(function (person) {
    if (!Array.isArray(person.phones) || !Array.isArray(person.emails)) throw new Error('missing contact lists');
    person.phones.forEach(function (phone) {
      ['number', 'type', 'dnc', 'tcpa', 'litigator'].forEach(function (keyName) {
        if (!Object.prototype.hasOwnProperty.call(phone, keyName)) throw new Error('phone missing ' + keyName);
      });
    });
  });
  if (/tracerfy/i.test(JSON.stringify(view))) throw new Error('vendor name leaked into the member payload');
}

async function main() {
  const hit = await post({
    address: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    find_owner: true,
    first_name: 'Jane',
    last_name: 'Doe',
  });
  if (hit.status !== 200 || hit.data.hit !== true) {
    console.error(hit.status, JSON.stringify(hit.data).slice(0, 400));
    throw new Error('sandbox hit was not returned');
  }
  const phone = hit.data.persons[0].phones[0];
  ['number', 'type', 'dnc', 'tcpa', 'carrier'].forEach(function (keyName) {
    if (!Object.prototype.hasOwnProperty.call(phone, keyName)) throw new Error('sandbox phone missing ' + keyName);
  });
  if (typeof hit.data.persons[0].litigator !== 'boolean') throw new Error('sandbox person missing litigator');
  const view = present.presentLookup(hit.data, shared.parseAddress({ address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' }), 'Jane Doe');
  assertShape(view);

  const miss = await post({ address: '999 Nowhere Blvd', city: 'Austin', state: 'TX', zip: '78701', find_owner: true });
  if (miss.status !== 200 || miss.data.hit !== false) throw new Error('sandbox miss was not returned');

  const empty = await post({ address: 'NO_CREDITS', city: 'Austin', state: 'TX', zip: '78701', find_owner: true });
  if (empty.status !== 402) throw new Error('sandbox 402 was not returned, got ' + empty.status);

  console.log('Sandbox lookup shape matches. Hit phones: ' + view.persons[0].phones.length + '. Miss and 402 behaved as documented.');
}

main().catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
