// Current Netlify function format so the webhook secret is available.
// Same import style as skip-trace-stripe-webhook.js. Do not use createRequire(import.meta.url).
import { createHandler } from './_Lib/aris-talk-pack-webhook-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';
import { supabase } from './_Lib/supabase-client.js';
import { creditPack } from './_Lib/aris-talk-usage.js';

const handler = createHandler({
  getStore: () => ({
    creditPack: (input) => creditPack(supabase, input),
  }),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/aris-talk-pack-webhook' };
