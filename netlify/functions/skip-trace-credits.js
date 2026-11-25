// Current Netlify function format so the Stripe secret is available.
import { createRequire } from 'module';
import { createHandler } from './_Lib/skip-trace-credits-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';

const require = createRequire(import.meta.url);
const { supabase } = require('./_Lib/supabase-client');
const { createSupabaseStore } = require('./_Lib/skip-trace-store');

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
  getStore: () => createSupabaseStore(supabase),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/skip-trace-credits' };
