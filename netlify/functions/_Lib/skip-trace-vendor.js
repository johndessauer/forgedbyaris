// Server-only owner lookup client.
// The key and host stay in env. Member-facing text is built in skip-trace-http
// and never includes this module's host name or raw upstream errors.
const { readRuntimeEnv } = require('./runtime-env');

const DEFAULT_BASE = 'https://mock.tracerfy.com';

function baseUrl(env) {
  const configured = readRuntimeEnv(env, 'TRACERFY_BASE_URL');
  return (configured || DEFAULT_BASE).replace(/\/+$/, '');
}

function apiKey(env) {
  return readRuntimeEnv(env, 'TRACERFY_API_KEY');
}

function publicError(status) {
  if (status === 402) {
    return {
      statusCode: 402,
      code: 'vendor_unavailable',
      error: 'Owner contact lookup is temporarily unavailable. No credits were charged.',
    };
  }
  if (status === 429) {
    return {
      statusCode: 429,
      code: 'busy',
      error: 'Owner contact lookup is busy right now. Wait a minute and try again. No credits were charged.',
    };
  }
  if (status === 400) {
    return {
      statusCode: 400,
      code: 'bad_address',
      error: 'That address could not be looked up. Check the street, city, and state. No credits were charged.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      statusCode: 503,
      code: 'not_configured',
      error: 'Owner contact lookup is not configured.',
    };
  }
  return {
    statusCode: 503,
    code: 'unavailable',
    error: 'Owner contact lookup is temporarily unavailable. No credits were charged.',
  };
}

async function lookupOwner(options) {
  const env = options.env || process.env;
  const key = apiKey(env);
  if (!key) {
    return {
      ok: false,
      status: 503,
      publicError: {
        statusCode: 503,
        code: 'not_configured',
        error: 'Owner contact lookup is not configured.',
      },
    };
  }
  const payload = {
    address: options.street,
    city: options.city,
    state: options.state,
    find_owner: true,
  };
  if (options.zip) payload.zip = options.zip;
  if (options.firstName) payload.first_name = options.firstName;
  if (options.lastName) payload.last_name = options.lastName;

  const fetchImpl = options.fetch;
  let response;
  try {
    response = await fetchImpl(baseUrl(env) + '/v1/api/trace/lookup/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'User-Agent': 'FORGE/1.0',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: 502, publicError: publicError(503) };
  }
  let data = {};
  try { data = await response.json(); }
  catch (err) { data = {}; }
  if (!response.ok) {
    return { ok: false, status: response.status, publicError: publicError(response.status) };
  }
  return { ok: true, status: response.status, data: data };
}

module.exports = {
  DEFAULT_BASE,
  baseUrl,
  apiKey,
  publicError,
  lookupOwner,
};
