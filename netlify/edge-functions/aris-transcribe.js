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

import { requireEdgeMembership } from './lib/membership.js';
import { normalizeHeardName } from './lib/aris-heard-name.js';

// scribe_v2 accepts keyterms. scribe_v1 does not. iOS Safari records
// audio/mp4. If the keyterm request fails, retry scribe_v1 with no
// keyterms so a bad hint cannot blank the transcript. The name rewrite
// still runs on whatever text comes back.
const MODEL_ID = 'scribe_v2';
const FALLBACK_MODEL_ID = 'scribe_v1';
const KEYTERMS = ['ARIS'];
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // ~15MB — generous for a spoken practice turn, guards against abuse

export function clipExtension(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'mp4';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}

function formFor(audioBuffer, contentType, modelId, keyterms) {
  const form = new FormData();
  form.append('model_id', modelId);
  for (const term of keyterms || []) form.append('keyterms', term);
  const type = contentType || 'audio/webm';
  form.append('file', new Blob([audioBuffer], { type }), `clip.${clipExtension(type)}`);
  return form;
}

async function transcribeOnce(apiKey, audioBuffer, contentType, modelId, keyterms) {
  const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      Accept: 'application/json',
    },
    body: formFor(audioBuffer, contentType, modelId, keyterms),
  });
  const raw = await upstream.text();
  return { ok: upstream.ok, status: upstream.status, raw };
}

export default async (request, context) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  const access = await requireEdgeMembership(request, { origin: new URL(request.url).origin, need: 'member' });
  if (!access.ok) {
    return new Response(JSON.stringify({ error: access.error || 'Active membership required' }), {
      status: access.status || 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
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

  let result;
  try {
    result = await transcribeOnce(API_KEY, audioBuffer, contentType, MODEL_ID, KEYTERMS);
  } catch (err) {
    result = { ok: false, status: 0, raw: '' };
  }
  if (!result.ok) {
    console.error(`aris-transcribe: ${MODEL_ID} failed status=${result.status}; retrying ${FALLBACK_MODEL_ID} without keyterms`);
    try {
      result = await transcribeOnce(API_KEY, audioBuffer, contentType, FALLBACK_MODEL_ID, []);
    } catch (err) {
      console.error('aris-transcribe: failed to reach ElevenLabs:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to reach ElevenLabs' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }
  if (!result.ok) {
    console.error(`aris-transcribe: ${FALLBACK_MODEL_ID} returned ${result.status}`);
    return new Response(result.raw || JSON.stringify({ error: 'Transcription failed' }), {
      status: result.status || 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const raw = result.raw;

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
  const cleaned = rawText.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
  const text = normalizeHeardName(cleaned);

  console.log(`aris-transcribe: transcribed ${audioBuffer.byteLength} bytes -> raw="${rawText.slice(0, 80)}" cleaned="${text.slice(0, 80)}"`);

  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};

export const config = {
  path: '/api/aris-transcribe',
};
