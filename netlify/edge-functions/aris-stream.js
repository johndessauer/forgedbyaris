// ARIS streaming proxy — Netlify Edge Function (Deno runtime).
//
// Why this exists, not a copy of netlify/functions/aris-quote.js:
// Classic Netlify Functions (Node/Lambda-compatible) have a hard wall-clock
// execution limit (26s max on this plan) — if Claude takes longer than that
// to generate a full response, the function is killed and the client gets
// a timeout error with nothing to show. Edge Functions are billed on CPU
// time only (50ms), which excludes time spent waiting on a network call —
// so as long as this function starts streaming headers within ~40s, it can
// keep the connection open and stream tokens for as long as Claude takes.
// There is no hard ceiling on total generation time with this approach.
//
// This proxy does no transformation of the stream — it opens a streaming
// request to Anthropic and passes the raw SSE bytes straight through to
// the browser, which parses the same Anthropic streaming event format
// directly (see the content_block_delta handling in deal-analyzer.html).

export default async (request, context) => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const API_KEY = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const requestBody = {
    model: body.model || 'claude-sonnet-4-6',
    max_tokens: body.max_tokens || 2200,
    messages: body.messages,
    system: body.system,
    stream: true
  };

  // Pass through tool definitions if the caller included them. This proxy
  // does not execute tools itself or parse the stream for tool_use blocks —
  // the calling page is responsible for the full tool-use loop (detecting
  // tool_use in the raw SSE it receives, executing the tool, and sending a
  // follow-up request with the tool_result to continue the conversation).
  // This keeps the proxy's core behavior — and its CPU-time/streaming
  // guarantees — unchanged regardless of whether tools are in play.
  if (Array.isArray(body.tools) && body.tools.length) {
    requestBody.tools = body.tools;
  }
  if (body.tool_choice) {
    requestBody.tool_choice = body.tool_choice;
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to reach Anthropic API', detail: err.message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  if (!upstream.ok || !upstream.body) {
    // Anthropic returned a non-streaming error response (e.g. auth, rate limit, bad request)
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Pass the upstream SSE stream straight through — no buffering, no transformation
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
};

export const config = {
  path: '/api/aris-stream'
};
