// netlify/functions/membership-check.js
//
// GET/POST with Authorization: Bearer <Memberstack JWT>
//   -> { memberId, active, empire, comps }
//
// 401 missing/invalid session, 403 signed in without a live FORGE plan.
// The page edge gate and the streaming edge functions call this so plan
// rules live in one Node module (plans.js + membership.js). The response
// is only the memberstack id and access flags — no profile fields.

const { enforceMembership } = require('./_Lib/membership');
const { json, preflight } = require('./_Lib/http');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const gate = await enforceMembership(event);
  if (gate.response) return gate.response;

  const access = gate.access;
  return json(200, {
    memberId: access.memberId,
    active: true,
    empire: !!access.empire,
    comps: !!access.comps,
  });
};
