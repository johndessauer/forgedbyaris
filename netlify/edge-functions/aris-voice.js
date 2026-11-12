// ARIS voice — Netlify Edge Function (Deno runtime).
//
// Converts a block of ARIS response text into spoken audio via ElevenLabs
// and streams the audio bytes straight back to the browser — same
// pass-through pattern as aris-stream.js, chosen for the same reason:
// Edge Functions bill on CPU time only, so this can hold the connection
// open for as long as ElevenLabs takes to generate without hitting the
// 26s wall-clock ceiling classic Netlify Functions have.
//
// This is v1: click-to-play on a finished ARIS message, not real-time
// voice conversation. Voice input / full duplex voice mode is a later,
// separate build on top of this foundation.

// Configuration — not secrets, safe to hardcode. Update here if the voice
// or pronunciation dictionary ever changes; only the API key is an env var.
const VOICE_ID = 'fpZxp1OFT98sOBCOCmuM';
const PRONUNCIATION_DICTIONARY_ID = 'xnEmPYZk1ReyZxXJB0I4';
const PRONUNCIATION_DICTIONARY_VERSION_ID = 'K4NSU6bIVNNrQHZl1PDT';
const MODEL_ID = 'eleven_flash_v2_5'; // low-latency model for production playback

// Voice settings dialed in during the ElevenLabs Voice Design session —
// refined British RP, calm/precise/composed, subtle dry wit. Only used
// for ARIS's own voice — a non-default voiceId (e.g. Real Estate Lab
// counterparties) uses ElevenLabs' stock defaults instead, since these
// settings were tuned specifically for ARIS's voice and don't transfer.
const ARIS_VOICE_SETTINGS = {
  stability: 0.58,
  similarity_boost: 0.75,
  style: 0.18,
  use_speaker_boost: true,
  speed: 0.99,
};

// ElevenLabs' standard defaults — used for any voiceId other than ARIS's own.
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  use_speaker_boost: true,
};

import { prepareSpeechText, SPEECH_CHAR_LIMIT } from './lib/speech-text.js';
import { requireEdgeMembership } from './lib/membership.js';

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

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const rawText = typeof body.text === 'string' ? body.text : '';
  if (!rawText.trim()) {
    return new Response(JSON.stringify({ error: 'text is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Optional override — used by Real Estate Lab so each counterparty can
  // speak in a different voice than ARIS. Falls back to ARIS's own voice
  // and tuning when omitted, so every existing caller (ARIS Coach, etc.)
  // is unaffected.
  const voiceId = typeof body.voiceId === 'string' && body.voiceId.trim() ? body.voiceId.trim() : VOICE_ID;
  const voiceSettings = voiceId === VOICE_ID ? ARIS_VOICE_SETTINGS : DEFAULT_VOICE_SETTINGS;

  // Full finished message, then a whitespace-safe cap. Speech text only —
  // the chat on screen is unchanged. $ becomes "dollars" so the British
  // RP voice does not read a US amount as pounds. £ / GBP stay pounds
  // and the digits are not converted. A postal abbreviation in a city,
  // address, or market is spoken as the state name ("Dallas, TX" → Texas).
  const speechText = prepareSpeechText(rawText, SPEECH_CHAR_LIMIT);
  if (!speechText) {
    return new Response(JSON.stringify({ error: 'Nothing left to speak after stripping formatting' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  console.log(`aris-voice: request received, ${speechText.length} chars to speak, voiceId=${voiceId}`);

  const API_KEY = Netlify.env.get('ELEVENLABS_API_KEY');
  if (!API_KEY) {
    console.error('aris-voice: ELEVENLABS_API_KEY is not set');
    return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let upstream;
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': API_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: speechText,
        model_id: MODEL_ID,
        voice_settings: voiceSettings,
        pronunciation_dictionary_locators: [
          {
            pronunciation_dictionary_id: PRONUNCIATION_DICTIONARY_ID,
            version_id: PRONUNCIATION_DICTIONARY_VERSION_ID,
          },
        ],
      }),
    });
  } catch (err) {
    console.error('aris-voice: failed to reach ElevenLabs:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to reach ElevenLabs', detail: err.message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text();
    console.error(`aris-voice: ElevenLabs returned ${upstream.status}: ${errText}`);
    return new Response(errText, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Pass the upstream audio stream straight through — no buffering.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
};

export const config = {
  path: '/api/aris-voice',
};
