// netlify/functions/video-library-admin.js
//
// Admin-only authoring API for the Video Library. Same gating pattern as
// education-admin.js — a server-side email allowlist check against the
// member's real Memberstack email, never trusting a client claim.
//
// Routes:
//   GET  ?action=list_all                     -> every video (published + draft)
//   POST { action: 'create', ...fields }      -> insert a new video
//   POST { action: 'update', id, ...fields }  -> update a video's fields
//   POST { action: 'delete', id }             -> delete a video
//   POST { action: 'toggle_publish', id, published } -> publish/unpublish

const memberstackAdmin = require('@memberstack/admin');
const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

// Same admin allowlist as education-admin.js. Kept as a separate constant
// here (not imported) so this file has no dependency on education-admin.js
// ever changing — add an email in both places if granting a new admin.
const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];

const VALID_TYPES = new Set(['lesson', 'recorded_call']);

async function requireAdmin(memberId) {
  const { data: member } = await memberstack.members.retrieve({ id: memberId });
  const email = (member?.auth?.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    throw new AuthError('Not authorized for Video Library admin', 403);
  }
  return email;
}

// Accepts a bare video ID, a youtu.be short link, or a full youtube.com
// watch/embed URL and returns just the 11-character video ID. Returns
// null if nothing recognizable was found, so the caller can reject it
// with a clear error rather than silently saving a broken video.
function extractYoutubeId(input) {
  const raw = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let memberId;
  try {
    memberId = await verifyMember(event);
    await requireAdmin(memberId);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list_all') {
        const { data, error } = await supabase
          .from('video_library')
          .select('*')
          .order('video_type', { ascending: true })
          .order('order_index', { ascending: true });
        if (error) throw error;
        return json(200, { videos: data || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'create') {
        const { title, description, youtubeUrl, videoType, recordedDate, orderIndex } = payload;
        if (!title || !youtubeUrl || !videoType) {
          return json(400, { error: 'title, youtubeUrl, and videoType are required' });
        }
        if (!VALID_TYPES.has(videoType)) {
          return json(400, { error: `videoType must be one of: ${[...VALID_TYPES].join(', ')}` });
        }
        const youtubeId = extractYoutubeId(youtubeUrl);
        if (!youtubeId) {
          return json(400, { error: 'Could not recognize that as a YouTube link or video ID' });
        }

        const { data, error } = await supabase
          .from('video_library')
          .insert({
            title,
            description: description || null,
            youtube_id: youtubeId,
            video_type: videoType,
            recorded_date: recordedDate || null,
            order_index: orderIndex || 0,
            published: false, // always created as a draft; publish is a separate explicit step
          })
          .select()
          .single();
        if (error) throw error;
        return json(200, { video: data });
      }

      if (payload.action === 'update') {
        const { id, title, description, youtubeUrl, videoType, recordedDate, orderIndex } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (youtubeUrl !== undefined) {
          const youtubeId = extractYoutubeId(youtubeUrl);
          if (!youtubeId) return json(400, { error: 'Could not recognize that as a YouTube link or video ID' });
          updates.youtube_id = youtubeId;
        }
        if (videoType !== undefined) {
          if (!VALID_TYPES.has(videoType)) return json(400, { error: `videoType must be one of: ${[...VALID_TYPES].join(', ')}` });
          updates.video_type = videoType;
        }
        if (recordedDate !== undefined) updates.recorded_date = recordedDate || null;
        if (orderIndex !== undefined) updates.order_index = orderIndex;

        const { data, error } = await supabase.from('video_library').update(updates).eq('id', id).select().single();
        if (error) throw error;
        return json(200, { video: data });
      }

      if (payload.action === 'delete') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase.from('video_library').delete().eq('id', id);
        if (error) throw error;
        return json(200, { deleted: true });
      }

      if (payload.action === 'toggle_publish') {
        const { id, published } = payload;
        if (!id || typeof published !== 'boolean') return json(400, { error: 'id and published (boolean) are required' });
        const { data, error } = await supabase
          .from('video_library')
          .update({ published })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json(200, { video: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('video-library-admin error:', err);
    return json(500, { error: 'Server error' });
  }
};
