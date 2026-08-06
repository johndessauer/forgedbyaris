// netlify/functions/education-data.js
//
// Member-facing Education Modules API: browse published modules, read one,
// submit a tier's quiz. Every member sees only published modules —
// unpublished drafts are only visible through education-admin.js's
// admin-gated routes.
//
// Tiers (rookie -> investor -> mogul) are now sequentially gated: a member
// must score 100% on a tier's quiz to unlock the next tier's quiz AND
// lesson content. This is enforced server-side in submit_quiz, not just
// hidden in the UI — a client can't skip ahead by calling the API directly.
//
// Routes:
//   GET  ?action=list                    -> published modules grouped by category, with this member's per-tier progress merged in
//   GET  ?action=get&id=<uuid>&tier=<rookie|investor|mogul> -> one module's full lesson content (all tiers, for reading)
//         + quiz questions for the REQUESTED tier only + this member's progress across all tiers for this module
//   POST { action: 'submit_quiz', moduleId, tier, answers: [indices] } -> grades that tier's quiz, saves progress,
//         returns score + per-question correctness + whether the next tier is now unlocked

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const TIER_ORDER = ['rookie', 'investor', 'mogul'];
const VALID_TIERS = new Set(TIER_ORDER);

function priorTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx > 0 ? TIER_ORDER[idx - 1] : null;
}

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
          .select('module_id, tier, passed, completed, quiz_score, quiz_total')
          .eq('memberstack_id', memberId);
        if (progError) throw progError;

        // Group progress by module, then by tier, so the card view can
        // eventually show per-tier status without another round trip.
        const progressByModule = {};
        for (const p of progress || []) {
          if (!progressByModule[p.module_id]) progressByModule[p.module_id] = {};
          progressByModule[p.module_id][p.tier] = p;
        }

        const enriched = (modules || []).map((m) => ({
          ...m,
          progress: progressByModule[m.id] || null,
        }));

        return json(200, { modules: enriched });
      }

      if (action === 'get') {
        const id = (event.queryStringParameters || {}).id;
        const tier = (event.queryStringParameters || {}).tier || 'rookie';
        if (!id) return json(400, { error: 'id is required' });
        if (!VALID_TIERS.has(tier)) return json(400, { error: 'Invalid tier' });

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
          .select('id, question, options, explanation, difficulty, order_index')
          .eq('module_id', id)
          .eq('difficulty', tier)
          .order('order_index', { ascending: true });
        if (qError) throw qError;
        // Deliberately NOT selecting correct_index here — the client
        // never receives correct answers before submitting, only after.

        const { data: progressRows, error: progError } = await supabase
          .from('education_progress')
          .select('*')
          .eq('memberstack_id', memberId)
          .eq('module_id', id);
        if (progError) throw progError;

        const progressByTier = {};
        for (const p of progressRows || []) progressByTier[p.tier] = p;

        return json(200, { module: mod, questions: questions || [], progressByTier });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'submit_quiz') {
        const { moduleId, tier, answers } = payload;
        if (!moduleId || !Array.isArray(answers)) {
          return json(400, { error: 'moduleId and answers array are required' });
        }
        const effectiveTier = tier || 'rookie';
        if (!VALID_TIERS.has(effectiveTier)) return json(400, { error: 'Invalid tier' });

        // Server-side gating enforcement — the real security boundary.
        // The UI hides locked tabs, but this check is what actually
        // prevents a member from calling the API directly to skip ahead.
        const prior = priorTier(effectiveTier);
        if (prior) {
          const { data: priorProgress, error: priorError } = await supabase
            .from('education_progress')
            .select('passed')
            .eq('memberstack_id', memberId)
            .eq('module_id', moduleId)
            .eq('tier', prior)
            .maybeSingle();
          if (priorError) throw priorError;
          if (!priorProgress || !priorProgress.passed) {
            return json(403, { error: `Complete the ${prior} quiz with a perfect score first to unlock ${effectiveTier}.` });
          }
        }

        const { data: questions, error: qError } = await supabase
          .from('education_quiz_questions')
          .select('id, correct_index, explanation')
          .eq('module_id', moduleId)
          .eq('difficulty', effectiveTier)
          .order('order_index', { ascending: true });
        if (qError) throw qError;
        if (!questions || !questions.length) return json(404, { error: 'No quiz found for this tier' });

        const results = questions.map((q, i) => ({
          questionId: q.id,
          correct: answers[i] === q.correct_index,
          correctIndex: q.correct_index,
          explanation: q.explanation || null,
        }));
        const score = results.filter((r) => r.correct).length;
        const total = questions.length;
        const passed = score === total;

        const { error: upsertError } = await supabase
          .from('education_progress')
          .upsert(
            {
              memberstack_id: memberId,
              module_id: moduleId,
              tier: effectiveTier,
              completed: true,
              passed,
              quiz_score: score,
              quiz_total: total,
              completed_at: new Date().toISOString(),
            },
            { onConflict: 'memberstack_id,module_id,tier' }
          );
        if (upsertError) throw upsertError;

        const nextTier = passed ? getNextTier(effectiveTier) : null;

        return json(200, { score, total, passed, results, unlockedNextTier: nextTier });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('education-data error:', err);
    return json(500, { error: 'Server error' });
  }
};

function getNextTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}
