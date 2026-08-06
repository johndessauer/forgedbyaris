// netlify/functions/education-admin.js
//
// Admin-only authoring API for Education Modules. Every route is gated by
// a server-side email allowlist check — never trust a client claim of
// "I'm an admin." The allowlist is checked against the member's real email
// on file with Memberstack, looked up server-side from the verified token,
// not from anything the client sends.
//
// To add another admin later, add their email to ADMIN_EMAILS below and
// redeploy — there's no UI for managing this list, intentionally, since
// it should change rarely and a code change is an easy audit trail.
//
// Routes:
//   GET  ?action=list_all                          -> every module (published + draft)
//   GET  ?action=get&id=<uuid>                      -> one module + its quiz questions (including correct answers, for editing)
//   POST { action: 'create_module', ...fields }     -> insert a new module
//   POST { action: 'update_module', id, ...fields } -> update a module's fields
//   POST { action: 'delete_module', id }            -> delete a module (cascades to its quiz questions and any progress rows)
//   POST { action: 'toggle_publish', id, published } -> publish/unpublish
//   POST { action: 'save_quiz_questions', moduleId, questions: [...] } -> replaces the full quiz question set for a module

const memberstackAdmin = require('@memberstack/admin');
const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

// John's known FORGE-admin emails. Add here (and redeploy) to grant access
// to anyone else who should be able to author Education content.
const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];

async function requireAdmin(memberId) {
  const { data: member } = await memberstack.members.retrieve({ id: memberId });
  const email = (member?.auth?.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    throw new AuthError('Not authorized for Education admin', 403);
  }
  return email;
}

function slugify(title) {
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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
          .from('education_modules')
          .select('*')
          .order('category', { ascending: true })
          .order('order_index', { ascending: true });
        if (error) throw error;
        return json(200, { modules: data || [] });
      }

      if (action === 'get') {
        const id = (event.queryStringParameters || {}).id;
        if (!id) return json(400, { error: 'id is required' });

        const { data: mod, error: modError } = await supabase
          .from('education_modules')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (modError) throw modError;
        if (!mod) return json(404, { error: 'Module not found' });

        const { data: questions, error: qError } = await supabase
          .from('education_quiz_questions')
          .select('*')
          .eq('module_id', id)
          .order('order_index', { ascending: true });
        if (qError) throw qError;

        return json(200, { module: mod, questions: questions || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'create_module') {
        const { title, category, description, content, contentType, videoUrl, orderIndex } = payload;
        if (!title || !category) return json(400, { error: 'title and category are required' });

        let slug = slugify(title);
        // Guard against slug collisions on repeated/similar titles.
        const { data: existing } = await supabase.from('education_modules').select('slug').eq('slug', slug);
        if (existing && existing.length) slug = `${slug}-${Date.now().toString(36)}`;

        const { data, error } = await supabase
          .from('education_modules')
          .insert({
            title,
            slug,
            category,
            content_type: contentType || 'text',
            description: description || null,
            content: content || null,
            video_url: videoUrl || null,
            order_index: orderIndex || 0,
            published: false, // always created as a draft; publish is a separate explicit step
          })
          .select()
          .single();
        if (error) throw error;
        return json(200, { module: data });
      }

      if (payload.action === 'update_module') {
        const { id, title, category, description, content, contentType, videoUrl, orderIndex } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (category !== undefined) updates.category = category;
        if (description !== undefined) updates.description = description;
        if (content !== undefined) updates.content = content;
        if (contentType !== undefined) updates.content_type = contentType;
        if (videoUrl !== undefined) updates.video_url = videoUrl;
        if (orderIndex !== undefined) updates.order_index = orderIndex;

        const { data, error } = await supabase.from('education_modules').update(updates).eq('id', id).select().single();
        if (error) throw error;
        return json(200, { module: data });
      }

      if (payload.action === 'delete_module') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase.from('education_modules').delete().eq('id', id);
        if (error) throw error;
        return json(200, { deleted: true });
      }

      if (payload.action === 'toggle_publish') {
        const { id, published } = payload;
        if (!id || typeof published !== 'boolean') return json(400, { error: 'id and published (boolean) are required' });
        const { data, error } = await supabase
          .from('education_modules')
          .update({ published })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json(200, { module: data });
      }

      if (payload.action === 'save_quiz_questions') {
        const { moduleId, questions } = payload;
        if (!moduleId || !Array.isArray(questions)) {
          return json(400, { error: 'moduleId and questions array are required' });
        }
        for (const q of questions) {
          if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
            return json(400, { error: 'Each question needs question text and at least 2 options' });
          }
          if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
            return json(400, { error: 'Each question needs a valid correctIndex within its options' });
          }
        }

        // Simplest correct approach: replace the full set atomically rather
        // than diffing individual questions — quizzes are short (a handful
        // of questions), so this is cheap and avoids partial-update bugs.
        const { error: deleteError } = await supabase.from('education_quiz_questions').delete().eq('module_id', moduleId);
        if (deleteError) throw deleteError;

        if (questions.length) {
          const rows = questions.map((q, i) => ({
            module_id: moduleId,
            question: q.question,
            options: q.options,
            correct_index: q.correctIndex,
            explanation: q.explanation || null,
            order_index: i,
          }));
          const { error: insertError } = await supabase.from('education_quiz_questions').insert(rows);
          if (insertError) throw insertError;
        }

        return json(200, { saved: true, count: questions.length });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('education-admin error:', err);
    return json(500, { error: 'Server error' });
  }
};
