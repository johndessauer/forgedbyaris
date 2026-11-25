// Current Netlify function format so the webhook secret is available.
// Same import style as marketing-stripe-webhook.js. Do not use createRequire(import.meta.url).
import { createHandler } from './_Lib/skip-trace-webhook-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';
import { supabase } from './_Lib/supabase-client.js';
import { createSupabaseStore } from './_Lib/skip-trace-store.js';

const handler = createHandler({
  getStore: () => createSupabaseStore(supabase),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/skip-trace-stripe-webhook' };
