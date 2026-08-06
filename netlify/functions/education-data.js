// netlify/functions/education-data.js
//
// Member-facing Education Modules API: browse published modules, read one,
// submit its quiz. Every member sees only published modules — unpublished
// drafts are only visible through education-admin.js's admin-gated routes.
//
// Routes:
//   GET  ?action=list                    -> published modules grouped by category, with this member's progress merged in
//   GET  ?action=get&id=<uuid>           -> one published module's full content + quiz questions (no correct_index leaked until submitted)
//   POST { action: 'submit_quiz', moduleId, answers: [indices] } -> grades the quiz, saves progress, returns score + per-question correctness

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

      if (action === 'list') {
        const { data: modules, error: modError } = await supabase
          .from('education_modules')
          .select('id, title, slug, category, content_type, description, order_index')
          .eq('published', true)
          .order('category', { ascending: true })
          .order('order_index', { ascending: true });
        if (modError) throw modError;

        const { data: progress, error: progError } = await supabase
          .from('education_progress')
          .select('module_id, completed, quiz_score, quiz_total')
          .eq('memberstack_id', memberId);
        if (progError) throw progError;

        const progressByModule = {};
        for (const p of progress || []) progressByModule[p.module_id] = p;

        const enriched = (modules || []).map((m) => ({
          ...m,
          progress: progressByModule[m.id] || null,
        }));

        return json(200, { modules: enriched });
      }

      if (action === 'get') {
        const id = (event.queryStringParameters || {}).id;
        if (!id) return json(400, { error: 'id is required' });

        const { data: mod, error: modError } = await supabase
          .from('education_modules')
          .select('*')
          .eq('id', id)
          .eq('published', true)
          .maybeSingle();
        if (modError) throw modError;
        if (!mod) return json(404, { error: 'Module not found' });

        const { data: questions, error: qError } = await supabase
          .from('education_quiz_questions')
          .select('id, question, options, explanation, order_index')
          .eq('module_id', id)
          .order('order_index', { ascending: true });
        if (qError) throw qError;
        // Deliberately NOT selecting correct_index here — the client
        // never receives correct answers before submitting, only after.

        const { data: progress } = await supabase
          .from('education_progress')
          .select('*')
          .eq('memberstack_id', memberId)
          .eq('module_id', id)
          .maybeSingle();

        return json(200, { module: mod, questions: questions || [], progress: progress || null });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'submit_quiz') {
        const { moduleId, answers } = payload;
        if (!moduleId || !Array.isArray(answers)) {
          return json(400, { error: 'moduleId and answers array are required' });
        }

        const { data: questions, error: qError } = await supabase
          .from('education_quiz_questions')
          .select('id, correct_index, explanation')
          .eq('module_id', moduleId)
          .order('order_index', { ascending: true });
        if (qError) throw qError;
        if (!questions || !questions.length) return json(404, { error: 'No quiz found for this module' });

        const results = questions.map((q, i) => ({
          questionId: q.id,
          correct: answers[i] === q.correct_index,
          correctIndex: q.correct_index,
          explanation: q.explanation || null,
        }));
        const score = results.filter((r) => r.correct).length;
        const total = questions.length;

        const { error: upsertError } = await supabase
          .from('education_progress')
          .upsert(
            {
              memberstack_id: memberId,
              module_id: moduleId,
              completed: true,
              quiz_score: score,
              quiz_total: total,
              completed_at: new Date().toISOString(),
            },
            { onConflict: 'memberstack_id,module_id' }
          );
        if (upsertError) throw upsertError;

        return json(200, { score, total, results });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('education-data error:', err);
    return json(500, { error: 'Server error' });
  }
};
