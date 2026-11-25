// Current Netlify function format so the Stripe secret is available.
// Same import style as marketing-wallet.js. Do not use createRequire(import.meta.url).
import { createHandler } from './_Lib/skip-trace-credits-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';
import { supabase } from './_Lib/supabase-client.js';
import { createSupabaseStore } from './_Lib/skip-trace-store.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
  getStore: () => createSupabaseStore(supabase),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/skip-trace-credits' };
