// netlify/functions/profile-data.js
//
// Get/save the Member Profile page data (avatar, Why answers, phone, preferences,
// calendar feed token).
// Every request must carry a valid Memberstack Bearer token.
// All reads/writes are scoped to the verified member ID — a client can
// never read or write another member's profile by supplying a different ID.
//
// Routes:
//   GET  ?action=get                                  -> fetch this member's profile row (creates an empty one if none exists,
//         and auto-generates a calendar_feed_token if the row exists but doesn't have one yet)
//   POST { action: 'save', ...fields }                -> upsert fields (avatarUrl, phone, whyQ1, whyQ2, whyQ3, preferences)
//   POST { action: 'upload_avatar', imageData, contentType } -> uploads a base64 image to the
//         'avatars' Storage bucket and saves the resulting public URL onto the profile row.
//         imageData must be a bare base64 string (no data: prefix — strip that client-side).

const crypto = require('crypto');
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
      let { data, error } = await supabase
        .from('member_profiles')
        .select('*')
        .eq('memberstack_id', memberId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // No row yet for this member — return empty shape rather than 404,
        // so the profile page can render its default state on first visit.
        return json(200, {
          profile: {
            memberstack_id: memberId,
            avatar_url: null,
            phone: null,
            why_q1: null,
            why_q2: null,
            why_q3: null,
            why_saved_at: null,
            preferences: {},
            calendar_feed_token: null,
          },
        });
      }

      // Auto-generate a calendar feed token the first time this member's
      // profile is read after the calendar-sync feature shipped, so the
      // profile page always has a token to build the subscribe link from
      // without needing a separate "generate" round trip.
      if (!data.calendar_feed_token) {
        const token = crypto.randomBytes(24).toString('hex');
        const { data: updated, error: tokenError } = await supabase
          .from('member_profiles')
          .update({ calendar_feed_token: token })
          .eq('memberstack_id', memberId)
          .select()
          .single();
        if (!tokenError && updated) data = updated;
      }

      return json(200, { profile: data });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { action } = payload;

      if (action === 'upload_avatar') {
        const { imageData, contentType } = payload;
        if (!imageData || !contentType) {
          return json(400, { error: 'imageData and contentType are required' });
        }
        if (!contentType.startsWith('image/')) {
          return json(400, { error: 'contentType must be an image type' });
        }

        const buffer = Buffer.from(imageData, 'base64');
        const MAX_BYTES = 4 * 1024 * 1024; // 4MB, matches the site's existing upload limit elsewhere
        if (buffer.length > MAX_BYTES) {
          return json(400, { error: 'Image too large (max 4MB)' });
        }

        const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
        const path = `${memberId}/avatar.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, buffer, { contentType, upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
        const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`; // cache-bust on re-upload

        const { data, error } = await supabase
          .from('member_profiles')
          .upsert({ memberstack_id: memberId, avatar_url: avatarUrl }, { onConflict: 'memberstack_id' })
          .select()
          .single();

        if (error) throw error;
        return json(200, { profile: data });
      }

      if (action === 'save') {
        const updates = { memberstack_id: memberId };

        if (payload.avatarUrl !== undefined) updates.avatar_url = payload.avatarUrl;
        if (payload.phone !== undefined) updates.phone = payload.phone;

        // Why answers are saved together, matching the existing dashboard
        // modal which submits q1/q2/q3 as one unit.
        if (payload.whyQ1 !== undefined || payload.whyQ2 !== undefined || payload.whyQ3 !== undefined) {
          updates.why_q1 = payload.whyQ1 ?? null;
          updates.why_q2 = payload.whyQ2 ?? null;
          updates.why_q3 = payload.whyQ3 ?? null;
          updates.why_saved_at = new Date().toISOString();
        }

        if (payload.preferences !== undefined) updates.preferences = payload.preferences;

        if (Object.keys(updates).length === 1) {
          return json(400, { error: 'No fields to update' });
        }

        const { data, error } = await supabase
          .from('member_profiles')
          .upsert(updates, { onConflict: 'memberstack_id' })
          .select()
          .single();

        if (error) throw error;
        return json(200, { profile: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('profile-data error:', err);
    return json(500, { error: 'Server error' });
  }
};
