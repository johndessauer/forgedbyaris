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
  FOUNDATION_EMPIRE_MANUAL: 'pln_foundation-empire-manual--ztoj0c72', // free manual plan (split-pay/manual deals) — same access as FOUNDATION_EMPIRE
  FOUNDATION: 'pln_foundation--s11cv0hs9',               // Foundation only — no Empire
  FOUNDATION_180: 'pln_foundation-180-month-payment-plan--gy4q09u4', // Foundation $180/mo x12 payment plan — no Empire
  FOUNDING_MEMBER: 'pln_founding-member-a1p70rff',
  FOUNDING_MEMBER_VIP: 'pln_founding-member-vip--mzs707z3',
  FORTIVA_1997: 'pln_fortiva-foundation-1997-xt5g037j',  // Foundation only — no Empire
  FORTIVA_1497: 'pln_fortiva-foundation-1497-3k4v0yug',  // Foundation only — no Empire
  BETA_97: 'pln_-97-direct--jx9b09ut',
  FWN_LAUNCH: 'pln_forge-launch-fwn--md00xzj',       // FWN — same access as Founding Member, including Empire
  FWN_ACCELERATOR: 'pln_forge-accelerator-fwn--dz20xmt',
  FWN_997: 'pln_forge-fwn-997-9x30xu2',
  FWN_1797: 'pln_forge-fwn-1-797-es40xk6',
  WEBINAR_997: 'pln_forge-webinar-997-lw00b81',       // FORGE webinar — same access as FWN 997, including Empire. Not an FWN plan.
  WEBINAR_1797: 'pln_forge-webinar-1-797-uf10b07',
  WEBINAR_997_FOUNDATION: 'pln_forge-webinar-997-foundation-ry00fq6', // FORGE webinar $997 Foundation — Foundation only, no Empire
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

// A plan connection that exists but is not ACTIVE or TRIALING: the card
// failed (REQUIRES_PAYMENT), the invoice is past due, or the plan ended.
// No connections at all is not this case — that member has not purchased,
// and the pages still send them to signup.html.
function hasNonLivePlan(planConnections) {
  return (planConnections || []).some(pc => !!pc && !isLive(pc));
}

// Empire access exactly as property-search.html computes hasEmpireAccess.
function hasEmpireAccess(planConnections) {
  return (planConnections || []).some(pc => isLive(pc) && (
    pc.planId === PLAN_IDS.EMPIRE ||
    pc.planId === PLAN_IDS.FOUNDATION_EMPIRE ||
    pc.planId === PLAN_IDS.FOUNDATION_EMPIRE_MANUAL ||
    pc.planId === PLAN_IDS.FORGE_ZERO ||
    FOUNDING_MEMBER_PRICE_IDS.includes(pc.payment && pc.payment.priceId) ||
    pc.planId === PLAN_IDS.FOUNDING_MEMBER ||
    pc.planId === PLAN_IDS.FOUNDING_MEMBER_VIP ||
    pc.planId === PLAN_IDS.FWN_LAUNCH ||
    pc.planId === PLAN_IDS.FWN_ACCELERATOR ||
    pc.planId === PLAN_IDS.FWN_997 ||
    pc.planId === PLAN_IDS.FWN_1797 ||
    pc.planId === PLAN_IDS.WEBINAR_997 ||
    pc.planId === PLAN_IDS.WEBINAR_1797
  ));
}

// Comp lookups: same as Empire access, which includes Beta $97 and
// FORGE Zero (John, Oct 23, 2026 — reverses the Oct 12 Zero exclusion).
// Foundation-only plans still do not get comps.
function hasCompsAccess(planConnections) {
  return hasEmpireAccess(planConnections);
}

// Base member access, matching the browser hasActiveMembership check on
// Education, Property Search, CRM, calculators, ARIS, and the other member
// pages (Oct 2026). ACTIVE or TRIALING only. Empire-by-itself is not enough
// and still does not count as base access. Do not add plans here that the
// pages do not already allow. A signed-in member who fails this check
// because a plan is not ACTIVE or TRIALING is sent to billing.html.
// Someone with no plan is still sent to signup.html.
const MEMBER_PLAN_IDS = new Set([
  PLAN_IDS.FORGE_ZERO,
  PLAN_IDS.FOUNDATION,
  PLAN_IDS.FOUNDATION_180,
  PLAN_IDS.FOUNDATION_EMPIRE,
  PLAN_IDS.FOUNDATION_EMPIRE_MANUAL,
  PLAN_IDS.FOUNDING_MEMBER,
  PLAN_IDS.FOUNDING_MEMBER_VIP,
  PLAN_IDS.FORTIVA_1997,
  PLAN_IDS.FORTIVA_1497,
  PLAN_IDS.FWN_LAUNCH,
  PLAN_IDS.FWN_ACCELERATOR,
  PLAN_IDS.FWN_997,
  PLAN_IDS.FWN_1797,
  PLAN_IDS.WEBINAR_997,
  PLAN_IDS.WEBINAR_1797,
  PLAN_IDS.WEBINAR_997_FOUNDATION,
]);

function hasActiveMembership(planConnections) {
  return (planConnections || []).some(pc => isLive(pc) && (
    MEMBER_PLAN_IDS.has(pc.planId) ||
    FOUNDING_MEMBER_PRICE_IDS.includes(pc.payment && pc.payment.priceId)
  ));
}

// Education categories the pages lock behind Empire. Match education.html.
const EMPIRE_CATEGORIES = Object.freeze([
  'Build-to-Rent',
  'Hotels & Hospitality',
  'Mixed-Use',
  'Mobile Home Parks',
  'Multifamily 5+',
  'New Construction',
  'Office & Industrial',
  'Self-Storage',
  'Syndication',
]);

function isEmpireCategory(category) {
  const name = String(category || '').toLowerCase();
  return EMPIRE_CATEGORIES.some(c => c.toLowerCase() === name);
}

// Real Estate Lab scenario the page locks behind Empire.
const EMPIRE_SCENARIO_TITLE = 'Pitching a Commercial Loan Officer on a 5+ Unit Acquisition';

// Deal Analyzer tabs inside the Commercial category. Residential tabs
// (wholesale, flip, rental, str, multi, and the residential view of
// lease-option, subject-to, and assumption) stay on Foundation.
const EMPIRE_ANALYZER_TABS = new Set(['commercial', 'storage', 'mhp', 'office', 'mixeduse', 'hotel']);

// Creative-finance tabs live on the residential bar. The commercial
// section inside each one is Empire-only. The tab name alone is not
// enough: the saved payload has to say propertyClass commercial.
const CREATIVE_FINANCE_TABS = new Set(['lease-option', 'subject-to', 'assumption']);

function isEmpireAnalyzerTab(tab) {
  return EMPIRE_ANALYZER_TABS.has(String(tab || '').toLowerCase());
}

function creativeFinancePropertyClass(dealData) {
  if (!dealData || typeof dealData !== 'object') return '';
  const nested = dealData.inputs && dealData.inputs.propertyClass;
  return String(dealData.propertyClass || nested || '').toLowerCase();
}

function isCreativeFinanceCommercial(tab, dealData) {
  const name = String(tab || '').toLowerCase();
  if (!CREATIVE_FINANCE_TABS.has(name)) return false;
  return creativeFinancePropertyClass(dealData) === 'commercial';
}

// True when this save or pipeline add needs Empire: a commercial-category
// tab, or a creative-finance tab whose payload is the commercial section.
function requiresEmpireAnalyzer(tab, dealData) {
  return isEmpireAnalyzerTab(tab) || isCreativeFinanceCommercial(tab, dealData);
}

module.exports = {
  PLAN_IDS,
  FOUNDING_MEMBER_PRICE_IDS,
  MEMBER_PLAN_IDS,
  EMPIRE_CATEGORIES,
  EMPIRE_SCENARIO_TITLE,
  EMPIRE_ANALYZER_TABS,
  isLive,
  hasNonLivePlan,
  hasEmpireAccess,
  hasCompsAccess,
  hasActiveMembership,
  isEmpireCategory,
  isEmpireAnalyzerTab,
  isCreativeFinanceCommercial,
  requiresEmpireAnalyzer,
  CREATIVE_FINANCE_TABS,
};
