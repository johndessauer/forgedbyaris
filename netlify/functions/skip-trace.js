// Current Netlify function format so secret env values are available.
// Import the CJS libs directly, the same way marketing-wallet.js does.
// createRequire(import.meta.url) throws after Netlify bundles this file as
// CommonJS, because import.meta.url is undefined in that bundle.
import { createHandler } from './_Lib/skip-trace-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';
import { supabase } from './_Lib/supabase-client.js';
import { createSupabaseStore } from './_Lib/skip-trace-store.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
  getStore: () => createSupabaseStore(supabase),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/skip-trace' };
