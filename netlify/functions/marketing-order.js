// Current Netlify function format so LOB_API_KEY, stored as a secret value,
// is available when a student confirms. Builds do not call this.
import { createHandler } from './_Lib/marketing-order-http.js';
import { fromRequest, toResponse } from './_Lib/function-adapter.js';

const handler = createHandler({
  fetch: (url, init) => fetch(url, init),
});

export default async (req) => toResponse(await handler(await fromRequest(req)));

export const config = { path: '/api/marketing-order' };
