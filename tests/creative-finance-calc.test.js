// node --test tests/creative-finance-calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/creative-finance-calc');

function close(actual, expected, tol) {
  const limit = tol == null ? 0.02 : tol;
  assert.ok(Number.isFinite(actual), 'expected a finite number, got ' + actual);
  assert.ok(Math.abs(actual - expected) < limit, actual + ' not within ' + limit + ' of ' + expected);
}

function flag(result, id) {
  const found = result.flags.find(f => f.id === id);
  assert.ok(found, 'missing flag ' + id + ' on ' + result.strategy + ' ' + result.propertyClass);
  return found;
}

const subtoBase = {
  marketValue: 250000,
  price: 200000,
  loanBalance: 180000,
  rate: 4,
  remainingTermYears: 27,
  monthlyTax: 200,
  monthlyInsurance: 100,
  arrears: 3000,
  escrowShortage: 500,
  cashToSeller: 20000,
  closingCosts: 4000,
  monthlyRent: 1800,
  vacancyPct: 5,
  monthlyOtherExpenses: 150,
  marketRate: 7,
  holdMonths: 60,
};

test('amortizing payment matches the standard 30-year 6 percent factor', () => {
  // $100,000, 6%, 30 years. Independent of the analyzer UI.
  close(C.monthlyPayment(100000, 6, 30), 599.5505251527569, 0.000001);
  close(C.monthlyPayment(100000, 0, 30), 100000 / 360, 0.000001);
  assert.equal(C.monthlyPayment(0, 6, 30), 0);
});

test('named default thresholds are the rental-analyzer lines', () => {
  assert.equal(C.THRESHOLDS.subjectTo.goMonthlyCashFlowAbove, 200);
  assert.equal(C.THRESHOLDS.subjectTo.goCashOnCashAbove, 8);
  assert.equal(C.THRESHOLDS.subjectTo.goDscrAtLeast, 1.25);
  assert.equal(C.THRESHOLDS.subjectTo.cautionDscrAtLeast, 1.0);
  assert.equal(C.THRESHOLDS.leaseOption.goMonthlySpreadAbove, 200);
  assert.equal(C.THRESHOLDS.leaseOption.goTermMonthsAtLeast, 12);
  assert.equal(C.THRESHOLDS.commercialLeaseOption.goMonthlySpreadAbove, 500);
  assert.equal(C.THRESHOLDS.assumption.goMonthlySavingsAbove, 0);
  assert.equal(C.DISCLAIMER, 'Education only, not legal advice.');
});

test('sandwich lease option spread, credits, back-end, and months to recover', () => {
  const r = C.calcLeaseOption({
    structure: 'sandwich',
    marketValue: 250000,
    optionFeePaid: 8000,
    optionFeeCollected: 2000,
    monthlyRentPaid: 1200,
    monthlyRentCollected: 1600,
    rentCredit: 200,
    yourStrike: 230000,
    tenantStrike: 260000,
    termMonths: 36,
    repairs: 0,
  });
  assert.equal(r.disclaimer, C.DISCLAIMER);
  assert.equal(r.monthlySpread, 400);
  assert.equal(r.spreadOverTerm, 14400);
  assert.equal(r.netOptionFee, -6000);
  assert.equal(r.totalRentCredit, 7200);
  assert.equal(r.effectivePrice, 252800);
  assert.equal(r.backEndSpread, 22800);
  assert.equal(r.cashIn, 8000);
  assert.equal(r.netCashIn, 6000);
  assert.equal(r.monthsToRecover, 15);
  close(r.cashOnCash, (400 * 12 / 6000) * 100);
  assert.equal(r.verdict, 'go');
  assert.equal(r.verdictText, 'GO');
});

test('rent credit above the spread blocks GO and a negative spread is NO-GO', () => {
  const richCredit = C.calcLeaseOption({
    structure: 'sandwich',
    marketValue: 250000,
    optionFeePaid: 5000,
    monthlyRentPaid: 1200,
    monthlyRentCollected: 1600,
    rentCredit: 500,
    yourStrike: 230000,
    tenantStrike: 260000,
    termMonths: 36,
  });
  assert.equal(richCredit.monthlySpread, 400);
  assert.equal(richCredit.verdict, 'caution');
  assert.equal(flag(richCredit, 'rent-credit-exceeds-spread').blocksGo, true);

  const negative = C.calcLeaseOption({
    structure: 'sandwich',
    marketValue: 250000,
    monthlyRentPaid: 1200,
    monthlyRentCollected: 1000,
    yourStrike: 200000,
    tenantStrike: 240000,
    termMonths: 24,
  });
  assert.equal(negative.monthlySpread, -200);
  assert.equal(negative.verdict, 'no-go');
  assert.equal(flag(negative, 'negative-spread').forcesNoGo, true);
});

test('percent rent credit and a threshold override change the lease-option verdict', () => {
  const input = {
    structure: 'sandwich',
    marketValue: 250000,
    monthlyRentPaid: 1000,
    monthlyRentCollected: 1500,
    rentCreditPct: 10,
    yourStrike: 200000,
    tenantStrike: 230000,
    termMonths: 24,
    optionFeePaid: 3000,
  };
  const r = C.calcLeaseOption(input);
  assert.equal(r.monthlySpread, 500);
  assert.equal(r.monthlyRentCredit, 150);
  assert.equal(r.verdict, 'go');

  const stricter = C.calcLeaseOption(input, { leaseOption: { goMonthlySpreadAbove: 800 } });
  assert.equal(stricter.verdict, 'caution');
  assert.equal(stricter.thresholds.goMonthlySpreadAbove, 800);
  assert.equal(C.THRESHOLDS.leaseOption.goMonthlySpreadAbove, 200);
});

test('straight lease option has no sandwich spread and a short term is caution', () => {
  const ok = C.calcLeaseOption({
    structure: 'straight',
    marketValue: 250000,
    yourStrike: 230000,
    optionFeePaid: 5000,
    rentCredit: 100,
    termMonths: 24,
    monthlyRentPaid: 1400,
  });
  assert.equal(ok.monthlySpread, 0);
  assert.equal(ok.effectivePrice, 230000 - 2400);
  assert.equal(ok.backEndSpread, null);
  assert.equal(ok.verdict, 'go');
  assert.equal(flag(ok, 'state-lease-option-rules').on, true);

  const short = C.calcLeaseOption({
    structure: 'straight',
    marketValue: 250000,
    yourStrike: 300000,
    optionFeePaid: 5000,
    termMonths: 6,
  });
  assert.equal(short.verdict, 'caution');
  assert.equal(flag(short, 'strike-above-value').on, true);
  assert.equal(flag(short, 'short-term').blocksGo, true);
});

test('commercial lease option spread versus cap value, consent flags stay on', () => {
  const r = C.calcCommercialLeaseOption({
    masterLeaseRentMonthly: 8000,
    subleaseIncomeMonthly: 10000,
    optionConsideration: 25000,
    exercisePrice: 1200000,
    annualNOI: 150000,
    exerciseCapRate: 7,
    termMonths: 60,
    leaseType: 'nnn',
    landlordConsentObtained: true,
  });
  assert.equal(r.monthlySpread, 2000);
  assert.equal(r.spreadOverTerm, 120000);
  close(r.valueAtCap, 150000 / 0.07);
  close(r.exerciseVersusValue, (150000 / 0.07) - 1200000);
  assert.equal(r.verdict, 'go');
  assert.equal(flag(r, 'landlord-consent').on, true);
  assert.equal(flag(r, 'snda').on, true);
  assert.equal(flag(r, 'estoppel').on, true);
  assert.equal(r.disclaimer, C.DISCLAIMER);

  const rich = C.calcCommercialLeaseOption({
    masterLeaseRentMonthly: 8000,
    subleaseIncomeMonthly: 10000,
    exercisePrice: 3000000,
    annualNOI: 150000,
    exerciseCapRate: 7,
    termMonths: 60,
  });
  assert.equal(rich.verdict, 'caution');
  assert.equal(flag(rich, 'exercise-above-value').blocksGo, true);

  const losing = C.calcCommercialLeaseOption({
    masterLeaseRentMonthly: 9000,
    annualNOI: 96000,
    termMonths: 36,
  });
  assert.equal(losing.monthlySpread, (96000 / 12) - 9000);
  assert.equal(losing.verdict, 'no-go');
});

test('subject-to PITI cash flow, cash to close, and equity versus equity paid for', () => {
  const r = C.calcSubjectTo(subtoBase);
  const pi = C.monthlyPayment(180000, 4, 27);
  const piti = pi + 300;
  close(r.monthlyPrincipalAndInterest, pi);
  close(r.monthlyPiti, piti);
  assert.equal(r.cashToClose, 27500);
  assert.equal(r.equity, 70000);
  assert.equal(r.equityPaidFor, 20000);
  assert.notEqual(r.equity, r.equityPaidFor);
  const effective = 1800 * 0.95;
  close(r.effectiveRent, effective);
  close(r.monthlyCashFlow, effective - piti - 150);
  close(r.dscr, effective / piti);
  close(r.cashOnCash, ((effective - piti - 150) * 12 / 27500) * 100);
  const marketPi = C.monthlyPayment(180000, 7, 27);
  close(r.marketPayment, marketPi + 300);
  close(r.monthlySavings, (marketPi + 300) - piti);
  close(r.savingsOverTerm, ((marketPi + 300) - piti) * 27 * 12);
  assert.equal(r.verdict, 'go');
  assert.ok(r.monthlyCashFlow > C.THRESHOLDS.subjectTo.goMonthlyCashFlowAbove);
});

test('explicit PITI is the payment when components are not split', () => {
  const r = C.calcSubjectTo({
    marketValue: 200000,
    price: 150000,
    loanBalance: 140000,
    rate: 3,
    remainingTermYears: 25,
    monthlyPiti: 1100,
    cashToSeller: 10000,
    monthlyRent: 1600,
    marketRate: 7,
  });
  assert.equal(r.monthlyPiti, 1100);
  const pi = C.monthlyPayment(140000, 3, 25);
  const ti = Math.max(0, 1100 - pi);
  close(r.marketPayment, C.monthlyPayment(140000, 7, 25) + ti);
  assert.equal(r.verdict, 'go');
});

test('due-on-sale stays on and a trust input cannot clear it', () => {
  const plain = C.calcSubjectTo(subtoBase);
  const hidden = C.calcSubjectTo(Object.assign({}, subtoBase, {
    usingTrust: true,
    dueOnSaleCleared: true,
    landTrust: true,
  }));
  for (const r of [plain, hidden]) {
    const due = flag(r, 'due-on-sale');
    assert.equal(due.on, true);
    assert.equal(due.blocksGo, false);
    assert.equal(due.forcesNoGo, false);
    assert.match(due.detail, /1701j-3/);
    assert.match(due.detail, /not a shield/i);
    assert.equal(flag(r, 'insurance').on, true);
    assert.equal(flag(r, 'servicing').on, true);
    assert.equal(r.verdict, 'go');
  }
});

test('subject-to arrears, negative equity, balloon, and a raised cash-flow line', () => {
  assert.equal(flag(C.calcSubjectTo(subtoBase), 'arrears').on, true);

  const upsideDown = C.calcSubjectTo(Object.assign({}, subtoBase, { marketValue: 150000 }));
  assert.equal(upsideDown.equity, 150000 - 180000);
  assert.equal(upsideDown.verdict, 'no-go');
  assert.equal(flag(upsideDown, 'negative-equity').forcesNoGo, true);

  const balloon = C.calcSubjectTo(Object.assign({}, subtoBase, { balloonMonths: 24 }));
  assert.equal(balloon.verdict, 'caution');
  assert.equal(flag(balloon, 'balloon-inside-hold').blocksGo, true);

  const thin = C.calcSubjectTo(Object.assign({}, subtoBase, {
    monthlyRent: 1400,
    vacancyPct: 0,
    monthlyOtherExpenses: 0,
  }));
  assert.ok(thin.monthlyCashFlow > 0);
  assert.ok(thin.monthlyCashFlow < 200);
  assert.equal(thin.verdict, 'caution');

  const moved = C.calcSubjectTo(subtoBase, { goMonthlyCashFlowAbove: 10000 });
  assert.equal(moved.verdict, 'caution');
  assert.equal(moved.thresholds.goMonthlyCashFlowAbove, 10000);
});

test('consumer-credit flag is only present when a new consumer loan is indicated', () => {
  assert.equal(C.calcSubjectTo(subtoBase).flags.some(f => f.id === 'consumer-credit'), false);
  assert.equal(flag(C.calcSubjectTo(Object.assign({}, subtoBase, { creatingConsumerLoan: true })), 'consumer-credit').on, true);
  assert.equal(flag(C.calcLeaseOption({
    structure: 'straight',
    marketValue: 200000,
    yourStrike: 180000,
    termMonths: 24,
    occupantIsEndBuyer: true,
  }), 'consumer-credit').on, true);
});

test('commercial subject-to cash flow, recourse, consent, and prepay blocking the savings claim', () => {
  const pi = C.monthlyPayment(800000, 4, 20);
  const cheap = C.calcCommercialSubjectTo({
    marketValue: 1200000,
    price: 1000000,
    loanBalance: 800000,
    rate: 4,
    remainingTermYears: 20,
    monthlyTax: 0,
    monthlyInsurance: 0,
    annualNOI: 120000,
    cashToSeller: 200000,
    closingCosts: 15000,
    marketRate: 7,
    recourse: 'full',
    lenderConsentObtained: true,
    prepayOrDefeasance: true,
    prepayPenalty: 50,
  });
  close(cheap.annualDebtService, pi * 12);
  close(cheap.annualCashFlow, 120000 - pi * 12);
  close(cheap.dscr, 120000 / (pi * 12));
  assert.equal(cheap.equity, 400000);
  assert.equal(cheap.equityPaidFor, 200000);
  assert.equal(cheap.cashToClose, 215000);
  assert.equal(cheap.verdict, 'go');
  assert.equal(flag(cheap, 'due-on-sale').on, true);
  assert.equal(flag(cheap, 'lender-consent').on, true);
  assert.equal(flag(cheap, 'recourse').recourse, 'full');
  assert.equal(cheap.savingsClaimBlocked, false);

  const penalty = C.calcCommercialSubjectTo({
    marketValue: 1200000,
    price: 1000000,
    loanBalance: 800000,
    rate: 4,
    remainingTermYears: 20,
    annualNOI: 120000,
    marketRate: 7,
    prepayOrDefeasance: true,
    prepayPenalty: 5000000,
    recourse: 'non-recourse',
  });
  assert.equal(penalty.savingsClaimBlocked, true);
  assert.equal(flag(penalty, 'prepay-or-defeasance').blocksSavingsClaim, true);
  assert.match(flag(penalty, 'recourse').detail, /carveouts/i);
  // Cash flow can still GO. The penalty blocks the savings story, not the DSCR verdict.
  assert.equal(penalty.verdict, 'go');
  assert.equal(flag(penalty, 'lender-consent').on, true);
});

test('assumption equity gap with an amortizing seller second and an interest-only seller second', () => {
  const base = {
    loanType: 'fha',
    marketValue: 270000,
    price: 260000,
    loanBalance: 200000,
    rate: 3.5,
    remainingTermYears: 28,
    monthlyTax: 150,
    monthlyInsurance: 80,
    marketRate: 7,
    assumptionFee: 1000,
    closingCosts: 3000,
    gapCash: 20000,
    monthlyRent: 2500,
    vacancyPct: 0,
    monthlyOtherExpenses: 100,
    sellerSecond: { amount: 40000, rate: 8, termYears: 10 },
  };
  const amort = C.calcAssumption(base);
  const io = C.calcAssumption(Object.assign({}, base, {
    sellerSecond: { amount: 40000, rate: 8, termYears: 10, interestOnly: true },
  }));
  const existing = C.monthlyPayment(200000, 3.5, 28) + 230;
  const amortSecond = C.monthlyPayment(40000, 8, 10);
  const ioSecond = 40000 * 0.08 / 12;
  close(amort.sellerSecondPayment, amortSecond);
  close(io.sellerSecondPayment, ioSecond);
  assert.equal(amort.sellerSecondInterestOnly, false);
  assert.equal(io.sellerSecondInterestOnly, true);
  close(amort.blendedPayment, existing + amortSecond);
  close(io.blendedPayment, existing + ioSecond);
  assert.ok(io.blendedPayment < amort.blendedPayment);
  assert.equal(amort.equityGap, 60000);
  assert.equal(amort.gapCash, 20000);
  assert.equal(amort.uncoveredGap, 0);
  assert.equal(amort.cashToClose, 24000);
  assert.equal(amort.equity, 70000);
  close(amort.monthlySavings, (C.monthlyPayment(200000, 7, 28) + 230) - existing);
  assert.ok(amort.monthlySavings > 0);
  close(amort.monthlyCashFlow, 2500 - (existing + amortSecond) - 100);
  assert.equal(amort.verdict, 'go');
  assert.equal(io.verdict, 'go');
  assert.equal(flag(amort, 'fha-assumable').on, true);
  assert.equal(flag(amort, 'lender-approval').on, true);
});

test('VA entitlement, FHA, USDA, and conventional assumability flags', () => {
  const common = {
    marketValue: 270000,
    price: 260000,
    loanBalance: 200000,
    rate: 3.5,
    remainingTermYears: 28,
    monthlyTax: 150,
    monthlyInsurance: 80,
    marketRate: 7,
    assumptionFee: 0,
    closingCosts: 2000,
    gapCash: 60000,
    monthlyRent: 2500,
    monthlyOtherExpenses: 100,
  };
  const vaBuyer = C.calcAssumption(Object.assign({}, common, { loanType: 'va' }));
  const vaVeteran = C.calcAssumption(Object.assign({}, common, {
    loanType: 'VA',
    veteranSubstitutingEntitlement: true,
  }));
  assert.equal(flag(vaBuyer, 'va-entitlement').on, true);
  assert.match(flag(vaBuyer, 'va-entitlement').detail, /non-veteran/i);
  assert.equal(flag(vaVeteran, 'va-entitlement').on, false);
  assert.match(flag(vaVeteran, 'va-entitlement').detail, /substitut/i);
  assert.equal(vaBuyer.verdict, 'go');
  assert.equal(vaBuyer.assumable, true);

  const fha = C.calcAssumption(Object.assign({}, common, { loanType: 'fha' }));
  const usda = C.calcAssumption(Object.assign({}, common, { loanType: 'usda' }));
  assert.equal(flag(fha, 'fha-assumable').on, true);
  assert.equal(flag(usda, 'usda-assumable').on, true);
  assert.equal(fha.verdict, 'go');
  assert.equal(usda.verdict, 'go');

  const conventional = C.calcAssumption(Object.assign({}, common, { loanType: 'conventional' }));
  assert.equal(conventional.assumable, false);
  assert.equal(conventional.verdict, 'no-go');
  assert.equal(flag(conventional, 'conventional-not-assumable').on, true);
  assert.equal(flag(conventional, 'conventional-not-assumable').forcesNoGo, true);

  const agreed = C.calcAssumption(Object.assign({}, common, {
    loanType: 'conventional',
    lenderAgreedInWriting: true,
  }));
  assert.equal(agreed.assumable, true);
  assert.equal(flag(agreed, 'conventional-not-assumable').on, false);
  assert.equal(agreed.verdict, 'go');
});

test('uncovered equity gap is NO-GO and negative savings cannot be a GO', () => {
  const uncovered = C.calcAssumption({
    loanType: 'va',
    price: 260000,
    loanBalance: 200000,
    rate: 3.5,
    remainingTermYears: 28,
    marketRate: 7,
    assumptionFee: 500,
    sellerSecond: { amount: 10000, rate: 8, termYears: 5 },
    gapCash: 0,
    monthlyRent: 2500,
  });
  assert.equal(uncovered.equityGap, 60000);
  assert.equal(uncovered.uncoveredGap, 50000);
  assert.equal(uncovered.verdict, 'no-go');
  assert.equal(flag(uncovered, 'gap-not-covered').forcesNoGo, true);

  const expensive = C.calcAssumption({
    loanType: 'fha',
    price: 200000,
    loanBalance: 200000,
    rate: 3.5,
    remainingTermYears: 28,
    marketRate: 2,
    assumptionFee: 0,
    monthlyRent: 2500,
    monthlyOtherExpenses: 100,
    monthlyTax: 150,
    monthlyInsurance: 80,
  });
  assert.ok(expensive.monthlySavings < 0);
  assert.ok(expensive.monthlyCashFlow > 0);
  assert.equal(expensive.verdict, 'caution');
  assert.equal(flag(expensive, 'savings-not-above-go').blocksGo, true);

  const noRent = C.calcAssumption({
    loanType: 'fha',
    price: 200000,
    loanBalance: 200000,
    rate: 3.5,
    remainingTermYears: 28,
    marketRate: 2,
    assumptionFee: 0,
  });
  assert.equal(noRent.verdict, 'no-go');
});

test('a missing assumption fee is a warning and an entered zero is not', () => {
  const common = {
    loanType: 'va',
    price: 220000,
    marketValue: 240000,
    loanBalance: 200000,
    rate: 3,
    remainingTermYears: 26,
    marketRate: 7,
    gapCash: 20000,
  };
  const missing = C.calcAssumption(common);
  const zero = C.calcAssumption(Object.assign({}, common, { assumptionFee: 0 }));
  assert.equal(flag(missing, 'assumption-fee-missing').on, true);
  assert.equal(zero.flags.some(f => f.id === 'assumption-fee-missing'), false);
  assert.equal(zero.assumptionFee, 0);
  assert.equal(missing.verdict, 'go');
  assert.equal(zero.verdict, 'go');
});

test('commercial assumption fees, recourse, CMBS and SBA flags, and a rate reset', () => {
  const balance = 2000000;
  const existing = C.monthlyPayment(balance, 5.5, 25);
  const agency = C.calcCommercialAssumption({
    loanType: 'agency',
    loanBalance: balance,
    price: 2500000,
    rate: 5.5,
    remainingTermYears: 25,
    annualNOI: 200000,
    assumptionFeePercent: 1,
    legalCosts: 15000,
    lenderCosts: 5000,
    gapCash: 500000,
    sellerReleasedFromRecourse: false,
  });
  close(agency.existingMonthlyPrincipalAndInterest, existing);
  close(agency.annualDebtService, existing * 12);
  close(agency.dscr, 200000 / (existing * 12));
  assert.equal(agency.totalAssumptionCost, 20000 + 15000 + 5000);
  assert.equal(agency.cashToClose, 500000 + 40000);
  assert.equal(agency.equityGap, 500000);
  assert.equal(agency.verdict, 'go');
  assert.equal(flag(agency, 'agency-assumption').on, true);
  assert.equal(flag(agency, 'recourse-release').on, true);
  assert.equal(flag(agency, 'lender-approval').on, true);

  const released = C.calcCommercialAssumption({
    loanType: 'bank',
    loanBalance: balance,
    price: 2500000,
    rate: 5.5,
    remainingTermYears: 25,
    annualNOI: 200000,
    assumptionFee: 10000,
    gapCash: 500000,
    sellerReleasedFromRecourse: true,
  });
  assert.equal(flag(released, 'recourse-release').on, false);
  assert.equal(flag(released, 'bank-assumption').on, true);

  const cmbs = C.calcCommercialAssumption({
    loanType: 'cmbs',
    loanBalance: balance,
    price: 2500000,
    rate: 5.5,
    remainingTermYears: 25,
    annualNOI: 200000,
    assumptionFeePercent: 1,
    gapCash: 500000,
    rateReset: true,
  });
  assert.equal(flag(cmbs, 'cmbs-assumption').on, true);
  assert.equal(flag(cmbs, 'rate-reset').blocksGo, true);
  assert.equal(cmbs.savingsClaimBlocked, true);
  assert.equal(cmbs.monthlySavings, null);
  assert.notEqual(cmbs.verdict, 'go');

  const sba = C.calcCommercialAssumption({
    loanType: 'sba-504',
    loanBalance: balance,
    price: 2500000,
    rate: 5.5,
    remainingTermYears: 25,
    annualNOI: 200000,
    gapCash: 500000,
  });
  assert.equal(flag(sba, 'sba-assumption').on, true);
  assert.match(flag(sba, 'sba-assumption').detail, /504/);

  const reset = C.monthlyPayment(balance, 7, 25);
  const resetDeal = C.calcCommercialAssumption({
    loanType: 'sba-7a',
    loanBalance: balance,
    price: 2500000,
    rate: 5.5,
    resetRate: 7,
    rateReset: true,
    remainingTermYears: 25,
    annualNOI: 200000,
    gapCash: 500000,
  });
  close(resetDeal.payingMonthlyPrincipalAndInterest, reset);
  close(resetDeal.dscr, 200000 / (reset * 12));
  assert.ok(resetDeal.dscr < 1.25);
  assert.ok(resetDeal.dscr >= 1);
  assert.ok(resetDeal.annualCashFlow > 0);
  assert.equal(resetDeal.verdict, 'caution');
  assert.ok(resetDeal.monthlySavings < 0);
});
