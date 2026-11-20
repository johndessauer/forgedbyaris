// Who can see Marketing. Production stays on the admin allowlist.
// Deploy previews, branch deploys, and local dev open it for any member
// so the preview can be reviewed. CONTEXT unset fails closed.
const ADMIN_EMAILS = Object.freeze([
  'john@thedessauergroup.com',
  'jdessauer@antonagency.com',
]);

const PREVIEW_CONTEXTS = new Set(['deploy-preview', 'branch-deploy', 'dev', 'local']);

function emailList(value) {
  return String(value || '').split(/[,;\s]+/).map(function (part) {
    return part.trim().toLowerCase();
  }).filter(Boolean);
}

function memberEmail(member) {
  if (!member) return '';
  if (member.auth && member.auth.email) return String(member.auth.email).trim();
  if (member.email) return String(member.email).trim();
  return '';
}

function decideMarketingAccess(input) {
  const opts = input || {};
  const env = opts.env || {};
  const email = String(opts.email || '').trim().toLowerCase();
  const allow = new Set(ADMIN_EMAILS.map(function (item) { return item.toLowerCase(); }));
  emailList(env.MARKETING_ALLOWLIST).forEach(function (item) { allow.add(item); });
  const mode = String(env.MARKETING_FEATURE || '').trim().toLowerCase();
  const context = String(opts.context || env.CONTEXT || '').trim().toLowerCase();
  const onAllowlist = !!email && allow.has(email);
  const opened = mode === 'open' || mode === 'all';
  const preview = mode !== 'closed' && PREVIEW_CONTEXTS.has(context);
  const allowed = opened || onAllowlist || preview;
  let reason = 'flagged';
  if (opened) reason = 'open';
  else if (onAllowlist) reason = 'allowlist';
  else if (preview) reason = 'preview';
  return {
    allowed: allowed,
    reviewer: onAllowlist,
    empire: !!opts.empire,
    brandLimit: opts.empire ? 3 : 1,
    reason: allowed ? reason : 'flagged',
    context: context || 'unset',
  };
}

async function loadMarketingGate(event, deps) {
  const { json } = require('./http');
  const options = deps || {};
  const requireMembership = options.requireMembership || function (ev) {
    return require('./membership').requireMembership(ev);
  };
  const getMember = options.getMember || function (id) {
    if (!process.env.MEMBERSTACK_SECRET_KEY) {
      const err = new Error('Membership verification is not configured');
      err.statusCode = 503;
      throw err;
    }
    const client = require('@memberstack/admin').init(process.env.MEMBERSTACK_SECRET_KEY);
    return client.members.retrieve({ id }).then(function (res) { return (res && res.data) || null; });
  };

  let access;
  try {
    access = await requireMembership(event);
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 401;
    return { response: json(status, { error: err && err.message ? err.message : 'Authentication failed' }) };
  }

  let member = null;
  try {
    member = await getMember(access.memberId);
  } catch (err) {
    if (err && err.statusCode === 503) return { response: json(503, { error: err.message }) };
    return { response: json(503, { error: 'Could not verify this account.' }) };
  }

  const flag = decideMarketingAccess({
    email: memberEmail(member),
    empire: access.empire,
    env: options.env || process.env,
    context: options.context,
  });
  return { access: access, member: member, email: memberEmail(member), flag: flag };
}

module.exports = {
  ADMIN_EMAILS: ADMIN_EMAILS,
  PREVIEW_CONTEXTS: PREVIEW_CONTEXTS,
  memberEmail: memberEmail,
  decideMarketingAccess: decideMarketingAccess,
  loadMarketingGate: loadMarketingGate,
};
