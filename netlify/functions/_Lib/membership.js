// netlify/functions/_Lib/membership.js
//
// Server-side plan gate. verifyMember() only proves who the caller is.
// This module loads that member from Memberstack (keyed by memberstack_id
// from the verified token, never from the request body) and applies the
// same ACTIVE/TRIALING plan rules the member pages used to enforce in the
// browser.
//
// Env (already used by CRM; no new vendor):
//   MEMBERSTACK_SECRET_KEY  required. Admin API key. Without it every
//                            gated function fails closed (401/403).
//   MEMBERSTACK_APP_ID       optional. Passed as the verifyToken audience
//                            by verify-member.js when set.
//
// The browser may still redirect for UX: login.html when signed out,
// billing.html when a signed-in plan is not ACTIVE or TRIALING, and
// signup.html when a signed-in member has no plan yet. It is not the
// source of truth: functions and the page edge gate call this before
// content is returned.

const { json } = require('./http');
const {
  hasActiveMembership,
  hasEmpireAccess,
  hasCompsAccess,
  hasNonLivePlan,
  isEmpireCategory,
  isEmpireAnalyzerTab,
  EMPIRE_SCENARIO_TITLE,
} = require('./plans');

class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

function accessFromMember(memberId, member) {
  const planConnections = (member && member.planConnections) || [];
  return {
    memberId,
    planConnections,
    active: hasActiveMembership(planConnections),
    empire: hasEmpireAccess(planConnections),
    comps: hasCompsAccess(planConnections),
  };
}

let memberstackClient = null;
function defaultGetMember(id) {
  if (!process.env.MEMBERSTACK_SECRET_KEY) {
    throw new AuthError('Membership verification is not configured', 503);
  }
  if (!memberstackClient) {
    memberstackClient = require('@memberstack/admin').init(process.env.MEMBERSTACK_SECRET_KEY);
  }
  return memberstackClient.members.retrieve({ id }).then(res => (res && res.data) || null);
}

/**
 * @param {object} event Netlify function event
 * @param {{ verifyMember?: Function, getMember?: Function, need?: 'member'|'empire'|'comps' }} [opts]
 * @returns {Promise<{memberId:string, active:boolean, empire:boolean, comps:boolean, planConnections:object[]}>}
 */
async function requireMembership(event, opts) {
  const options = opts || {};
  const verify = options.verifyMember || ((ev) => require('./verify-member').verifyMember(ev));
  const getMember = options.getMember || defaultGetMember;
  const need = options.need || 'member';

  let memberId;
  try {
    memberId = await verify(event);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const status = err && err.statusCode ? err.statusCode : 401;
    throw new AuthError((err && err.message) || 'Authentication failed', status);
  }
  if (!memberId) throw new AuthError('Authentication failed', 401);

  let member;
  try {
    member = await getMember(memberId);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Could not verify membership', 503);
  }

  const access = accessFromMember(memberId, member);
  if (!access.active) {
    const err = new AuthError('Active membership required', 403);
    // Tells the page gate to open billing instead of the signup form.
    // The ACTIVE/TRIALING rule above is unchanged.
    err.paymentIssue = hasNonLivePlan(access.planConnections);
    throw err;
  }
  if ((need === 'empire' || need === 'comps') && !access.empire) {
    throw new AuthError('Empire membership required', 403);
  }
  return access;
}

async function enforceMembership(event, opts) {
  try {
    return { access: await requireMembership(event, opts) };
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 401;
    const body = { error: (err && err.message) || 'Authentication failed' };
    if (status === 403) body.paymentIssue = !!(err && err.paymentIssue);
    return { response: json(status, body) };
  }
}

function empireLessonPayload(access) {
  const { EMPIRE_LESSONS } = require('./empire-lessons');
  if (access && access.empire) return EMPIRE_LESSONS;
  return EMPIRE_LESSONS.map(m => ({
    module: m.module,
    title: m.title,
    lessons: (m.lessons || []).map(l => ({ n: l.n, duration: l.duration, title: l.title })),
  }));
}

module.exports = {
  AuthError,
  accessFromMember,
  requireMembership,
  enforceMembership,
  empireLessonPayload,
  isEmpireCategory,
  isEmpireAnalyzerTab,
  EMPIRE_SCENARIO_TITLE,
};
