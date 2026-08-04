// ARIS transcribe — Netlify Edge Function (Deno runtime).
//
// Speech-to-text for the "push-to-talk" voice input flow (Path A). A member
// records a short voice clip in the browser; this function forwards it to
// ElevenLabs' Scribe transcription model and returns the plain text
// transcript. The client then feeds that text into the exact same chat
// pipeline as if it had been typed — this function's only job is turning
// audio into text, nothing else.
//
// This is deliberately NOT the same thing as a live phone-call-style voice
// conversation (that's ElevenLabs' separate Conversational AI / WebSocket
// product, tracked separately for a later phase). This is turn-based:
// record, release, transcribe, respond.

const MODEL_ID = 'scribe_v1'; // general-purpose, reliable starting model per ElevenLabs' own guidance
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // ~15MB — generous for a spoken practice turn, guards against abuse

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

  const API_KEY = Netlify.env.get('ELEVENLABS_API_KEY');
  if (!API_KEY) {
    console.error('aris-transcribe: ELEVENLABS_API_KEY is not set');
    return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const contentType = request.headers.get('content-type') || 'audio/webm';
  let audioBuffer;
  try {
    audioBuffer = await request.arrayBuffer();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not read audio body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!audioBuffer || audioBuffer.byteLength === 0) {
    return new Response(JSON.stringify({ error: 'No audio received' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
    return new Response(JSON.stringify({ error: 'Audio clip too large' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ElevenLabs' /v1/speech-to-text endpoint expects a real multipart form
  // (file + model_id) — build one here rather than passing the raw audio
  // bytes straight through, since that's the format their API requires.
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('model_id', MODEL_ID);
  form.append('file', new Blob([audioBuffer], { type: contentType }), `clip.${ext}`);

  let upstream;
  try {
    upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        Accept: 'application/json',
      },
      body: form,
    });
  } catch (err) {
    console.error('aris-transcribe: failed to reach ElevenLabs:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to reach ElevenLabs', detail: err.message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    console.error(`aris-transcribe: ElevenLabs returned ${upstream.status}: ${raw}`);
    return new Response(raw, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('aris-transcribe: could not parse ElevenLabs response:', raw.slice(0, 300));
    return new Response(JSON.stringify({ error: 'Unexpected response from transcription service' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const rawText = (parsed.text || '').trim();
  // Scribe tags non-speech audio events in brackets — e.g. "[background
  // noise]", "[silence]", "[laughter]". Strip these out: a clip that's
  // ONLY tags has no real words and should read as "nothing was said,"
  // and a clip with real speech plus a stray tag should send the clean
  // words, not a message with a bracketed tag embedded in it.
  const text = rawText.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

  console.log(`aris-transcribe: transcribed ${audioBuffer.byteLength} bytes -> raw="${rawText.slice(0, 80)}" cleaned="${text.slice(0, 80)}"`);

  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};

export const config = {
  path: '/api/aris-transcribe',
};
