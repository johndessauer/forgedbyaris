// Current Netlify function format so secret env values are available.
// Import the CJS libs directly, the same way skip-trace.js does.
// Do not call createRequire on import.meta.url. Netlify bundles this file
// as CommonJS, and import.meta.url is undefined in that bundle.
import { createHandler } from './_Lib/loan-docs-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/loan-records' };
