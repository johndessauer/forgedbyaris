// netlify/functions/aris-inactive.js
//
// GET /api/aris-inactive?days=14  -> members who haven't used ARIS in N days (default 14).
//
// Auth, either of:
//   - header  x-admin-secret: <ARIS_ADMIN_SECRET env var>   (for scripts / bots)
//   - a FORGE admin's Memberstack Bearer token              (John's admin emails)
// Requires add-aris-usage-tracking.sql to have been run (member_stats.last_aris_at).
// Read-only. Emails are resolved from Memberstack; never trusted from the request.

const crypto = require('crypto');
const memberstackAdmin = require('@memberstack/admin');
const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);
const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];

function secretOk(event) {
  const expected = process.env.ARIS_ADMIN_SECRET || '';
  const got = (event.headers || {})['x-admin-secret'] || (event.headers || {})['X-Admin-Secret'] || '';
  if (!expected || !got || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

async function memberEmail(id) {
  try {
    const { data } = await memberstack.members.retrieve({ id });
    return data?.auth?.email || null;
  } catch (e) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  if (!secretOk(event)) {
    try {
      const memberId = await verifyMember(event);
      const email = ((await memberEmail(memberId)) || '').toLowerCase();
      if (!ADMIN_EMAILS.includes(email)) return json(403, { error: 'Not authorized' });
    } catch (err) {
      if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
      return json(401, { error: 'Authentication failed' });
    }
  }

  const days = Math.max(1, Math.min(365, parseInt((event.queryStringParameters || {}).days, 10) || 14));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  try {
    const { data, error } = await supabase
      .from('member_stats')
      .select('memberstack_id, last_aris_at, aris_sessions')
      .not('last_aris_at', 'is', null)
      .lt('last_aris_at', cutoff)
      .order('last_aris_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    const members = await Promise.all((data || []).map(async r => ({
      memberstackId: r.memberstack_id,
      email: await memberEmail(r.memberstack_id),
      lastArisAt: r.last_aris_at,
      daysInactive: Math.floor((Date.now() - Date.parse(r.last_aris_at)) / 86400000),
      arisSessions: r.aris_sessions || 0,
    })));
    return json(200, { days, count: members.length, members });
  } catch (err) {
    console.error('aris-inactive error:', err);
    return json(500, { error: 'Server error' });
  }
};
