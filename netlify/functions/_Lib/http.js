// netlify/functions/_lib/http.js
// Shared CORS headers and JSON response helpers, matching the pattern
// already used in aris-quote.js.

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function preflight() {
  return { statusCode: 200, headers: CORS_HEADERS, body: '' };
}

module.exports = { CORS_HEADERS, json, preflight };
