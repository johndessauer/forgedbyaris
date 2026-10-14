// netlify/functions/_Lib/plans.js
//
// Server-side plan list — the one copy functions should use. The same IDs
// are duplicated client-side across ~13 pages (see property-search.html
// ~line 633); this file mirrors those values as of Oct 12, 2026 and is the
// place to change them for server checks. Moving the pages onto a shared
// client file (forge-access.js) is a separate, queued piece of work.
//
// Plan connections come from @memberstack/admin members.retrieve(). Each is
// { planId, status, payment: { priceId } }. Status is compared uppercase.
// UNVERIFIED: that the admin API returns status as ACTIVE/TRIALING exactly
// like the DOM package does — confirm on the first live call (Phase 5).

const PLAN_IDS = Object.freeze({
  FORGE_ZERO: 'pln_forge-zero-psnx0aea',               // free staff plan
  EMPIRE: 'pln_empire--871c00ah3',
  FOUNDATION_EMPIRE: 'pln_foundation-empire-eh1bv0h3e', // incl. $1,797 bundle and partner $250/$125 prices
  FOUNDATION: 'pln_foundation--s11cv0hs9',               // Foundation only — no Empire
  FOUNDATION_180: 'pln_foundation-180-month-payment-plan--gy4q09u4', // Foundation $180/mo x12 payment plan — no Empire
  FOUNDING_MEMBER: 'pln_founding-member-a1p70rff',
  FOUNDING_MEMBER_VIP: 'pln_founding-member-vip--mzs707z3',
  FORTIVA_1997: 'pln_fortiva-foundation-1997-xt5g037j',  // Foundation only — no Empire
  FORTIVA_1497: 'pln_fortiva-foundation-1497-3k4v0yug',  // Foundation only — no Empire
  BETA_97: 'pln_-97-direct--jx9b09ut',
});

// Price IDs the pages treat as Founding Member (Empire included). Note that
// prc_-97-direct (Beta $97) is in this list on the pages today, so Beta
// members have Empire access under the current client rules.
const FOUNDING_MEMBER_PRICE_IDS = Object.freeze([
  'prc_497-97-3m13d01j8',
  'prc_247-97-ne13e01d6',  // retired offer, kept for any legacy subscriber
  'prc_997-97-5fmt0nr5',   // retired in Stripe Sept 28, 2026, kept for legacy subscribers
  'prc_-97-direct-ka9b0lq3',
]);

const LIVE_STATUSES = new Set(['ACTIVE', 'TRIALING']);

function isLive(pc) {
  return !!pc && LIVE_STATUSES.has(String(pc.status || '').toUpperCase());
}

// Empire access exactly as property-search.html computes hasEmpireAccess.
function hasEmpireAccess(planConnections) {
  return (planConnections || []).some(pc => isLive(pc) && (
    pc.planId === PLAN_IDS.EMPIRE ||
    pc.planId === PLAN_IDS.FOUNDATION_EMPIRE ||
    pc.planId === PLAN_IDS.FORGE_ZERO ||
    FOUNDING_MEMBER_PRICE_IDS.includes(pc.payment && pc.payment.priceId) ||
    pc.planId === PLAN_IDS.FOUNDING_MEMBER ||
    pc.planId === PLAN_IDS.FOUNDING_MEMBER_VIP
  ));
}

// Comp lookups: Empire access, EXCLUDING FORGE Zero (John, Oct 12, 2026).
// A member who holds FORGE Zero and also a paid Empire-level plan still
// qualifies through the paid plan.
function hasCompsAccess(planConnections) {
  const paid = (planConnections || []).filter(pc => pc.planId !== PLAN_IDS.FORGE_ZERO);
  return hasEmpireAccess(paid);
}

module.exports = { PLAN_IDS, FOUNDING_MEMBER_PRICE_IDS, isLive, hasEmpireAccess, hasCompsAccess };
