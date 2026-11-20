// Current Netlify function format so MARKETING_STRIPE_WEBHOOK_SECRET, which
// is stored as a secret value, is available at runtime. The live checkout
// webhook is a different function and is not used here.
import { createHandler } from './_Lib/marketing-stripe-webhook-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';

const handler = createHandler({});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/marketing-stripe-webhook' };
