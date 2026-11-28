// Current Netlify function format so the Stripe secret is available.
// Same import style as skip-trace-credits.js. Do not use createRequire(import.meta.url).
import { createHandler } from './_Lib/aris-talk-pack-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';
import { supabase } from './_Lib/supabase-client.js';
import { readUsage, mogulAward } from './_Lib/aris-talk-usage.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
  getStore: () => ({
    read: (memberId, monthKey) => readUsage(supabase, memberId, monthKey),
    mogulAward: (memberId) => mogulAward(supabase, memberId),
  }),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/aris-talk-pack' };
