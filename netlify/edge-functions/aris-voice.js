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
const PRONUNCIATION_DICTIONARY_VERSION_ID = 'H5j6yzxGjOqVPWfU0ZT9';
const MODEL_ID = 'eleven_flash_v2_5'; // low-latency model for production playback

// Voice settings dialed in during the ElevenLabs Voice Design session —
// refined British RP, calm/precise/composed, subtle dry wit.
const VOICE_SETTINGS = {
  stability: 0.58,
  similarity_boost: 0.75,
  style: 0.18,
  use_speaker_boost: true,
  speed: 0.93,
};

const MAX_CHARS = 5000; // sane upper bound so a runaway request can't rack up huge TTS cost

// Strips markdown formatting ARIS's text responses use (bold, headers,
// bullets, links) so ElevenLabs doesn't read punctuation/symbols aloud
// literally. Mirrors what a human would say if reading the same text out
// loud — the visual formatting is dropped, the words remain.
function stripMarkdownForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, '') // code blocks — not useful spoken aloud
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

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

  const rawText = typeof body.text === 'string' ? body.text : '';
  if (!rawText.trim()) {
    return new Response(JSON.stringify({ error: 'text is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const speechText = stripMarkdownForSpeech(rawText).slice(0, MAX_CHARS);
  if (!speechText) {
    return new Response(JSON.stringify({ error: 'Nothing left to speak after stripping formatting' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  console.log(`aris-voice: request received, ${speechText.length} chars to speak`);

  const API_KEY = Netlify.env.get('ELEVENLABS_API_KEY');
  if (!API_KEY) {
    console.error('aris-voice: ELEVENLABS_API_KEY is not set');
    return new Response(JSON.stringify({ error: 'ElevenLabs API key not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  console.log(`aris-voice: key present, length=${API_KEY.length}, first4=${API_KEY.slice(0, 4)}`);

  let upstream;
  try {
    upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': API_KEY,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: speechText,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS,
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
