// Browser adapter for the creative-finance calculators.
// Reads the Deal Analyzer forms, calls ForgeCreativeFinance, and builds
// the verdict metrics, the standing risk strip, and a loan-balance
// projection. No network. The page decides Empire access before calling run().
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeCreativePanel = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TABS = ['lease-option', 'subject-to', 'assumption'];

  function engine() {
    return (typeof window !== 'undefined' && window.ForgeCreativeFinance) || null;
  }

  function isCreative(tab) {
    return TABS.indexOf(tab) !== -1;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function blank(id) {
    var node = el(id);
    return !node || String(node.value).trim() === '';
  }

  function num(id) {
    if (blank(id)) return null;
    var n = Number(el(id).value);
    return Number.isFinite(n) ? n : null;
  }

  function num0(id) {
    var n = num(id);
    return n == null ? 0 : n;
  }

  function checked(id) {
    var node = el(id);
    return !!(node && node.checked);
  }

  function text(id) {
    var node = el(id);
    return node ? String(node.value).trim() : '';
  }

  function money(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  function pct(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toFixed(1) + '%';
  }

  function cls(good, bad) {
    if (good) return 'good';
    if (bad) return 'bad';
    return 'warn';
  }

  function propertyClass(tab) {
    var form = el('form-' + tab);
    var value = form && form.dataset.propertyClass;
    return value === 'commercial' ? 'commercial' : 'residential';
  }

  function snapshot(tab) {
    var form = el('form-' + tab);
    var fields = {};
    if (!form) return fields;
    form.querySelectorAll('input, select').forEach(function (node) {
      if (!node.id) return;
      if (node.type === 'checkbox') fields[node.id] = node.checked;
      else if (node.value !== '') fields[node.id] = node.type === 'number' ? Number(node.value) : node.value;
    });
    return fields;
  }

  function remainingBalance(principal, annualRatePct, termYears, yearsElapsed) {
    var CF = engine();
    if (!CF || !principal || principal <= 0) return 0;
    var months = Math.round((yearsElapsed || 0) * 12);
    var n = (termYears || 0) * 12;
    if (n <= 0) return principal;
    if (months >= n) return 0;
    var pmt = CF.monthlyPayment(principal, annualRatePct || 0, termYears);
    var r = (annualRatePct || 0) / 100 / 12;
    if (r === 0) return Math.max(0, principal - pmt * months);
    var pow = Math.pow(1 + r, months);
    return Math.max(0, principal * pow - pmt * ((pow - 1) / r));
  }

  function leaseInput(which) {
    if (which === 'commercial') {
      return {
        propertyClass: 'commercial',
        masterLeaseRentMonthly: num0('lo-master-rent'),
        subleaseIncomeMonthly: num('lo-sublease'),
        annualNOI: num('lo-noi'),
        optionConsideration: num0('lo-consideration'),
        exercisePrice: num('lo-exercise'),
        exerciseCapRate: num('lo-cap'),
        termMonths: num0('lo-com-term'),
        leaseType: text('lo-lease-type') || null,
      };
    }
    return {
      propertyClass: 'residential',
      structure: text('lo-structure') || 'sandwich',
      marketValue: num0('lo-value'),
      optionFeePaid: num0('lo-fee-paid'),
      optionFeeCollected: num0('lo-fee-collected'),
      monthlyRentPaid: num0('lo-rent-paid'),
      monthlyRentCollected: num0('lo-rent-collected'),
      rentCredit: num0('lo-credit'),
      yourStrike: num0('lo-your-strike'),
      tenantStrike: num('lo-tenant-strike'),
      termMonths: num0('lo-term'),
      repairs: num0('lo-repairs'),
      closingCosts: num0('lo-closing'),
      occupantIsEndBuyer: checked('lo-occupant'),
    };
  }

  function subjectInput(which, holdMonths) {
    var base = {
      marketValue: num0('st-value'),
      price: num0('st-price'),
      loanBalance: num0('st-balance'),
      rate: num0('st-rate'),
      remainingTermYears: num0('st-term'),
      monthlyTax: num0('st-tax'),
      monthlyInsurance: num0('st-ins'),
      monthlyHoa: num0('st-hoa'),
      arrears: num0('st-arrears'),
      escrowShortage: num0('st-escrow'),
      cashToSeller: num0('st-cash-seller'),
      closingCosts: num0('st-closing'),
      marketRate: num('st-market-rate'),
      holdMonths: holdMonths,
      creatingConsumerLoan: checked('st-consumer'),
    };
    if (!blank('st-piti')) base.monthlyPiti = num0('st-piti');
    if (!blank('st-balloon')) base.balloonMonths = num0('st-balloon');
    if (which === 'commercial') {
      base.propertyClass = 'commercial';
      base.annualNOI = num0('st-noi');
      base.recourse = text('st-recourse') || 'unknown';
      base.prepayOrDefeasance = checked('st-prepay');
      base.prepayPenalty = num0('st-prepay-penalty');
      return base;
    }
    base.propertyClass = 'residential';
    base.monthlyRent = num('st-rent');
    base.vacancyPct = num0('st-vacancy');
    base.monthlyOtherExpenses = num0('st-other');
    return base;
  }

  function sellerSecondFrom(prefix) {
    var amount = num(prefix + '-second-amount');
    if (amount == null) return undefined;
    return {
      amount: amount,
      rate: num0(prefix + '-second-rate'),
      termYears: num0(prefix + '-second-term'),
      interestOnly: checked(prefix + '-second-io'),
    };
  }

  function assumptionInput(which) {
    if (which === 'commercial') {
      var input = {
        propertyClass: 'commercial',
        loanType: text('as-com-type') || 'agency',
        loanBalance: num0('as-com-balance'),
        price: num0('as-com-price'),
        rate: num0('as-com-rate'),
        remainingTermYears: num0('as-com-term'),
        annualNOI: num0('as-com-noi'),
        assumptionFeePercent: num0('as-fee-pct'),
        legalCosts: num0('as-legal'),
        lenderCosts: num0('as-lender-costs'),
        gapCash: num('as-com-gap'),
        closingCosts: num0('as-com-closing'),
        rateReset: checked('as-rate-reset'),
        sellerReleasedFromRecourse: checked('as-released'),
        sellerSecond: sellerSecondFrom('as-com'),
      };
      if (!blank('as-reset-rate')) input.resetRate = num0('as-reset-rate');
      return input;
    }
    return {
      propertyClass: 'residential',
      loanType: text('as-loan-type') || 'va',
      veteranSubstitutingEntitlement: checked('as-veteran'),
      lenderAgreedInWriting: checked('as-agreed'),
      marketValue: num0('as-value'),
      price: num0('as-price'),
      loanBalance: num0('as-balance'),
      rate: num0('as-rate'),
      remainingTermYears: num0('as-term'),
      monthlyTax: num0('as-tax'),
      monthlyInsurance: num0('as-ins'),
      marketRate: num('as-market-rate'),
      assumptionFee: blank('as-fee') ? null : num0('as-fee'),
      closingCosts: num0('as-closing'),
      gapCash: num('as-gap-cash'),
      monthlyRent: num('as-rent'),
      vacancyPct: num0('as-vacancy'),
      monthlyOtherExpenses: num0('as-other'),
      sellerSecond: sellerSecondFrom('as'),
    };
  }

  function leaseMetrics(r) {
    var rows = [
      { label: 'Monthly spread', value: money(r.monthlySpread), cls: cls(r.monthlySpread > 200, r.monthlySpread < 0) },
      { label: 'Spread over term', value: money(r.spreadOverTerm), cls: cls(r.spreadOverTerm > 0, r.spreadOverTerm < 0) },
      { label: 'Cash in', value: money(r.cashIn), cls: '' },
    ];
    if (r.propertyClass === 'commercial') {
      rows.push({ label: 'Value at cap', value: money(r.valueAtCap), cls: '' });
      rows.push({ label: 'Exercise vs value', value: money(r.exerciseVersusValue), cls: cls(r.exerciseVersusValue > 0, r.exerciseVersusValue < 0) });
    } else {
      rows.push({ label: 'Net option fee', value: money(r.netOptionFee), cls: cls(r.netOptionFee > 0, r.netOptionFee < 0) });
      rows.push({ label: 'Effective price', value: money(r.effectivePrice), cls: '' });
      if (r.backEndSpread != null) rows.push({ label: 'Back-end spread', value: money(r.backEndSpread), cls: cls(r.backEndSpread > 0, r.backEndSpread < 0) });
      rows.push({ label: 'Months to recover fee', value: r.monthsToRecover == null ? '—' : r.monthsToRecover.toFixed(1), cls: '' });
    }
    return rows;
  }

  function subjectMetrics(r) {
    var rows = [
      { label: 'Cash to close', value: money(r.cashToClose), cls: '' },
      { label: 'Equity (value − balance)', value: money(r.equity), cls: cls(r.equity > 0, r.equity < 0) },
      { label: 'Equity paid for (price − balance)', value: money(r.equityPaidFor), cls: '' },
      { label: 'Monthly PITI', value: money(r.monthlyPiti), cls: '' },
    ];
    if (r.propertyClass === 'commercial') {
      rows.push({ label: 'Annual cash flow', value: money(r.annualCashFlow), cls: cls(r.annualCashFlow > 0, r.annualCashFlow < 0) });
      rows.push({ label: 'DSCR', value: r.dscr == null ? '—' : r.dscr.toFixed(2) + 'x', cls: cls(r.dscr >= 1.25, r.dscr < 1) });
    } else {
      rows.push({ label: 'Monthly cash flow', value: money(r.monthlyCashFlow), cls: cls(r.monthlyCashFlow > 200, r.monthlyCashFlow != null && r.monthlyCashFlow <= 0) });
      rows.push({ label: 'Cash-on-cash', value: pct(r.cashOnCash), cls: cls(r.cashOnCash == null || r.cashOnCash > 8, r.cashOnCash != null && r.cashOnCash <= 0) });
      rows.push({ label: 'DSCR on PITI', value: r.dscr == null ? '—' : r.dscr.toFixed(2) + 'x', cls: cls(r.dscr >= 1.25, r.dscr < 1) });
    }
    rows.push({ label: 'Payment vs new market loan', value: money(r.monthlySavings), cls: cls(r.monthlySavings > 0, r.monthlySavings < 0) });
    if (r.savingsClaimBlocked) rows.push({ label: 'Rate-savings claim', value: 'Blocked', cls: 'bad' });
    return rows;
  }

  function assumptionMetrics(r) {
    var rows = [];
    if (r.loanType === 'va') rows.push({ label: 'VA loans', value: 'Assumable', cls: 'good' });
    rows.push(
      { label: 'Equity gap', value: money(r.equityGap), cls: '' },
      { label: 'Gap still uncovered', value: money(r.uncoveredGap), cls: cls(r.uncoveredGap === 0, r.uncoveredGap > 0) },
      { label: 'Cash to close', value: money(r.cashToClose), cls: '' }
    );
    if (r.propertyClass === 'commercial') {
      rows.push({ label: 'Assumption cost', value: money(r.totalAssumptionCost), cls: '' });
      rows.push({ label: 'Annual cash flow', value: money(r.annualCashFlow), cls: cls(r.annualCashFlow > 0, r.annualCashFlow < 0) });
      rows.push({ label: 'DSCR', value: r.dscr == null ? '—' : r.dscr.toFixed(2) + 'x', cls: cls(r.dscr >= 1.25, r.dscr < 1) });
      rows.push({ label: 'Payment vs old rate', value: r.savingsClaimBlocked ? 'Not claimed' : money(r.monthlySavings), cls: r.savingsClaimBlocked ? 'warn' : cls(r.monthlySavings > 0, r.monthlySavings < 0) });
    } else {
      rows.push({ label: 'Seller second / mo', value: money(r.sellerSecondPayment), cls: '' });
      rows.push({ label: 'Blended payment', value: money(r.blendedPayment), cls: '' });
      rows.push({ label: 'Saved vs market rate', value: money(r.monthlySavings), cls: cls(r.monthlySavings > 0, r.monthlySavings != null && r.monthlySavings <= 0) });
      rows.push({ label: 'Monthly cash flow', value: money(r.monthlyCashFlow), cls: cls(r.monthlyCashFlow > 200, r.monthlyCashFlow != null && r.monthlyCashFlow <= 0) });
    }
    return rows;
  }

  function loanShape(input, result) {
    var second = input.sellerSecond || {};
    var value = input.marketValue || input.price || 0;
    var annualDebt;
    var annualRent;
    var annualOther = 0;
    if (result.propertyClass === 'commercial') {
      annualRent = result.annualNOI || input.annualNOI || 0;
      annualDebt = result.annualDebtService || 0;
    } else if (result.strategy === 'assumption') {
      annualRent = (result.effectiveRent || 0) * 12;
      annualDebt = (result.blendedPayment || 0) * 12;
      annualOther = num0(result.strategy === 'assumption' ? 'as-other' : 'st-other') * 12;
    } else {
      annualRent = (result.effectiveRent || 0) * 12;
      annualDebt = (result.monthlyPiti || 0) * 12;
      annualOther = num0('st-other') * 12;
    }
    return {
      kind: 'loan',
      value: value,
      balance: input.loanBalance || 0,
      rate: input.rate || 0,
      termYears: input.remainingTermYears || 0,
      annualRent: annualRent,
      annualDebt: annualDebt,
      annualOther: annualOther,
      secondBalance: second.amount || 0,
      secondRate: second.rate || 0,
      secondYears: second.termYears || 0,
      secondInterestOnly: second.interestOnly === true,
    };
  }

  function run(tab, opts) {
    var CF = engine();
    if (!CF || !isCreative(tab)) return null;
    var which = propertyClass(tab);
    var holdMonths = ((opts && opts.holdYears) || 0) * 12;
    var input;
    var result;
    if (tab === 'lease-option') {
      input = leaseInput(which);
      result = which === 'commercial' ? CF.calcCommercialLeaseOption(input) : CF.calcLeaseOption(input);
    } else if (tab === 'subject-to') {
      input = subjectInput(which, holdMonths);
      result = which === 'commercial' ? CF.calcCommercialSubjectTo(input) : CF.calcSubjectTo(input);
    } else {
      input = assumptionInput(which);
      result = which === 'commercial' ? CF.calcCommercialAssumption(input) : CF.calcAssumption(input);
    }
    var addressId = tab === 'lease-option' ? 'lo-address' : tab === 'subject-to' ? 'st-address' : 'as-address';
    result.address = text(addressId);
    result.inputs = input;
    result.fields = snapshot(tab);
    result.propertyClass = which;
    result.metrics = tab === 'lease-option' ? leaseMetrics(result) : tab === 'subject-to' ? subjectMetrics(result) : assumptionMetrics(result);
    if (tab === 'lease-option') {
      result.projection = { kind: 'spread', monthlySpread: result.monthlySpread || 0, termMonths: input.termMonths || 0 };
    } else {
      result.projection = loanShape(input, result);
    }
    return result;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function visibleFlags(flags) {
    return (flags || []).filter(function (f) {
      return f && (f.on || f.id === 'va-entitlement' || f.id === 'lender-approval');
    });
  }

  function riskHtml(flags) {
    var list = visibleFlags(flags);
    if (!list.length) return '';
    return '<div class="risk-strip">' + list.map(function (f) {
      var tone = f.forcesNoGo ? 'block' : f.blocksGo ? 'warn' : (f.on ? 'standing' : 'clear');
      return '<div class="risk-flag ' + tone + '"><div class="risk-flag-title">' + esc(f.title || f.id) + '</div><div class="risk-flag-detail">' + esc(f.detail || '') + '</div></div>';
    }).join('') + '</div>';
  }

  function projectionHtml(result, assumptions) {
    var a = assumptions || {};
    var years = a.holdYears || 1;
    var rentG = (a.rentGrowth || 0) / 100;
    var app = (a.appreciation || 0) / 100;
    var expG = (a.expenseGrowth || 0) / 100;
    var p = result && result.projection;
    if (!p) return '';
    if (p.kind === 'spread') {
      var termYears = p.termMonths > 0 ? Math.max(1, Math.ceil(p.termMonths / 12)) : years;
      var n = Math.min(years, termYears);
      var rows = '';
      var cum = 0;
      for (var y = 1; y <= n; y++) {
        var months = y === n && p.termMonths > 0 ? Math.min(12, p.termMonths - (y - 1) * 12) : 12;
        if (months < 0) months = 0;
        var spread = (p.monthlySpread || 0) * months;
        cum += spread;
        rows += '<tr><td>Year ' + y + '</td><td class="' + (spread >= 0 ? 'good' : 'bad') + '">' + money(spread) + '</td><td class="' + (cum >= 0 ? 'good' : 'bad') + '">' + money(cum) + '</td></tr>';
      }
      return '<table class="proj-table"><thead><tr><th>Period</th><th>Spread</th><th>Cumulative spread</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    var body = '';
    var cumulative = 0;
    for (var year = 1; year <= years; year++) {
      var rent = (p.annualRent || 0) * Math.pow(1 + rentG, year - 1);
      var other = (p.annualOther || 0) * Math.pow(1 + expG, year - 1);
      var cf = rent - (p.annualDebt || 0) - other;
      cumulative += cf;
      var firstLeft = remainingBalance(p.balance, p.rate, p.termYears, year);
      var secondLeft = p.secondInterestOnly
        ? (p.secondBalance || 0)
        : remainingBalance(p.secondBalance, p.secondRate, p.secondYears, year);
      var equity = (p.value || 0) > 0 ? (p.value * Math.pow(1 + app, year) - firstLeft - secondLeft) : null;
      body += '<tr><td>Year ' + year + '</td><td class="' + (cf >= 0 ? 'good' : 'bad') + '">' + money(cf) + '</td><td>' + money(cumulative) + '</td><td>' + money(firstLeft) + '</td><td class="' + (equity > 0 ? 'good' : '') + '">' + money(equity) + '</td></tr>';
    }
    return '<table class="proj-table"><thead><tr><th>Period</th><th>Cash flow</th><th>Cumulative</th><th>Remaining balance</th><th>Equity (value − balance)</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  return {
    TABS: TABS,
    isCreative: isCreative,
    propertyClass: propertyClass,
    run: run,
    riskHtml: riskHtml,
    projectionHtml: projectionHtml,
  };
}));
