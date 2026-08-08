// netlify/functions/video-library.js
//
// Member-facing API for the Video Library — separate from the 22-topic
// Education curriculum (education-data.js). Read-only for members;
// authoring happens through video-library-admin.js.
//
// Routes:
//   GET ?action=list&type=<lesson|recorded_call|all> -> published videos, newest first

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const VALID_TYPES = new Set(['lesson', 'recorded_call']);

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    await verifyMember(event);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list') {
        const type = (event.queryStringParameters || {}).type || 'all';
        if (type !== 'all' && !VALID_TYPES.has(type)) {
          return json(400, { error: 'type must be lesson, recorded_call, or all' });
        }

        let query = supabase
          .from('video_library')
          .select('id, title, description, youtube_id, video_type, recorded_date, order_index')
          .eq('published', true)
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: false });

        if (type !== 'all') query = query.eq('video_type', type);

        const { data, error } = await query;
        if (error) throw error;
        return json(200, { videos: data || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('video-library error:', err);
    return json(500, { error: 'Server error' });
  }
};
