// Current Netlify function format, not the Lambda-compatible exports.handler.
// Variables marked "Contains secret values" are not injected into that Lambda
// environment, so MARKETING_STRIPE_SECRET_KEY was empty there even when set.
import { createHandler } from './_Lib/marketing-wallet-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/marketing-wallet' };
