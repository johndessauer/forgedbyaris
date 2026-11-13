// assets/js/creative-finance-calc.js
//
// Pure math for three creative-finance strategies: Lease Option, Subject-To,
// and Loan Assumption. Residential and commercial. No DOM, no fetch, no network.
//
// Loaded later by the Deal Analyzer. This file does not change any page.
// Node tests require() it. The UMD wrapper matches assets/js/comp-engine.js.
//
// EDUCATION, NOT LEGAL ADVICE. Every result carries DISCLAIMER.
// The subject-to due-on-sale flag is always on. No input clears it.
// A land trust or title-holding trust does not clear it.
// Verdicts score the numbers. They do not clear a legal risk flag.
//
// Thresholds are the GO / CAUTION lines. Change THRESHOLDS (or pass an
// override object as the second argument) without touching the formulas.
// Names say the comparison: "Above" uses >, "AtLeast" uses >=.
// A rental GO matches the long-term rental analyzer's spirit: monthly cash
// flow above $200 and cash-on-cash above 8%.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForgeCreativeFinance = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DISCLAIMER = 'Education only, not legal advice.';

  const THRESHOLDS = Object.freeze({
    leaseOption: Object.freeze({
      // Sandwich GO when monthly spread (rent collected minus rent paid) is above this.
      goMonthlySpreadAbove: 200,
      // Spread at or above this, but not a GO, is CAUTION. Below it is NO-GO.
      cautionMonthlySpreadAtLeast: 0,
      goTermMonthsAtLeast: 12,
    }),
    commercialLeaseOption: Object.freeze({
      goMonthlySpreadAbove: 500,
      cautionMonthlySpreadAtLeast: 0,
      goTermMonthsAtLeast: 12,
    }),
    subjectTo: Object.freeze({
      goMonthlyCashFlowAbove: 200,
      cautionMonthlyCashFlowAbove: 0,
      goCashOnCashAbove: 8,
      goDscrAtLeast: 1.25,
      cautionDscrAtLeast: 1.0,
    }),
    commercialSubjectTo: Object.freeze({
      goAnnualCashFlowAbove: 0,
      cautionAnnualCashFlowAbove: 0,
      goDscrAtLeast: 1.25,
      cautionDscrAtLeast: 1.0,
    }),
    assumption: Object.freeze({
      // Savings must be above this or the verdict cannot be GO.
      goMonthlySavingsAbove: 0,
      goMonthlyCashFlowAbove: 200,
      cautionMonthlyCashFlowAbove: 0,
      goCashOnCashAbove: 8,
    }),
    commercialAssumption: Object.freeze({
      goAnnualCashFlowAbove: 0,
      cautionAnnualCashFlowAbove: 0,
      goDscrAtLeast: 1.25,
      cautionDscrAtLeast: 1.0,
    }),
  });

  function num(v) {
    if (v == null || v === '') return 0;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,%\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function has(v) {
    if (v == null || v === '') return false;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n);
  }

  // Same amortizing principal-and-interest formula as deal-analyzer.html calcMortgage.
  function monthlyPayment(principal, annualRatePct, termYears) {
    if (!principal || principal <= 0) return 0;
    if (!termYears || termYears <= 0) return 0;
    const r = (annualRatePct || 0) / 100 / 12;
    const n = termYears * 12;
    if (r === 0) return principal / n;
    const pow = Math.pow(1 + r, n);
    return principal * r * pow / (pow - 1);
  }

  function resolveThresholds(name, override) {
    if (!override) return Object.assign({}, THRESHOLDS[name]);
    if (override[name] && typeof override[name] === 'object') {
      return Object.assign({}, THRESHOLDS[name], override[name]);
    }
    // A partial slice: { goMonthlyCashFlowAbove: 10000 }
    const foreign = Object.keys(override).some(k => Object.prototype.hasOwnProperty.call(THRESHOLDS, k));
    if (foreign) return Object.assign({}, THRESHOLDS[name]);
    return Object.assign({}, THRESHOLDS[name], override);
  }

  function verdictText(verdict) {
    if (verdict === 'go') return 'GO';
    if (verdict === 'no-go') return 'NO-GO';
    return 'PROCEED WITH CAUTION';
  }

  function flag(id, extra) {
    return Object.assign({
      id: id,
      on: true,
      blocksGo: false,
      forcesNoGo: false,
    }, extra || {});
  }

  function cashOnCash(annualCashFlow, cashIn) {
    if (cashIn > 0) return (annualCashFlow / cashIn) * 100;
    // Nothing down and positive cash flow is an undefined (infinite) return.
    if (annualCashFlow > 0) return null;
    return 0;
  }

  function cocClears(coc, above) {
    if (coc == null) return true;
    return coc > above;
  }

  function envelope(strategy, propertyClass, thresholds, verdict, reasons, flags, metrics) {
    return Object.assign({
      strategy: strategy,
      propertyClass: propertyClass,
      disclaimer: DISCLAIMER,
      verdict: verdict,
      verdictText: verdictText(verdict),
      reasons: reasons,
      flags: flags,
      thresholds: thresholds,
    }, metrics);
  }

  function dueOnSaleFlag() {
    return flag('due-on-sale', {
      title: 'Due-on-sale',
      detail: 'The loan contract lets the lender accelerate if the property is transferred without prior written consent. An investor subject-to purchase is not an exemption under the Garn-St. Germain Act, 12 U.S.C. § 1701j-3(d). A land trust or title-holding trust is not a shield from that clause. This flag stays on. Education, not legal advice.',
    });
  }

  function insuranceFlag() {
    return flag('insurance', {
      title: 'Insurance',
      detail: 'The policy has to cover the owner who actually holds the property. A transfer the insurer does not know about can mean a denied claim or a force-placed policy. This flag stays on. Education, not legal advice.',
    });
  }

  function servicingFlag() {
    return flag('servicing', {
      title: 'Servicing',
      detail: 'The existing borrower is still on the note. Someone has to receive statements and keep the payment current. A miss hits the seller’s credit. This flag stays on. Education, not legal advice.',
    });
  }

  function rentCreditMonthly(input, structure) {
    const rentCollected = num(input.monthlyRentCollected);
    const rentPaid = num(input.monthlyRentPaid);
    if (has(input.rentCreditPct)) {
      const base = structure === 'sandwich' ? (rentCollected || rentPaid) : (rentPaid || rentCollected);
      return base * num(input.rentCreditPct) / 100;
    }
    return num(input.rentCredit);
  }

  function leaseStructure(input) {
    if (input.structure === 'straight' || input.structure === 'sandwich') return input.structure;
    if (has(input.tenantStrike) || has(input.monthlyRentCollected) || has(input.optionFeeCollected)) return 'sandwich';
    return 'straight';
  }

  // ── Lease option (residential) ───────────────────────────────────────────
  // Sandwich: you option from the seller and a tenant-buyer options from you.
  // Straight: you are the only option holder. Leave collected rent and collected
  // fee at zero, or set structure: 'straight'.

  function calcLeaseOption(input, override) {
    const src = input || {};
    const t = resolveThresholds('leaseOption', override);
    const structure = leaseStructure(src);
    const marketValue = num(src.marketValue);
    const feePaid = num(src.optionFeePaid);
    const feeCollected = structure === 'sandwich' ? num(src.optionFeeCollected) : 0;
    const rentPaid = num(src.monthlyRentPaid);
    const rentCollected = structure === 'sandwich' ? num(src.monthlyRentCollected) : 0;
    const termMonths = num(src.termMonths);
    const yourStrike = num(has(src.yourStrike) ? src.yourStrike : src.strikePrice);
    const tenantStrike = structure === 'sandwich'
      ? (has(src.tenantStrike) ? num(src.tenantStrike) : yourStrike)
      : yourStrike;
    const repairs = num(src.repairs);
    const creditsApply = src.rentCreditAppliesToPrice !== false;
    const monthlyCredit = rentCreditMonthly(src, structure);
    const monthlySpread = structure === 'sandwich' ? (rentCollected - rentPaid) : 0;
    const totalRentCredit = monthlyCredit * termMonths;
    const creditAgainstPrice = creditsApply ? totalRentCredit : 0;
    const effectivePrice = (structure === 'sandwich' ? tenantStrike : yourStrike) - creditAgainstPrice;
    const backEndSpread = structure === 'sandwich'
      ? (tenantStrike - yourStrike) - creditAgainstPrice
      : null;
    const cashIn = feePaid + repairs;
    const netCashIn = cashIn - feeCollected;
    const monthsToRecover = monthlySpread > 0 ? Math.max(0, netCashIn) / monthlySpread : (netCashIn <= 0 ? 0 : null);
    const annualSpread = monthlySpread * 12;

    const flags = [];
    if (structure === 'sandwich' && monthlySpread < t.cautionMonthlySpreadAtLeast) {
      flags.push(flag('negative-spread', {
        title: 'Negative spread',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Rent collected is below rent paid. The sandwich loses money every month.',
      }));
    }
    if (structure === 'sandwich' && monthlyCredit > monthlySpread) {
      flags.push(flag('rent-credit-exceeds-spread', {
        title: 'Rent credit exceeds spread',
        blocksGo: true,
        detail: 'The credit promised to the tenant-buyer is larger than the monthly spread. That credit is still owed at exercise.',
      }));
    }
    if (termMonths < t.goTermMonthsAtLeast) {
      flags.push(flag('short-term', {
        title: 'Term under the GO line',
        blocksGo: true,
        detail: 'Term is under ' + t.goTermMonthsAtLeast + ' months.',
      }));
    }
    if (marketValue > 0 && yourStrike > marketValue) {
      flags.push(flag('strike-above-value', {
        title: 'Strike above value',
        blocksGo: true,
        detail: 'The price you can buy at is above the value you entered.',
      }));
    }
    if (structure === 'sandwich' && backEndSpread != null && backEndSpread < 0) {
      flags.push(flag('negative-back-end', {
        title: 'Negative back-end spread',
        blocksGo: true,
        detail: 'After rent credits, the tenant-buyer’s price does not clear your strike.',
      }));
    }
    flags.push(flag('state-lease-option-rules', {
      title: 'State lease-option rules',
      detail: 'Check this state’s lease-option and equitable-mortgage rules before you take a fee. A lease with an option to purchase is not the three-year lease exemption in 12 U.S.C. § 1701j-3(d)(4). Education, not legal advice.',
    }));
    flags.push(flag('insurance', {
      title: 'Insurance',
      detail: 'Say who insures the property and who carries liability while the tenant-buyer is in possession. This flag stays on. Education, not legal advice.',
    }));
    if (src.occupantIsEndBuyer === true) {
      flags.push(flag('consumer-credit', {
        title: 'Consumer credit',
        detail: 'If the occupant is the end buyer, these terms can be a consumer loan. Have a lawyer review Dodd-Frank and the SAFE Act. Education, not legal advice.',
      }));
    }

    const reasons = [];
    let verdict = 'caution';
    if (flags.some(f => f.forcesNoGo)) {
      verdict = 'no-go';
      reasons.push('blocking-flag');
    } else if (structure === 'straight') {
      const termOk = termMonths >= t.goTermMonthsAtLeast;
      const strikeOk = !(marketValue > 0 && yourStrike > marketValue);
      if (termOk && strikeOk && yourStrike > 0) {
        verdict = 'go';
        reasons.push('straight-option-terms');
      } else {
        verdict = 'caution';
        reasons.push('straight-option-short-or-rich');
      }
    } else if (monthlySpread > t.goMonthlySpreadAbove
      && termMonths >= t.goTermMonthsAtLeast
      && monthlyCredit <= monthlySpread
      && !(marketValue > 0 && yourStrike > marketValue)
      && backEndSpread >= 0
      && !flags.some(f => f.blocksGo)) {
      verdict = 'go';
      reasons.push('spread-above-go');
    } else if (monthlySpread >= t.cautionMonthlySpreadAtLeast) {
      verdict = 'caution';
      reasons.push('spread-not-a-go');
    } else {
      verdict = 'no-go';
      reasons.push('spread-below-caution');
    }

    return envelope('lease-option', 'residential', t, verdict, reasons, flags, {
      structure: structure,
      monthlySpread: monthlySpread,
      spreadOverTerm: monthlySpread * termMonths,
      netOptionFee: feeCollected - feePaid,
      monthlyRentCredit: monthlyCredit,
      totalRentCredit: totalRentCredit,
      effectivePrice: effectivePrice,
      backEndSpread: backEndSpread,
      cashIn: cashIn,
      netCashIn: netCashIn,
      cashOnCash: structure === 'sandwich' ? cashOnCash(annualSpread, netCashIn) : cashOnCash(0, cashIn),
      monthsToRecover: monthsToRecover,
      yourStrike: yourStrike,
      tenantStrike: tenantStrike,
      marketValue: marketValue,
      termMonths: termMonths,
      closingCostsIfExercised: num(src.closingCosts),
    });
  }

  function calcCommercialLeaseOption(input, override) {
    const src = input || {};
    const t = resolveThresholds('commercialLeaseOption', override);
    const masterRent = num(src.masterLeaseRentMonthly);
    const monthlyIncome = has(src.subleaseIncomeMonthly)
      ? num(src.subleaseIncomeMonthly)
      : (has(src.annualNOI) ? num(src.annualNOI) / 12 : 0);
    const termMonths = num(src.termMonths);
    const monthlySpread = monthlyIncome - masterRent;
    const annualNoi = has(src.annualNOI) ? num(src.annualNOI) : monthlyIncome * 12;
    const cap = has(src.exerciseCapRate) ? num(src.exerciseCapRate) : (has(src.exitCapRate) ? num(src.exitCapRate) : 0);
    const valueAtCap = cap > 0 ? annualNoi / (cap / 100) : null;
    const exercisePrice = has(src.exercisePrice) ? num(src.exercisePrice) : null;
    const exerciseVersusValue = (valueAtCap != null && exercisePrice != null) ? (valueAtCap - exercisePrice) : null;
    const consideration = num(src.optionConsideration);

    const flags = [
      flag('landlord-consent', {
        title: 'Landlord consent',
        detail: 'A commercial lease option or master lease needs the landlord’s consent where the lease requires it. This flag stays on. Education, not legal advice.',
      }),
      flag('snda', {
        title: 'SNDA',
        detail: 'A subordination, non-disturbance, and attornment agreement is part of the commercial file when there is a lender. This flag stays on. Education, not legal advice.',
      }),
      flag('estoppel', {
        title: 'Estoppel',
        detail: 'Get an estoppel from the landlord or tenants before you rely on the rent. This flag stays on. Education, not legal advice.',
      }),
    ];
    if (monthlySpread < t.cautionMonthlySpreadAtLeast) {
      flags.push(flag('negative-spread', {
        title: 'Negative spread',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Income collected is below the master lease rent.',
      }));
    }
    if (termMonths < t.goTermMonthsAtLeast) {
      flags.push(flag('short-term', { title: 'Term under the GO line', blocksGo: true, detail: 'Term is under ' + t.goTermMonthsAtLeast + ' months.' }));
    }
    if (exerciseVersusValue != null && exerciseVersusValue < 0) {
      flags.push(flag('exercise-above-value', {
        title: 'Exercise price above cap value',
        blocksGo: true,
        detail: 'The exercise price is above the value at the cap rate you entered.',
      }));
    }

    const reasons = [];
    let verdict;
    if (flags.some(f => f.forcesNoGo) || monthlySpread < t.cautionMonthlySpreadAtLeast) {
      verdict = 'no-go';
      reasons.push('spread-below-caution');
    } else if (monthlySpread > t.goMonthlySpreadAbove
      && termMonths >= t.goTermMonthsAtLeast
      && !(exerciseVersusValue != null && exerciseVersusValue < 0)) {
      verdict = 'go';
      reasons.push('spread-above-go');
    } else {
      verdict = 'caution';
      reasons.push('spread-not-a-go');
    }

    return envelope('lease-option', 'commercial', t, verdict, reasons, flags, {
      monthlySpread: monthlySpread,
      spreadOverTerm: monthlySpread * termMonths,
      optionConsideration: consideration,
      masterLeaseRentMonthly: masterRent,
      monthlyIncome: monthlyIncome,
      annualNOI: annualNoi,
      valueAtCap: valueAtCap,
      exercisePrice: exercisePrice,
      exerciseVersusValue: exerciseVersusValue,
      termMonths: termMonths,
      leaseType: src.leaseType || null,
      cashIn: consideration,
    });
  }

  // ── Subject-to ───────────────────────────────────────────────────────────

  function paymentParts(input) {
    const balance = num(input.loanBalance);
    const rate = num(input.rate);
    const years = num(input.remainingTermYears);
    const piFromTerms = monthlyPayment(balance, rate, years);
    const tax = num(input.monthlyTax);
    const ins = num(input.monthlyInsurance);
    const hoa = num(input.monthlyHoa);
    const pi = has(input.monthlyPrincipalAndInterest) ? num(input.monthlyPrincipalAndInterest) : piFromTerms;
    const components = has(input.monthlyTax) || has(input.monthlyInsurance) || has(input.monthlyHoa);
    let piti;
    let ti;
    if (has(input.monthlyPiti)) {
      piti = num(input.monthlyPiti);
      ti = components ? (tax + ins + hoa) : Math.max(0, piti - pi);
    } else {
      ti = tax + ins + hoa;
      piti = pi + ti;
    }
    return { balance: balance, rate: rate, years: years, pi: pi, piti: piti, ti: ti, piFromTerms: piFromTerms };
  }

  function marketComparison(parts, marketRate) {
    if (!has(marketRate)) {
      return { marketRate: null, marketPrincipalAndInterest: null, marketPayment: null, monthlySavings: null, savingsOverTerm: null };
    }
    const rate = num(marketRate);
    const marketPi = monthlyPayment(parts.balance, rate, parts.years);
    const marketPayment = marketPi + parts.ti;
    const existing = parts.pi + parts.ti;
    const monthlySavings = marketPayment - existing;
    const months = parts.years > 0 ? parts.years * 12 : 0;
    return {
      marketRate: rate,
      marketPrincipalAndInterest: marketPi,
      marketPayment: marketPayment,
      existingComparablePayment: existing,
      monthlySavings: monthlySavings,
      savingsOverTerm: monthlySavings * months,
    };
  }

  function subjectToCommon(src) {
    const parts = paymentParts(src);
    const arrears = num(src.arrears);
    const escrowShortage = num(src.escrowShortage);
    const cashToSeller = num(src.cashToSeller);
    const closingCosts = num(src.closingCosts);
    const cashToClose = arrears + escrowShortage + cashToSeller + closingCosts;
    const value = num(src.marketValue != null ? src.marketValue : src.value);
    const price = num(src.price);
    const equity = value - parts.balance;
    const equityPaidFor = price - parts.balance;
    const comparison = marketComparison(parts, has(src.marketRate) ? src.marketRate : null);
    return {
      parts: parts,
      arrears: arrears,
      escrowShortage: escrowShortage,
      cashToSeller: cashToSeller,
      closingCosts: closingCosts,
      cashToClose: cashToClose,
      value: value,
      price: price,
      equity: equity,
      equityPaidFor: equityPaidFor,
      comparison: comparison,
    };
  }

  function standingSubjectToFlags(src, common) {
    const flags = [dueOnSaleFlag(), insuranceFlag(), servicingFlag()];
    if (common.arrears > 0) {
      flags.push(flag('arrears', {
        title: 'Arrears',
        detail: 'Reinstatement cash is in cash to close. The loan is not current until it is paid.',
      }));
    }
    if (common.equity < 0) {
      flags.push(flag('negative-equity', {
        title: 'Negative equity',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Value is below the loan balance.',
      }));
    }
    if (common.parts.balance <= 0) {
      flags.push(flag('missing-loan-balance', {
        title: 'Missing loan balance',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Subject-to needs the existing balance. There is nothing to take subject to.',
      }));
    }
    const holdMonths = has(src.holdMonths) ? num(src.holdMonths) : (common.parts.years > 0 ? common.parts.years * 12 : 0);
    if (has(src.balloonMonths) && num(src.balloonMonths) <= holdMonths) {
      flags.push(flag('balloon-inside-hold', {
        title: 'Balloon inside the hold',
        blocksGo: true,
        detail: 'The balloon date falls inside the hold period you entered. The balance comes due before you planned to be out.',
      }));
    }
    if (src.creatingConsumerLoan === true) {
      flags.push(flag('consumer-credit', {
        title: 'Consumer credit',
        detail: 'Creating a new loan to a consumer can bring Dodd-Frank and the SAFE Act into the file. Have a lawyer review it. Education, not legal advice.',
      }));
    }
    // Deliberate: usingTrust, dueOnSaleCleared, and similar inputs are ignored.
    return flags;
  }

  function calcSubjectTo(input, override) {
    const src = input || {};
    const t = resolveThresholds('subjectTo', override);
    const common = subjectToCommon(src);
    const grossRent = num(src.monthlyRent);
    const vacancyPct = has(src.vacancyPct) ? num(src.vacancyPct) : 0;
    const effectiveRent = grossRent * (1 - vacancyPct / 100);
    const other = num(src.monthlyOtherExpenses);
    const rentProvided = has(src.monthlyRent);
    const cashFlow = rentProvided ? (effectiveRent - common.parts.piti - other) : null;
    const annualCashFlow = cashFlow == null ? null : cashFlow * 12;
    const coc = cashFlow == null ? null : cashOnCash(annualCashFlow, common.cashToClose);
    const dscr = common.parts.piti > 0 && rentProvided ? (effectiveRent / common.parts.piti) : null;

    const flags = standingSubjectToFlags(src, common);
    if (rentProvided && common.parts.piti > effectiveRent) {
      flags.push(flag('piti-above-rent', {
        title: 'PITI above rent',
        blocksGo: true,
        detail: 'The existing PITI is higher than effective rent.',
      }));
    }
    if (common.comparison.monthlySavings != null && common.comparison.monthlySavings < 0) {
      flags.push(flag('payment-above-market', {
        title: 'Existing payment above a new market-rate loan',
        detail: 'A new amortizing loan at the market rate you entered would be cheaper on this balance. Savings are informational. They do not by themselves set the verdict.',
      }));
    }

    const reasons = [];
    let verdict;
    if (flags.some(f => f.forcesNoGo)) {
      verdict = 'no-go';
      reasons.push('blocking-flag');
    } else if (!rentProvided) {
      verdict = 'caution';
      reasons.push('rent-missing');
    } else if (cashFlow > t.goMonthlyCashFlowAbove
      && cocClears(coc, t.goCashOnCashAbove)
      && dscr != null && dscr >= t.goDscrAtLeast
      && !flags.some(f => f.blocksGo)) {
      verdict = 'go';
      reasons.push('cash-flow-above-go');
    } else if (cashFlow > t.cautionMonthlyCashFlowAbove && (dscr == null || dscr >= t.cautionDscrAtLeast)) {
      verdict = 'caution';
      reasons.push('cash-flow-not-a-go');
    } else {
      verdict = 'no-go';
      reasons.push('cash-flow-below-caution');
    }

    return envelope('subject-to', 'residential', t, verdict, reasons, flags, {
      monthlyPiti: common.parts.piti,
      monthlyPrincipalAndInterest: common.parts.pi,
      cashToClose: common.cashToClose,
      equity: common.equity,
      equityPaidFor: common.equityPaidFor,
      effectiveRent: effectiveRent,
      monthlyCashFlow: cashFlow,
      cashOnCash: coc,
      dscr: dscr,
      marketPayment: common.comparison.marketPayment,
      monthlySavings: common.comparison.monthlySavings,
      savingsOverTerm: common.comparison.savingsOverTerm,
      loanBalance: common.parts.balance,
      marketValue: common.value,
      price: common.price,
    });
  }

  function calcCommercialSubjectTo(input, override) {
    const src = input || {};
    const t = resolveThresholds('commercialSubjectTo', override);
    const common = subjectToCommon(src);
    const annualNoi = num(src.annualNOI);
    const annualDebt = common.parts.piti * 12;
    const annualCashFlow = annualNoi - annualDebt;
    const dscr = annualDebt > 0 ? annualNoi / annualDebt : null;
    const monthlySavings = common.comparison.monthlySavings;
    const savingsOverTerm = common.comparison.savingsOverTerm;

    const flags = standingSubjectToFlags(src, common);
    flags.push(flag('lender-consent', {
      title: 'Lender consent',
      detail: 'Commercial loan documents almost always require consent before a transfer. Taking the property subject-to without that consent is typically a default. This flag stays on. Education, not legal advice.',
    }));
    const recourse = src.recourse || 'unknown';
    flags.push(flag('recourse', {
      title: 'Recourse',
      recourse: recourse,
      detail: recourse === 'non-recourse'
        ? 'Marked non-recourse. Confirm the note and any carveouts. Consent is a separate question. Education, not legal advice.'
        : 'The original borrower may still be personally liable, including on carveouts. This flag stays on. Education, not legal advice.',
    }));
    let savingsClaimBlocked = false;
    if (src.prepayOrDefeasance === true) {
      const penalty = num(src.prepayPenalty);
      const comparable = savingsOverTerm == null ? null : savingsOverTerm;
      savingsClaimBlocked = comparable == null || penalty > comparable;
      flags.push(flag('prepay-or-defeasance', {
        title: 'Prepay or defeasance',
        blocksSavingsClaim: savingsClaimBlocked,
        detail: savingsClaimBlocked
          ? 'A payoff penalty is above the payment savings over the remaining term, or savings could not be measured. Do not sell this deal on the rate savings. Education, not legal advice.'
          : 'A prepay or defeasance provision is on the loan. The penalty you entered does not exceed measured payment savings. Confirm the number with the servicer. Education, not legal advice.',
      }));
    }

    const reasons = [];
    let verdict;
    if (flags.some(f => f.forcesNoGo)) {
      verdict = 'no-go';
      reasons.push('blocking-flag');
    } else if (annualCashFlow > t.goAnnualCashFlowAbove
      && dscr != null && dscr >= t.goDscrAtLeast
      && !flags.some(f => f.blocksGo)) {
      verdict = 'go';
      reasons.push('dscr-above-go');
    } else if (annualCashFlow > t.cautionAnnualCashFlowAbove && dscr != null && dscr >= t.cautionDscrAtLeast) {
      verdict = 'caution';
      reasons.push('dscr-not-a-go');
    } else {
      verdict = 'no-go';
      reasons.push('below-caution');
    }

    return envelope('subject-to', 'commercial', t, verdict, reasons, flags, {
      monthlyPiti: common.parts.piti,
      cashToClose: common.cashToClose,
      equity: common.equity,
      equityPaidFor: common.equityPaidFor,
      annualNOI: annualNoi,
      annualDebtService: annualDebt,
      annualCashFlow: annualCashFlow,
      dscr: dscr,
      monthlySavings: monthlySavings,
      savingsOverTerm: savingsOverTerm,
      savingsClaimBlocked: savingsClaimBlocked,
      recourse: recourse,
      loanBalance: common.parts.balance,
    });
  }

  // ── Assumption ───────────────────────────────────────────────────────────

  function sellerSecondPayment(second) {
    if (!second || !num(second.amount)) return { payment: 0, amount: 0, termsMissing: false };
    const amount = num(second.amount);
    const rate = num(second.rate);
    const years = num(second.termYears);
    if (second.interestOnly === true) {
      return { payment: amount * (rate / 100) / 12, amount: amount, termsMissing: false, interestOnly: true };
    }
    if (!(years > 0)) {
      return { payment: 0, amount: amount, termsMissing: true, interestOnly: false };
    }
    return { payment: monthlyPayment(amount, rate, years), amount: amount, termsMissing: false, interestOnly: false };
  }

  function equityGapFunding(src) {
    const price = num(src.price);
    const balance = num(src.loanBalance);
    const equityGap = price - balance;
    const second = sellerSecondPayment(src.sellerSecond);
    const otherFunds = num(src.otherGapFunds);
    const gapToFund = Math.max(0, equityGap);
    let gapCash;
    if (has(src.gapCash)) gapCash = num(src.gapCash);
    else gapCash = Math.max(0, gapToFund - second.amount - otherFunds);
    const coveredBy = gapCash + second.amount + otherFunds;
    const uncovered = gapToFund - coveredBy;
    return {
      price: price,
      balance: balance,
      equityGap: equityGap,
      gapToFund: gapToFund,
      gapCash: gapCash,
      second: second,
      otherFunds: otherFunds,
      uncovered: uncovered,
      gapCovered: uncovered <= 0.005,
    };
  }

  function residentialAssumability(src) {
    const type = String(src.loanType || '').toLowerCase();
    const agreed = src.lenderAgreedInWriting === true;
    const veteran = src.veteranSubstitutingEntitlement === true;
    const flags = [
      flag('lender-approval', {
        title: 'Lender or servicer approval',
        detail: 'Approval is required. It is not optional, and this flag stays on. Education, not legal advice.',
      }),
    ];
    let assumable = false;
    if (type === 'va') {
      assumable = true;
      flags.push(flag('va-entitlement', {
        title: 'VA entitlement',
        on: !veteran,
        detail: veteran
          ? 'Marked as a veteran substituting entitlement. The seller may be able to have entitlement restored. Confirm with the servicer. Education, not legal advice.'
          : 'A non-veteran may assume a VA loan only with servicer approval. The seller’s entitlement stays used until the loan is paid off or a veteran substitutes entitlement. Education, not legal advice.',
      }));
    } else if (type === 'fha') {
      assumable = true;
      flags.push(flag('fha-assumable', {
        title: 'FHA assumption',
        detail: 'FHA loans are assumable only with the servicer’s credit qualification. Education, not legal advice.',
      }));
    } else if (type === 'usda') {
      assumable = true;
      flags.push(flag('usda-assumable', {
        title: 'USDA assumption',
        detail: 'USDA loans are assumable only with the servicer’s credit qualification. Education, not legal advice.',
      }));
    } else if (type === 'conventional') {
      assumable = agreed;
      flags.push(flag('conventional-not-assumable', {
        title: 'Conventional assumability',
        on: !agreed,
        forcesNoGo: !agreed,
        blocksGo: !agreed,
        detail: agreed
          ? 'Marked as agreed in writing by the lender. Confirm the approval. Most conventional loans are not assumable. Education, not legal advice.'
          : 'Conventional loans are generally not assumable. Without the lender’s written agreement, treat this as not assumable. Education, not legal advice.',
      }));
    } else {
      assumable = agreed;
      flags.push(flag('assumability-unconfirmed', {
        title: 'Assumability unconfirmed',
        on: !agreed,
        forcesNoGo: !agreed,
        blocksGo: !agreed,
        detail: 'Loan type is not VA, FHA, or USDA. Treat it as not assumable unless the lender has agreed in writing. Education, not legal advice.',
      }));
    }
    return { type: type, assumable: assumable, flags: flags };
  }

  function assumptionVerdict(t, facts) {
    const reasons = [];
    if (facts.flags.some(f => f.forcesNoGo) || facts.assumable === false) {
      reasons.push('not-assumable');
      return { verdict: 'no-go', reasons: reasons };
    }
    if (!facts.gapCovered) {
      reasons.push('gap-not-covered');
      return { verdict: 'no-go', reasons: reasons };
    }
    if (facts.secondTermsMissing) {
      reasons.push('seller-second-terms-missing');
      return { verdict: 'no-go', reasons: reasons };
    }
    const savingsOk = facts.monthlySavings != null && facts.monthlySavings > t.goMonthlySavingsAbove;
    if (!facts.rental) {
      if (facts.monthlySavings == null) {
        reasons.push('market-rate-missing');
        return { verdict: 'caution', reasons: reasons };
      }
      if (!savingsOk) {
        reasons.push('savings-block-go');
        return { verdict: 'no-go', reasons: reasons };
      }
      if (facts.flags.some(f => f.blocksGo)) {
        reasons.push('blocked-go');
        return { verdict: 'caution', reasons: reasons };
      }
      reasons.push('savings-above-go');
      return { verdict: 'go', reasons: reasons };
    }
    if (!savingsOk) {
      reasons.push('savings-block-go');
      if (facts.monthlyCashFlow > t.cautionMonthlyCashFlowAbove) {
        return { verdict: 'caution', reasons: reasons };
      }
      return { verdict: 'no-go', reasons: reasons };
    }
    if (facts.monthlyCashFlow > t.goMonthlyCashFlowAbove
      && cocClears(facts.cashOnCash, t.goCashOnCashAbove)
      && !facts.flags.some(f => f.blocksGo)) {
      reasons.push('cash-flow-and-savings');
      return { verdict: 'go', reasons: reasons };
    }
    if (facts.monthlyCashFlow > t.cautionMonthlyCashFlowAbove) {
      reasons.push('cash-flow-not-a-go');
      return { verdict: 'caution', reasons: reasons };
    }
    reasons.push('cash-flow-below-caution');
    return { verdict: 'no-go', reasons: reasons };
  }

  function calcAssumption(input, override) {
    const src = input || {};
    const t = resolveThresholds('assumption', override);
    const parts = paymentParts(src);
    const funding = equityGapFunding(src);
    const eligibility = residentialAssumability(src);
    const comparison = marketComparison(parts, has(src.marketRate) ? src.marketRate : null);
    const feeMissing = !has(src.assumptionFee);
    const assumptionFee = feeMissing ? 0 : num(src.assumptionFee);
    const closingCosts = num(src.closingCosts);
    const cashToClose = funding.gapCash + assumptionFee + closingCosts + num(src.arrears);
    const housingPayment = parts.pi + parts.ti;
    const blendedPayment = housingPayment + funding.second.payment;
    const rentProvided = has(src.monthlyRent);
    const vacancyPct = has(src.vacancyPct) ? num(src.vacancyPct) : 0;
    const effectiveRent = rentProvided ? num(src.monthlyRent) * (1 - vacancyPct / 100) : null;
    const other = num(src.monthlyOtherExpenses);
    const monthlyCashFlow = rentProvided ? (effectiveRent - blendedPayment - other) : null;
    const coc = monthlyCashFlow == null ? null : cashOnCash(monthlyCashFlow * 12, cashToClose);
    const value = num(src.marketValue != null ? src.marketValue : src.value);
    const equity = value - parts.balance;

    const flags = eligibility.flags.slice();
    if (feeMissing) {
      flags.push(flag('assumption-fee-missing', {
        title: 'Assumption fee not entered',
        detail: 'Fee is treated as zero until you enter one. Zero is allowed. Omitting the field is not the same as zero.',
      }));
    }
    if (!funding.gapCovered) {
      flags.push(flag('gap-not-covered', {
        title: 'Equity gap not covered',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Cash, the seller second, and other funds do not cover the gap between price and the assumable balance.',
      }));
    }
    if (funding.second.termsMissing) {
      flags.push(flag('seller-second-terms-missing', {
        title: 'Seller second needs a term or interest-only',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'An amortizing seller second needs a term. Mark it interest-only if it is not amortizing.',
      }));
    }
    if (comparison.monthlySavings != null && comparison.monthlySavings <= t.goMonthlySavingsAbove) {
      flags.push(flag('savings-not-above-go', {
        title: 'Payment savings below the GO line',
        blocksGo: true,
        detail: 'The assumed payment is not cheaper than a new loan at the market rate on this balance. The verdict cannot be GO.',
      }));
    }

    const decided = assumptionVerdict(t, {
      flags: flags,
      assumable: eligibility.assumable,
      gapCovered: funding.gapCovered,
      secondTermsMissing: funding.second.termsMissing,
      monthlySavings: comparison.monthlySavings,
      rental: rentProvided,
      monthlyCashFlow: monthlyCashFlow,
      cashOnCash: coc,
    });

    return envelope('assumption', 'residential', t, decided.verdict, decided.reasons, flags, {
      loanType: eligibility.type,
      assumable: eligibility.assumable,
      loanBalance: parts.balance,
      equityGap: funding.equityGap,
      gapCash: funding.gapCash,
      uncoveredGap: Math.max(0, funding.uncovered),
      sellerSecondPayment: funding.second.payment,
      sellerSecondInterestOnly: funding.second.interestOnly === true,
      assumptionFee: assumptionFee,
      cashToClose: cashToClose,
      equity: equity,
      existingPayment: housingPayment,
      blendedPayment: blendedPayment,
      marketPayment: comparison.marketPayment,
      monthlySavings: comparison.monthlySavings,
      savingsOverTerm: comparison.savingsOverTerm,
      effectiveRent: effectiveRent,
      monthlyCashFlow: monthlyCashFlow,
      cashOnCash: coc,
      price: funding.price,
      marketValue: value,
    });
  }

  function commercialAssumptionFlags(src) {
    const type = String(src.loanType || '').toLowerCase();
    const flags = [
      flag('lender-approval', {
        title: 'Lender approval',
        detail: 'A commercial assumption requires the lender or servicer. This flag stays on. Education, not legal advice.',
      }),
    ];
    if (type === 'cmbs') {
      flags.push(flag('cmbs-assumption', {
        title: 'CMBS assumption',
        detail: 'CMBS assumptions go through the special servicer, carry a fee, and take time. This flag stays on. Education, not legal advice.',
      }));
    } else if (type === 'sba-7a' || type === 'sba-504' || type === 'sba') {
      flags.push(flag('sba-assumption', {
        title: 'SBA assumption',
        detail: 'SBA 7(a) and 504 assumptions need SBA approval, a fee, and a buyer who fits the program. This flag stays on. Education, not legal advice.',
      }));
    } else if (type === 'agency') {
      flags.push(flag('agency-assumption', {
        title: 'Agency assumption',
        detail: 'Agency assumptions need lender approval and the fee schedule in the loan documents. This flag stays on. Education, not legal advice.',
      }));
    } else if (type === 'bank') {
      flags.push(flag('bank-assumption', {
        title: 'Bank assumption',
        detail: 'A bank portfolio loan is assumable only if that lender agrees. This flag stays on. Education, not legal advice.',
      }));
    } else {
      flags.push(flag('commercial-type-unspecified', {
        title: 'Loan type not identified',
        detail: 'Name the loan: agency, CMBS, bank, SBA 7(a), or SBA 504. Approval is still required. Education, not legal advice.',
      }));
    }
    const released = src.sellerReleasedFromRecourse === true;
    flags.push(flag('recourse-release', {
      title: 'Recourse release',
      on: !released,
      released: released,
      detail: released
        ? 'Marked as the seller released from recourse. Confirm the release is in the assumption documents. Education, not legal advice.'
        : 'The seller may stay on the note. No release of recourse is the usual case until the lender signs one. This flag stays on. Education, not legal advice.',
    }));
    return { type: type, flags: flags };
  }

  function calcCommercialAssumption(input, override) {
    const src = input || {};
    const t = resolveThresholds('commercialAssumption', override);
    const balance = num(src.loanBalance);
    const years = num(src.remainingTermYears);
    const existingRate = num(src.rate);
    const rateReset = src.rateReset === true;
    const resetRateProvided = has(src.resetRate);
    const paymentRate = rateReset && resetRateProvided ? num(src.resetRate) : existingRate;
    const existingPi = monthlyPayment(balance, existingRate, years);
    const payingPi = monthlyPayment(balance, paymentRate, years);
    const annualDebt = payingPi * 12;
    const annualNoi = num(src.annualNOI);
    const annualCashFlow = annualNoi - annualDebt;
    const dscr = annualDebt > 0 ? annualNoi / annualDebt : null;
    const funding = equityGapFunding(src);
    const feeFromPercent = balance * (num(src.assumptionFeePercent) / 100);
    const flatFee = num(src.assumptionFee);
    const legal = num(src.legalCosts);
    const lenderCosts = num(src.lenderCosts);
    const totalAssumptionCost = feeFromPercent + flatFee + legal + lenderCosts;
    const cashToClose = funding.gapCash + totalAssumptionCost + num(src.closingCosts);
    const monthlySavings = (rateReset && !resetRateProvided) ? null : (existingPi - payingPi);
    const savingsClaimBlocked = rateReset && !resetRateProvided;

    const typed = commercialAssumptionFlags(src);
    const flags = typed.flags.slice();
    if (!funding.gapCovered) {
      flags.push(flag('gap-not-covered', {
        title: 'Equity gap not covered',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'Cash, the seller second, and other funds do not cover the gap between price and the assumable balance.',
      }));
    }
    if (funding.second.termsMissing) {
      flags.push(flag('seller-second-terms-missing', {
        title: 'Seller second needs a term or interest-only',
        forcesNoGo: true,
        blocksGo: true,
        detail: 'An amortizing seller second needs a term. Mark it interest-only if it is not amortizing.',
      }));
    }
    if (rateReset) {
      flags.push(flag('rate-reset', {
        title: 'Rate reset',
        blocksGo: !resetRateProvided,
        detail: resetRateProvided
          ? 'The loan rate resets. Debt service uses the reset rate you entered, not the old coupon. Education, not legal advice.'
          : 'The loan rate resets and no new rate was entered. Payment savings are not claimed, and the verdict cannot be GO. Education, not legal advice.',
      }));
    }

    const reasons = [];
    let verdict;
    if (flags.some(f => f.forcesNoGo)) {
      verdict = 'no-go';
      reasons.push('blocking-flag');
    } else if (savingsClaimBlocked || flags.some(f => f.blocksGo)) {
      verdict = annualCashFlow > t.cautionAnnualCashFlowAbove ? 'caution' : 'no-go';
      reasons.push(savingsClaimBlocked ? 'rate-reset-blocks-go' : 'blocked-go');
    } else if (annualCashFlow > t.goAnnualCashFlowAbove && dscr != null && dscr >= t.goDscrAtLeast) {
      verdict = 'go';
      reasons.push('dscr-above-go');
    } else if (annualCashFlow > t.cautionAnnualCashFlowAbove && dscr != null && dscr >= t.cautionDscrAtLeast) {
      verdict = 'caution';
      reasons.push('dscr-not-a-go');
    } else {
      verdict = 'no-go';
      reasons.push('below-caution');
    }

    return envelope('assumption', 'commercial', t, verdict, reasons, flags, {
      loanType: typed.type,
      loanBalance: balance,
      equityGap: funding.equityGap,
      gapCash: funding.gapCash,
      uncoveredGap: Math.max(0, funding.uncovered),
      sellerSecondPayment: funding.second.payment,
      sellerSecondInterestOnly: funding.second.interestOnly === true,
      totalAssumptionCost: totalAssumptionCost,
      cashToClose: cashToClose,
      existingMonthlyPrincipalAndInterest: existingPi,
      payingMonthlyPrincipalAndInterest: payingPi,
      annualNOI: annualNoi,
      annualDebtService: annualDebt,
      annualCashFlow: annualCashFlow,
      dscr: dscr,
      monthlySavings: monthlySavings,
      savingsClaimBlocked: savingsClaimBlocked,
      rateReset: rateReset,
      sellerReleasedFromRecourse: src.sellerReleasedFromRecourse === true,
    });
  }

  return {
    DISCLAIMER: DISCLAIMER,
    THRESHOLDS: THRESHOLDS,
    monthlyPayment: monthlyPayment,
    calcLeaseOption: calcLeaseOption,
    calcCommercialLeaseOption: calcCommercialLeaseOption,
    calcSubjectTo: calcSubjectTo,
    calcCommercialSubjectTo: calcCommercialSubjectTo,
    calcAssumption: calcAssumption,
    calcCommercialAssumption: calcCommercialAssumption,
    resolveThresholds: resolveThresholds,
  };
}));
