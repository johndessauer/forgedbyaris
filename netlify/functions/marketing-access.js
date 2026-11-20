// GET /api/marketing-access
// { allowed, reviewer, empire, brandLimit, reason }
// Members who are not on the flag still get 200 with allowed:false so the
// page can keep the Coming soon card. Missing sessions get 401.
const { json, preflight } = require('./_Lib/http');
const { loadMarketingGate } = require('./_Lib/marketing-access');
const pricing = require('./_Lib/marketing-pricing');

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const gate = await loadMarketingGate(event, {
      requireMembership: options.requireMembership,
      getMember: options.getMember,
      env: options.env || process.env,
      context: options.context,
    });
    if (gate.response) return gate.response;
    return json(200, {
      allowed: gate.flag.allowed,
      reviewer: gate.flag.reviewer,
      empire: gate.flag.empire,
      brandLimit: gate.flag.brandLimit,
      reason: gate.flag.reason,
      menu: pricing.publicMenu(options.env || process.env),
    });
  };
}

exports.createHandler = createHandler;
let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
