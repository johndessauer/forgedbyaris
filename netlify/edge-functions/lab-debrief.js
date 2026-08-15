// Real Estate Lab — debrief scoring — Netlify Edge Function (Deno runtime).
//
// Takes a completed roleplay transcript, scores it against the scenario's
// hidden objective (never sent to the client), and saves the session to
// lab_sessions. Built as an Edge Function rather than a classic Function
// for the same reason as lab-stream.js: analyzing a full transcript could
// plausibly run past the 26s classic-function wall on a longer session,
// and Edge Functions have no such ceiling. This one returns a single JSON
// response rather than a stream — Edge Functions aren't limited to
// streaming use cases, this just keeps the same safety margin.
//
// KNOWN GAP (same as aris-stream.js and lab-stream.js): no member auth
// check, protected only by CORS/URL obscurity — flagged for a future
// hardening pass across all three, not fixed here.

const DEBRIEF_SYSTEM_PROMPT = `You are ARIS, providing a structured debrief on a real estate negotiation roleplay a member just completed. You are NOT in character as the roleplay counterparty here — you are ARIS, the direct, no-fluff advisor, reviewing their performance.

You will be given the scenario's real objective (what the member was actually being evaluated against) and the full conversation transcript. Score their performance honestly — do not inflate the score to be encouraging. A member who rushed, missed obvious cues, or handled objections poorly should receive a genuinely lower score, with specific reasoning.

Respond with ONLY a raw JSON object in this exact shape, no other text before or after:
{
  "score": <integer 1-10>,
  "summary": "<2-3 sentence overall assessment, direct and specific>",
  "strengths": ["<specific strength tied to an actual moment in the transcript>", "..."],
  "areasToImprove": ["<specific, actionable improvement tied to an actual moment>", "..."],
  "keyMoment": "<one specific exchange from the transcript that mattered most, and why>"
}

Keep strengths and areasToImprove to 2-4 items each. Every point must reference something that actually happened in the transcript, not generic advice.`;

export default async (request, context) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const API_KEY = Netlify.env.get('ANTHROPIC_API_KEY');
  const SUPABASE_URL = Netlify.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { scenarioId, memberId, transcript } = body;
  if (!scenarioId || !memberId || !Array.isArray(transcript) || !transcript.length) {
    return new Response(JSON.stringify({ error: 'scenarioId, memberId, and a non-empty transcript array are required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Look up the scenario's hidden objective server-side — same pattern as
  // lab-stream.js's role_prompt lookup, never exposed to the client.
  let objective;
  try {
    const scenarioRes = await fetch(
      `${SUPABASE_URL}/rest/v1/lab_scenarios?id=eq.${scenarioId}&select=objective`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await scenarioRes.json();
    objective = rows?.[0]?.objective;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to look up scenario objective' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!objective) {
    return new Response(JSON.stringify({ error: 'Scenario not found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const transcriptText = transcript
    .map((m) => `${m.role === 'user' ? 'MEMBER' : 'COUNTERPARTY'}: ${m.content}`)
    .join('\n\n');

  const anthropicBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: DEBRIEF_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `SCENARIO OBJECTIVE (what the member was being evaluated against):\n${objective}\n\nFULL TRANSCRIPT:\n${transcriptText}\n\nProvide the debrief JSON now.`,
    }],
  };

  let debrief;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(errText, { status: upstream.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const result = await upstream.json();
    const rawText = result?.content?.find((b) => b.type === 'text')?.text || '';
    // Strip markdown code fences if Claude wrapped the JSON in them despite
    // the "raw JSON only" instruction — defensive, not assumed unnecessary.
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    debrief = JSON.parse(cleaned);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to generate or parse debrief', detail: err.message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Save the session — best-effort. A failure here shouldn't block the
  // member from seeing their debrief, so it's logged but not fatal.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lab_sessions`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        memberstack_id: memberId,
        scenario_id: scenarioId,
        transcript,
        score: debrief.score,
        feedback: debrief,
      }),
    });
  } catch (err) {
    console.error('Failed to save lab session:', err);
  }

  return new Response(JSON.stringify({ debrief }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};

export const config = {
  path: '/api/lab-debrief',
};
