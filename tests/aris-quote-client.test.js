const test = require('node:test');
const assert = require('node:assert/strict');
const { usableMemberToken, errorFromQuoteResponse } = require('../assets/js/aris-quote-client');

test('missing, null, and non-strings are not member tokens', () => {
  assert.equal(usableMemberToken(null), '');
  assert.equal(usableMemberToken(undefined), '');
  assert.equal(usableMemberToken('null'), '');
  assert.equal(usableMemberToken('undefined'), '');
  assert.equal(usableMemberToken('  '), '');
  assert.equal(usableMemberToken(401), '');
  assert.equal(usableMemberToken(' labeled-test-token '), 'labeled-test-token');
});

test('401 session_expired is a login failure, other statuses keep the HTTP code', () => {
  assert.equal(errorFromQuoteResponse(401, { error: 'session_expired', message: 'Please log in again.' }), 'Please log in again.');
  assert.equal(errorFromQuoteResponse(401, null), 'Please log in again.');
  assert.equal(errorFromQuoteResponse(500, { error: 'Function error' }), 'ARIS unavailable (HTTP 500). Try again.');
  assert.equal(errorFromQuoteResponse(502, null), 'ARIS unavailable (HTTP 502). Try again.');
  assert.equal(errorFromQuoteResponse(200, { error: 'session_expired' }), 'Please log in again.');
});
