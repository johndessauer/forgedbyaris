// Shared by Netlify edge functions. Plan rules themselves live in
// netlify/functions/_Lib/plans.js and are applied by membership-check.
// This module only forwards the Memberstack bearer token (header or
// forge_ms cookie) and reads the flags that function returns.
//
// Tests may set globalThis.__forgeTestMembership to skip the network.
// A request cannot set that. Production always calls membership-check.

export function tokenFromRequest(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (match && match[1] && match[1] !== 'null') return match[1].trim();
  const cookie = request.headers.get('cookie') || '';
  const part = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('forge_ms='));
  if (!part) return '';
  try { return decodeURIComponent(part.slice('forge_ms='.length)); }
  catch (e) { return ''; }
}

export async function requireEdgeMembership(request, options) {
  const opts = options || {};
  if (typeof globalThis.__forgeTestMembership === 'function') {
    return globalThis.__forgeTestMembership(request, opts);
  }

  const token = tokenFromRequest(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing or malformed Authorization header' };
  }
  const origin = opts.origin || '';
  if (!origin) {
    return { ok: false, status: 503, error: 'Membership gate is not configured' };
  }

  let res;
  try {
    res = await fetch(origin.replace(/\/$/, '') + '/.netlify/functions/membership-check', {
      headers: { Authorization: 'Bearer ' + token },
    });
  } catch (e) {
    return { ok: false, status: 503, error: 'Membership gate unavailable' };
  }

  let body = {};
  try { body = await res.json(); } catch (e) { body = {}; }

  if (!res.ok || !body.active) {
    const status = res.status === 401 || res.status === 503 ? res.status : 403;
    return {
      ok: false,
      status,
      error: body.error || 'Active membership required',
      active: false,
      empire: false,
    };
  }
  if (opts.need === 'empire' && !body.empire) {
    return { ok: false, status: 403, error: 'Empire membership required', active: true, empire: false, memberId: body.memberId };
  }
  return {
    ok: true,
    status: 200,
    memberId: body.memberId,
    active: true,
    empire: !!body.empire,
    comps: !!body.comps,
  };
}

export const EMPIRE_SCENARIO_TITLE = 'Pitching a Commercial Loan Officer on a 5+ Unit Acquisition';
