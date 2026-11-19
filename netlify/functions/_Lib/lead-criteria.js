// netlify/functions/_Lib/lead-criteria.js
//
// Maps FORGE lead types onto PropertyRadar criteria.
//
// Verification (Nov 19, 2026): names and value formats below were checked
// against https://developers.propertyradar.com/criteria_reference and
// https://developers.propertyradar.com/criteria. This environment has no
// PropertyRadar API key, so none of these were confirmed with a live
// Purchase=0 count. Do not describe them as live-verified.
//
// How the API combines filters (documented, not re-tested live):
//   - Every object in Criteria is ANDed. A property must match all of them.
//   - Values inside one criterion are ORed (zip 46307 OR 46308, stage A OR B).
//   - There is no OR across different criterion names, and no general NOT.
//     "Match any selected lead type" is rejected. Property-type Exclude is
//     done by sending the other types (the complement), which the API then ORs.
//   - Boolean criteria take [1] or [0]. Ranges are [[min, max]] with null open.
//     A range max is inclusive ("up to"), so "LTV under 60" is CLTV [[0, 59]]
//     and "LTV over 80" is CLTV [[81, null]].
//   - Dates use "from: M/D/YYYY to: M/D/YYYY". LastTransferRecDate is a
//     Relative Date Including Unknowns: an empty from includes unknown dates,
//     so long ownership uses from 1/1/1900 rather than an open start.
//
// Deal Surge / Realeflow definitions, and the criterion used for each:
//   High Equity: has a loan, LTV under 60.
//   Low Equity: LTV over 80.
//   Upside Down: LTV over 100.
//   Free & Clear: no mortgage.
//   Flipped: bought and sold within 24 months, intrafamily excluded.
//   Long-Term Owner: 25+ years.
//   Bored Investor: absentee, owned 10+ years.
//   Zombie: pre-foreclosure and vacant.
//   Active Investor Owned: approximate. See that entry.
//   Potentially Inherited: approximate. See that entry.
//   Pre-Foreclosure: notice filed, not auction, not bank-owned.
//   Foreclosure Activity: pre-foreclosure or auction, not bank-owned.

const catalog = require('../../../assets/js/lead-filters');

const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
]);

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

// Active pre-foreclosure only. inForeclosure also matches auction and bank-owned,
// which is why the old prefore mapping was too wide. Preforeclosure-Sold, Old,
// and Released are finished or stale filings, so they stay out.
const PREFORE_STAGES = ['Preforeclosure', 'Preforeclosure-NTS'];
const AUCTION_STAGES = ['Auction', 'Auction-UNK', 'Sale Pending'];
const BANK_OWNED_STAGES = ['Bank Owned', 'Bank Owned-Held'];

// LastTransferType has no intrafamily value. Related-party deeds are
// TransferType NonMarket-Family, which is a different criterion and is not
// included here. PriorTransferMonthsSince caps the hold at 24 months.
const FLIP_TRANSFER_TYPES = [
  'Market', 'MarketFlip', 'ShortSale', 'ShortSaleFlip', 'REOResale', 'REOFlip', '3rdResale',
];

// PropertyRadar files townhouses (102) and mobile/manufactured (137, 138)
// under PType SFR. Those are their own buckets here, so Single Family is the
// remaining SFR advanced types: single family residence, PUD, and cabin.
const PROPERTY_TYPE_CRITERIA = {
  sfr: { pTypes: [], advanced: ['163', '148', '109'] },
  condo: { pTypes: ['CND'], advanced: [] },
  townhome: { pTypes: [], advanced: ['102'] },
  multifamily: { pTypes: ['MFR'], advanced: [] },
  apartment: { pTypes: ['APT'], advanced: [] },
  land: { pTypes: ['LND'], advanced: [] },
  mobile: { pTypes: [], advanced: ['137', '138'] },
  other: { pTypes: ['RES', 'COM', 'IND', 'AGR'], advanced: [] },
};

const MATCH_ANY_ERROR = 'Property Search combines lead types, so a property has to match every type you pick. Search one lead type at a time to see either list.';

function formatMDY(date) {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}

function shiftUtcYears(now, deltaYears) {
  return new Date(Date.UTC(now.getUTCFullYear() + deltaYears, now.getUTCMonth(), now.getUTCDate()));
}

// Known purchase dates on or before `years` ago. Unknown dates are left out.
function ownedAtLeastYears(years, now) {
  return `from: 1/1/1900 to: ${formatMDY(shiftUtcYears(now, -years))}`;
}

function ownedWithinYears(years, now) {
  return `from: ${formatMDY(shiftUtcYears(now, -years))} to: ${formatMDY(now)}`;
}

function stageCriterion(stages) {
  return { name: 'ForeclosureStage', value: stages.slice() };
}

// criteria(now) returns the AND-list for that lead type.
// approximate: true when the list cannot be the Deal Surge definition exactly.
const LEAD_CRITERIA = {
  absentee: {
    label: 'Absentee Owners',
    // isSameMailingOrExempt 0 = not owner-occupied (mailing differs and no
    // homestead exemption). Documented boolean. Same criterion the page already used.
    criteria: () => [{ name: 'isSameMailingOrExempt', value: [0] }],
  },
  activeinvestor: {
    label: 'Active Investor Owned',
    // APPROXIMATE. Deal Surge: the owner holds multiple properties and bought
    // one of them in the last 3 years. There is no criterion for "purchased a
    // different property in the portfolio." This uses NumberPropertiesOwned >= 2
    // AND this property's own purchase date within 3 years.
    approximate: true,
    criteria: (now) => [
      { name: 'NumberPropertiesOwned', value: [[2, null]] },
      { name: 'LastTransferRecDate', value: [ownedWithinYears(3, now)] },
    ],
  },
  listing: {
    label: 'Active Listing',
    // Do not also send ListingStatus. The criteria reference says the two together
    // can return nothing or a misleading set.
    criteria: () => [{ name: 'isListedForSale', value: [1] }],
  },
  bored: {
    label: 'Bored Investor',
    criteria: (now) => [
      { name: 'isSameMailingOrExempt', value: [0] },
      { name: 'LastTransferRecDate', value: [ownedAtLeastYears(10, now)] },
    ],
  },
  cashbuyer: {
    label: 'Cash Buyers',
    // Documented as a market transfer with no simultaneous loan.
    criteria: () => [{ name: 'isCashTransaction', value: [1] }],
  },
  taxdelinquent: {
    label: 'Delinquent Tax Activity',
    criteria: () => [{ name: 'inTaxDelinquency', value: [1] }],
  },
  flipped: {
    label: 'Flipped',
    criteria: () => [
      { name: 'LastTransferType', value: FLIP_TRANSFER_TYPES.slice() },
      { name: 'PriorTransferMonthsSince', value: [[0, 24]] },
    ],
  },
  foreactivity: {
    label: 'Foreclosure Activity',
    // Pre-foreclosure or auction. Bank-owned is the separate Foreclosures list.
    // Stages inside this one criterion are ORed.
    criteria: () => [stageCriterion(PREFORE_STAGES.concat(AUCTION_STAGES))],
  },
  foreclosure: {
    label: 'Foreclosures (Bank-Owned)',
    // Completed foreclosure still held by the lender. Resold and rescinded
    // stages are not "bank-owned" anymore, so they are left out.
    criteria: () => [stageCriterion(BANK_OWNED_STAGES)],
  },
  freeclear: {
    label: 'Free & Clear',
    // NumberLoans is a Multiple Range. [[0, 0]] is exactly zero open loans.
    criteria: () => [{ name: 'NumberLoans', value: [[0, 0]] }],
  },
  highequity: {
    label: 'High Equity',
    // Has a loan (NumberLoans 1 through open) and CLTV 0 through 59.
    // 59 because the range max is inclusive and the definition is LTV under 60.
    // Replaces the old EquityPercent >= 50 mapping, which did not require a loan
    // and used a different equity cut.
    criteria: () => [
      { name: 'NumberLoans', value: [[1, null]] },
      { name: 'CLTV', value: [[0, 59]] },
    ],
  },
  longterm: {
    label: 'Long-Term Owner',
    criteria: (now) => [{ name: 'LastTransferRecDate', value: [ownedAtLeastYears(25, now)] }],
  },
  lowequity: {
    label: 'Low Equity',
    criteria: () => [{ name: 'CLTV', value: [[81, null]] }],
  },
  inherited: {
    label: 'Potentially Inherited',
    // APPROXIMATE. inDistress ORs the values you list, so this is probate OR
    // a deceased-owner indicator (isDeceasedProperty is the Pre-Probate flag;
    // the boolean form of that flag is isDeceased). A last-name match between
    // seller and owner on a no-mortgage transfer is not a criterion — nothing
    // compares LastTransferSeller to the current owner — so that half of the
    // Deal Surge rule is not included.
    approximate: true,
    criteria: () => [{ name: 'inDistress', value: ['isDeceasedProperty', 'inProbateProperty'] }],
  },
  prefore: {
    label: 'Pre-Foreclosures',
    criteria: () => [stageCriterion(PREFORE_STAGES)],
  },
  upsidedown: {
    label: 'Upside Down',
    criteria: () => [{ name: 'CLTV', value: [[101, null]] }],
  },
  vacant: {
    label: 'Vacancy',
    criteria: () => [{ name: 'isSiteVacant', value: [1] }],
  },
  zombie: {
    label: 'Zombie Property',
    criteria: () => [
      stageCriterion(PREFORE_STAGES),
      { name: 'isSiteVacant', value: [1] },
    ],
  },
  probate: {
    label: 'Probate',
    criteria: () => [{ name: 'inProbateProperty', value: [1] }],
  },
  divorce: {
    label: 'Divorce',
    criteria: () => [{ name: 'inDivorce', value: [1] }],
  },
};

function peelState(raw) {
  const text = String(raw || '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const names = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (lower === name) return { city: '', state: STATE_NAMES[name] };
    const suffix = ` ${name}`;
    if (lower.endsWith(suffix)) {
      return { city: text.slice(0, text.length - name.length).trim(), state: STATE_NAMES[name] };
    }
  }
  const parts = text.split(' ');
  const last = (parts[parts.length - 1] || '').toUpperCase();
  if (US_STATE_CODES.has(last)) {
    return { city: parts.slice(0, -1).join(' '), state: last };
  }
  return null;
}

// Zip wins when the text contains one, same as the previous search.
// "Reno NV" and "Reno, Nevada" both become City + DefaultState.
function buildLocationCriteria(location) {
  const trimmed = String(location || '').trim();
  if (!trimmed) return [];

  const zipMatch = trimmed.match(/\b\d{5}\b/);
  if (zipMatch) return [{ name: 'ZipFive', value: [Number(zipMatch[0])] }];

  const comma = trimmed.indexOf(',');
  if (comma !== -1) {
    const city = trimmed.slice(0, comma).trim();
    const peeled = peelState(trimmed.slice(comma + 1));
    if (city && peeled && peeled.state && !peeled.city) {
      return [
        { name: 'City', value: [city] },
        { name: 'DefaultState', value: [peeled.state] },
      ];
    }
    if (city) return [{ name: 'City', value: [city] }];
  }

  const peeled = peelState(trimmed);
  if (peeled && peeled.state && peeled.city) {
    return [
      { name: 'City', value: [peeled.city] },
      { name: 'DefaultState', value: [peeled.state] },
    ];
  }
  if (peeled && peeled.state) return [{ name: 'DefaultState', value: [peeled.state] }];
  return [{ name: 'City', value: [trimmed] }];
}

function knownIds(value, lookup) {
  const raw = Array.isArray(value) ? value.join(',') : (value || '');
  const seen = new Set();
  const out = [];
  String(raw).split(',').forEach(part => {
    const id = part.trim();
    if (!id || seen.has(id) || !lookup(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function equityCriterion(minRaw, maxRaw) {
  const hasMin = minRaw != null && String(minRaw).trim() !== '';
  const hasMax = maxRaw != null && String(maxRaw).trim() !== '';
  if (!hasMin && !hasMax) return { criterion: null };
  const min = hasMin ? Number(minRaw) : null;
  const max = hasMax ? Number(maxRaw) : null;
  if ((hasMin && !Number.isFinite(min)) || (hasMax && !Number.isFinite(max))) {
    return { error: 'Equity percent has to be a number.' };
  }
  if ((min != null && (min < -100 || min > 100)) || (max != null && (max < -100 || max > 150))) {
    return { error: 'Equity percent is out of range.' };
  }
  if (min != null && max != null && min > max) {
    return { error: 'Minimum equity cannot be higher than maximum equity.' };
  }
  return { criterion: { name: 'EquityPercent', value: [[min, max]] } };
}

function propertyTypeCriterion(ids, mode) {
  if (!ids.length) return { criteria: [] };
  const selected = new Set(ids);
  const order = catalog.PROPERTY_TYPES.map(type => type.id);
  const buckets = mode === 'exclude' ? order.filter(id => !selected.has(id)) : order.filter(id => selected.has(id));
  if (!buckets.length) {
    return { error: 'Excluding every property type leaves nothing to search. Leave at least one type in.' };
  }
  const pTypes = [];
  const advanced = [];
  buckets.forEach(id => {
    const spec = PROPERTY_TYPE_CRITERIA[id];
    pTypes.push(...spec.pTypes);
    advanced.push(...spec.advanced);
  });
  const value = [];
  if (pTypes.length) value.push({ name: 'PType', value: pTypes });
  if (advanced.length) value.push({ name: 'AdvancedPropertyType', value: advanced });
  return { criteria: [{ name: 'PropertyType', value }] };
}

function compileSearch(input, now) {
  const source = input || {};
  const when = now || new Date();
  const playIds = knownIds(source.plays, id => LEAD_CRITERIA[id]);
  const propertyTypes = knownIds(source.ptypes, id => PROPERTY_TYPE_CRITERIA[id]);
  const propertyMode = source.pmode === 'exclude' ? 'exclude' : 'include';
  const match = source.match === 'any' ? 'any' : 'all';
  const location = String(source.location || '').trim();

  if (!playIds.length) return { error: 'Pick at least one lead type.', status: 400 };
  if (match === 'any' && playIds.length > 1) return { error: MATCH_ANY_ERROR, status: 400 };

  const equity = equityCriterion(source.emin, source.emax);
  if (equity.error) return { error: equity.error, status: 400 };
  const types = propertyTypeCriterion(propertyTypes, propertyMode);
  if (types.error) return { error: types.error, status: 400 };

  const criteria = buildLocationCriteria(location);
  playIds.forEach(id => criteria.push(...LEAD_CRITERIA[id].criteria(when)));
  criteria.push(...types.criteria);
  if (equity.criterion) criteria.push(equity.criterion);

  const link = catalog.buildPropertySearchLink({
    location,
    plays: playIds,
    propertyTypes,
    propertyMode,
    match,
    equityMin: source.emin != null && String(source.emin).trim() !== '' ? String(source.emin).trim() : '',
    equityMax: source.emax != null && String(source.emax).trim() !== '' ? String(source.emax).trim() : '',
  });

  return {
    criteria,
    playIds,
    propertyTypes,
    propertyMode,
    match,
    location,
    link,
    leadTypes: playIds.map(id => ({
      id,
      label: LEAD_CRITERIA[id].label,
      approximate: !!LEAD_CRITERIA[id].approximate,
    })),
    approximate: playIds.filter(id => LEAD_CRITERIA[id].approximate).map(id => LEAD_CRITERIA[id].label),
  };
}

function labelFor(id) {
  return (LEAD_CRITERIA[id] && LEAD_CRITERIA[id].label) || id;
}

module.exports = {
  LEAD_CRITERIA,
  PROPERTY_TYPE_CRITERIA,
  PREFORE_STAGES,
  MATCH_ANY_ERROR,
  buildLocationCriteria,
  compileSearch,
  labelFor,
  ownedAtLeastYears,
  ownedWithinYears,
};
