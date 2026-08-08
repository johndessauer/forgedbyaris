// netlify/functions/member-stats.js
//
// Small per-member stats that need to sync across devices. Currently just
// ARIS session count — Deals Saved and Member Since don't live here, since
// they're better sourced from data that already exists elsewhere (the real
// CRM, and Memberstack's own member.createdAt) rather than a new counter.
//
// Routes:
//   GET  ?action=get                 -> { arisSessions } for this member (0 if no row yet)
//   POST { action: 'increment_sessions' } -> increments and returns the new count

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let memberId;
  try {
    memberId = await verifyMember(event);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'get') {
        const { data, error } = await supabase
          .from('member_stats')
          .select('aris_sessions')
          .eq('memberstack_id', memberId)
          .maybeSingle();
        if (error) throw error;
        return json(200, { arisSessions: data?.aris_sessions || 0 });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'increment_sessions') {
        // Read-then-write rather than a single atomic increment — simple
        // and consistent with the rest of this codebase's style. A lost
        // increment from two simultaneous logins on the exact same
        // millisecond is an acceptable risk for a display-only vanity
        // metric, not something billing or access depends on.
        const { data: existing, error: readError } = await supabase
          .from('member_stats')
          .select('aris_sessions')
          .eq('memberstack_id', memberId)
          .maybeSingle();
        if (readError) throw readError;

        const nextCount = (existing?.aris_sessions || 0) + 1;

        const { error: upsertError } = await supabase
          .from('member_stats')
          .upsert({ memberstack_id: memberId, aris_sessions: nextCount }, { onConflict: 'memberstack_id' });
        if (upsertError) throw upsertError;

        return json(200, { arisSessions: nextCount });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('member-stats error:', err);
    return json(500, { error: 'Server error' });
  }
};
