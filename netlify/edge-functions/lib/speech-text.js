// Speech-only text for ARIS voice, plus the currency rule shared with
// property-analysis prompts.
//
// This file lives in lib/ on purpose. Netlify treats every top-level
// file in netlify/edge-functions as an edge function and refuses to
// deploy one that does not default-export a request handler.
//
// Displayed chat, calculator figures, and saved transcripts are not
// rewritten here. Callers pass the finished utterance (ARIS Coach
// click-to-play and Real Estate Lab auto-play both wait until the
// message is complete). Do not run this on partial stream deltas: a
// token split such as "AR" + "V" or "$12" + "3,000" cannot be
// normalized safely. prepareSpeechText slices only after normalization,
// on a whitespace boundary, so the 5000-character cap cannot cut an
// amount or an expanded abbreviation in half. US postal abbreviations
// are expanded to state names in that same spoken copy. Amounts are
// then spoken as American conversational words, with no "and" inside
// the number ("and" only between dollars and cents). ZIP codes, phone
// numbers, and property IDs are spoken one digit at a time ("oh" for
// zero). Street numbers and years stay written digits.

export const SPEECH_CHAR_LIMIT = 5000;

// The repo documents ARIS as short for Aristotle (about-aris.html and the
// coach prompt). It does not document a phonetic spelling. aris-voice.js
// still sends the ElevenLabs pronunciation dictionary; that lexicon is
// not in the repo, so an approved pronunciation may already live there.
// Leaving the word "ARIS" untouched lets that dictionary apply. Do not
// invent a spelling here.

const CURRENCY_RULE = `CURRENCY AND UNITS:
FORGE property and market figures are United States dollars unless the member explicitly places the property outside the United States or names another currency (for example GBP, pounds sterling, EUR, CAD, or AUD).
- For a US property, or when no country or currency was named, write US dollars with $ or the word "dollars". Do not say "pounds" and do not use £.
- If the member explicitly supplies a non-US currency, keep that amount in that currency. Do not convert it, and do not relabel it as dollars or change its number.
- $ or USD marks US dollars. £, GBP, or pounds sterling marks pounds. Never swap those symbols or words in a way that presents one currency as the other.
- Percentages, cap rates, ratios, and calculated results stay in the units given.
- This does not depend on account age, an empty profile, saved preferences, or the browser's language. A new account with no settings is still US dollars by default.`;

const NUMBER = String.raw`(?<num>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<dec>\d+))?`;

const ISO_UNIT = {
  USD: 'dollars',
  GBP: 'pounds',
  EUR: 'euros',
  CAD: 'Canadian dollars',
  AUD: 'Australian dollars',
  NZD: 'New Zealand dollars',
};

const PREFIX_UNIT = {
  AU: 'Australian dollars',
  A: 'Australian dollars',
  CA: 'Canadian dollars',
  C: 'Canadian dollars',
  NZ: 'New Zealand dollars',
  HK: 'Hong Kong dollars',
  NT: 'New Taiwan dollars',
  S: 'Singapore dollars',
};

// Whole-word real-estate abbreviations the British TTS voice reads as
// nonsense or as the wrong word (ROI as "roy", NOI as "noy", MAO as a name).
// Longer tokens first. Word boundaries keep HARVARD, CARVING, NOISE, and
// MAOIST intact. ARIS is intentionally absent.
const ABBREVIATIONS = [
  ['DSCRs', 'debt-service coverage ratios'],
  ['DSCR', 'debt-service coverage ratio'],
  ['DCRs', 'debt coverage ratios'],
  ['DCR', 'debt coverage ratio'],
  ['ARVs', 'after-repair values'],
  ['ARV', 'after-repair value'],
  ['MAOs', 'maximum allowable offers'],
  ['MAO', 'maximum allowable offer'],
  ['LTVs', 'loan-to-values'],
  ['LTV', 'loan-to-value'],
  ['LTCs', 'loan-to-costs'],
  ['LTC', 'loan-to-cost'],
  ['ROIs', 'returns on investment'],
  ['ROI', 'return on investment'],
  ['NOIs', 'net operating incomes'],
  ['NOI', 'net operating income'],
];

const FOREIGN_DETECTORS = [
  { code: 'GBP', re: /£|\bGBP\b|pounds?\s+sterling|\bBritish\s+pounds?\b|\bUK\s+pounds?\b|\bin\s+pounds\b|\bUnited\s+Kingdom\b|\bGreat\s+Britain\b|\bNorthern\s+Ireland\b|\bUK\b/i },
  { code: 'EUR', re: /€|\bEUR\b|\beuros?\b/i },
  { code: 'CAD', re: /\bCAD\b|(?<![\p{L}])CA\$|(?<![\p{L}])C\$|\bCanadian\s+dollars?\b|\bCanada\b|\bCanadian\b/iu },
  { code: 'AUD', re: /\bAUD\b|(?<![\p{L}])AU\$|(?<![\p{L}])A\$|\bAustralian\s+dollars?\b|\bAustralia\b|\bAustralian\b/iu },
  { code: 'NZD', re: /\bNZD\b|(?<![\p{L}])NZ\$|\bNew\s+Zealand\b/iu },
];

function contentToString(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block.text === 'string') return block.text;
      return '';
    }).join('\n');
  }
  return '';
}

function detectForeignCodes(text) {
  const found = [];
  for (const detector of FOREIGN_DETECTORS) {
    if (detector.re.test(text) && !found.includes(detector.code)) found.push(detector.code);
  }
  return found;
}

// Profile, preferences, and browser locale are accepted and ignored.
// Currency follows the member's words, newest user message first.
// Assistant text is ignored so an earlier mistaken "pounds" does not
// stick for the rest of the session.
export function analysisCurrencyInstruction(opts = {}) {
  const segments = [];
  if (Array.isArray(opts.messages)) {
    for (const message of opts.messages) {
      if (message && message.role === 'user') segments.push(contentToString(message.content));
    }
  } else if (typeof opts.text === 'string') {
    segments.push(opts.text);
  }

  let codes = [];
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const found = detectForeignCodes(segments[i]);
    if (found.length) {
      codes = found;
      break;
    }
  }

  if (!codes.length) {
    return `${CURRENCY_RULE}\nNo non-US currency was requested. Use US dollars for this analysis.`;
  }
  return `${CURRENCY_RULE}\nThe member explicitly used ${codes.join(', ')}. Keep each amount they gave in that currency. Do not convert it and do not relabel it as dollars. Amounts written with $ or USD stay US dollars. If they did not give a figure in ${codes.join(', ')}, do not switch the US figures to that currency.`;
}

// Same rounding and "$" prefix the Deal Analyzer has always used, with
// en-US grouping so a browser set to en-GB or de-DE cannot change the
// written form. The number is not converted from another currency.
export function formatUsd(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '$0';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function stripMarkdownForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

function maskProtected(text) {
  const slots = [];
  const re = /https?:\/\/[^\s<>]+|www\.[^\s<>]+|<\/?[a-zA-Z][^>\n]*>|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/g;
  const masked = text.replace(re, (match) => {
    const token = `\uE000${slots.length}\uE001`;
    slots.push(match);
    return token;
  });
  return { masked, slots };
}

function unmask(text, slots) {
  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => slots[Number(index)] ?? '');
}

function amount(groups) {
  if (!groups || groups.num == null) return null;
  return groups.dec != null && groups.dec !== '' ? `${groups.num}.${groups.dec}` : groups.num;
}

function isNegative(groups) {
  return Boolean(groups && (groups.sign || groups.sign2));
}

// The symbol or code becomes a number plus a unit. pronounceNumbers
// spells that number later, after state names are chosen, so a ZIP is
// still digits while "TX 78701" is resolved.
function spell(groups, unit) {
  const num = amount(groups);
  if (num == null) return null;
  return `${isNegative(groups) ? 'negative ' : ''}${num} ${unit}`;
}

function replaceNamed(text, regex, unitFor) {
  return text.replace(regex, (match, ...rest) => {
    const groups = rest[rest.length - 1];
    const unit = typeof unitFor === 'function' ? unitFor(groups, match) : unitFor;
    if (!unit) return match;
    const spoken = spell(groups, unit);
    return spoken == null ? match : spoken;
  });
}

// The minus, when present, may have a space after it ("- $100").
// A space before the symbol is not consumed, so "rate = $100" keeps the space.
const OPEN_SIGN = String.raw`(?<![\p{L}\d])(?<sign>[-−]\s*)?`;
const SIGN2 = String.raw`\s*(?<sign2>[-−]\s*)?`;

function symbolPattern(symbol, { trail = false } = {}) {
  const trailSrc = trail ? String.raw`(?:\s+(?<trail>pounds?|quid|dollars?))?` : '';
  return new RegExp(`${OPEN_SIGN}${symbol}${SIGN2}${NUMBER}${trailSrc}`, 'giu');
}

function normalizeCurrency(text) {
  let out = text;

  // Parentheses are left in place. "($315,000)" in prose is a parenthetical
  // amount, not an accounting loss. A minus sign marks a negative.
  out = replaceNamed(
    out,
    symbolPattern(String.raw`(?<prefix>AU|CA|NZ|HK|NT|A|C|S)\$`),
    (groups) => PREFIX_UNIT[(groups.prefix || '').toUpperCase()]
  );

  out = replaceNamed(out, symbolPattern('£', { trail: true }), 'pounds');
  out = replaceNamed(out, symbolPattern('€'), 'euros');

  out = replaceNamed(
    out,
    new RegExp(String.raw`\b(?<code>USD|GBP|EUR|CAD|AUD|NZD)\s*\$?\s*(?<sign>[-−]\s*)?${NUMBER}`, 'giu'),
    (groups) => ISO_UNIT[(groups.code || '').toUpperCase()]
  );
  // Optional $ is included so "$185,000 GBP" follows the explicit code.
  // The digits are not converted. Bare "$185,000" is not matched here.
  out = replaceNamed(
    out,
    new RegExp(String.raw`(?<![\p{L}\d])(?<sign>[-−]\s*)?(?:\$\s*)?(?<sign2>[-−]\s*)?${NUMBER}\s*(?<code>USD|GBP|EUR|CAD|AUD|NZD)\b`, 'giu'),
    (groups) => ISO_UNIT[(groups.code || '').toUpperCase()]
  );
  out = replaceNamed(out, symbolPattern(String.raw`US\$`), 'dollars');
  out = replaceNamed(out, symbolPattern(String.raw`\$`, { trail: true }), 'dollars');
  return out;
}

function expandAbbreviations(text) {
  let out = text;
  for (const [abbr, phrase] of ABBREVIATIONS) {
    out = out.replace(new RegExp(String.raw`\b${abbr}\b`, 'gi'), phrase);
  }
  out = out.replace(/\bcap rates\b/gi, 'capitalization rates');
  out = out.replace(/\bcap rate\b/gi, 'capitalization rate');
  return out;
}

// Spoken names for the 50 states and DC. The chat on screen keeps the
// postal abbreviation; only the ElevenLabs text is rewritten.
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

// Two-letter tokens that are also ordinary words, directionals, street
// suffixes, or other abbreviations. These become a state name only with a
// place cue (city/state, address, ZIP, or a market phrase). Bare "OR",
// "IN", "OK", "The AR", and "et al" stay as written.
const CONTEXT_ONLY = new Set([
  'AR', 'CO', 'CT', 'DE', 'HI', 'ID', 'IN', 'LA', 'MA', 'MD', 'ME', 'NE', 'OH', 'OK', 'OR', 'PA', 'WA',
]);

// "LA market" and "in LA" are Los Angeles in this product, not Louisiana.
// "in ME" is usually the pronoun. Louisiana and Maine still expand from
// "New Orleans, LA" / "Portland, ME" and from a confirming ZIP.
const NO_MARKET = new Set(['LA']);
const NO_PREPOSITION = new Set(['LA', 'ME']);

// Last word before a comma when that word is not a city. "Sounds good, OK",
// "WATCH, OR AVOID", "the South, IN particular", "cap rate, OR NOI".
const DISCOURSE = new Set(`
  a an and or nor but ok okay hi hello hey thanks thank yes no well so wait please
  also fine good great right sure wow cool nice perfect exactly absolutely agreed
  noted ready done watch buy avoid go caution proceed me oh dr mr mrs ms miss prof
  md st vs versus plus then that this it if is be we my do up at to of on by as the
  for from with not just very really too into over under than out off all any can
  may let see now here there what when your our its help look listen sorry dear
  folks team everyone guys sir buddy friend note warning tip remember however
  therefore instead otherwise anyway alright call stop
  north south east west
  rate rates ratio ratios income coverage offer offers spread cash flow profit loss
  cap loan loans return returns value values dollar dollars pound pounds percent
`.split(/\s+/).filter(Boolean));

// USPS 3-digit ZIP prefixes. Confirmation only: an unknown or border ZIP
// does not block an unambiguous abbreviation such as TX. DC is 200 and
// 202–205; 201 is Virginia.
const ZIP_PREFIX_RANGES = [
  ['AK', 995, 999], ['AL', 350, 369], ['AR', 716, 729], ['AZ', 850, 865],
  ['CA', 900, 961], ['CO', 800, 816], ['CT', 60, 69],
  ['DC', 200, 200], ['DC', 202, 205], ['DE', 197, 199],
  ['FL', 320, 349], ['GA', 300, 319], ['GA', 398, 399],
  ['HI', 967, 968], ['IA', 500, 528], ['ID', 832, 838], ['IL', 600, 629],
  ['IN', 460, 479], ['KS', 660, 679], ['KY', 400, 427], ['LA', 700, 714],
  ['MA', 10, 27], ['MA', 55, 55], ['MD', 206, 219], ['ME', 39, 49],
  ['MI', 480, 499], ['MN', 550, 567], ['MO', 630, 658], ['MS', 386, 397],
  ['MT', 590, 599], ['NC', 270, 289], ['ND', 580, 588], ['NE', 680, 693],
  ['NH', 30, 38], ['NJ', 70, 89], ['NM', 870, 884], ['NV', 889, 898],
  ['NY', 5, 5], ['NY', 100, 149], ['OH', 430, 459], ['OK', 730, 749],
  ['OR', 970, 979], ['PA', 150, 196], ['RI', 28, 29], ['SC', 290, 299],
  ['SD', 570, 577], ['TN', 370, 385], ['TX', 750, 799], ['TX', 885, 885],
  ['UT', 840, 847], ['VA', 201, 201], ['VA', 220, 246],
  ['VT', 50, 54], ['VT', 56, 59], ['WA', 980, 994], ['WI', 530, 549],
  ['WV', 247, 268], ['WY', 820, 831],
];

const STREET_RE = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.'’\-]+\s+){0,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|terrace|ter|circle|cir|highway|hwy|parkway|pkwy|trail|trl)\b/i;

function zipPrefixState(zip) {
  const n = Number(zip.slice(0, 3));
  for (const [code, lo, hi] of ZIP_PREFIX_RANGES) {
    if (n >= lo && n <= hi) return code;
  }
  return null;
}

function followingZip(text, end) {
  const m = text.slice(end).match(/^\s+(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

function zipConflicts(text, end, code) {
  const zip = followingZip(text, end);
  if (!zip) return false;
  const owner = zipPrefixState(zip);
  return owner != null && owner !== code;
}

function zipConfirms(text, start, end, code) {
  const zip = followingZip(text, end);
  if (!zip || zipPrefixState(zip) !== code) return false;
  const before = text.slice(0, start);
  const comma = /,\s*$/.test(before);
  // "100 NE 45th" and "123 Oak CT" are a directional and a court, not a state,
  // even when the next number happens to be five digits.
  if (code === 'NE' && !comma && /\d\s+$/.test(before)) return false;
  if (code === 'CT' && !comma && /\d/.test(before.slice(-48))) return false;
  // "property ID 83702" is an identifier. "Boise, ID 83702" is Idaho.
  if (code === 'ID' && !comma) {
    const prev = before.match(/([A-Za-z][A-Za-z.'’\-]*)\s+$/);
    if (!prev) return false;
    const word = prev[1].replace(/\./g, '');
    // "property ID 83702" is an identifier. "Boise ID 83702" is still Idaho.
    if (word.toLowerCase() === 'property') return false;
    if (word.length < 3 || !/[A-Z]/.test(word) || DISCOURSE.has(word.toLowerCase())) return false;
  }
  return true;
}

function introducesPlace(text, end) {
  return /^\s+[A-Z][a-zA-Z.'’\-]{2,}/.test(text.slice(end));
}

// "in" as a word: "in my view", "in order", "in fact". A city/state pair
// is "South Bend, IN" or "South Bend, IN is", which does not use these.
const IN_AS_WORD = new Set(`
  my your his her their our its this that particular general fact order addition
  contrast turn short brief other practice theory reality effect terms part which
  whom whose most many such
`.split(/\s+/).filter(Boolean));

function inWordFollower(text, end) {
  const m = text.slice(end).match(/^\s+([A-Za-z]+)/);
  return Boolean(m && IN_AS_WORD.has(m[1].toLowerCase()));
}

function prepositionCue(text, start) {
  return /(?:\b(?:in|across|throughout|inside|outside|near|around|within|into)\s+)$/i.test(text.slice(0, start));
}

function stateOfCue(text, start) {
  return /\bstate\s+of\s+$/i.test(text.slice(0, start));
}

function marketCue(text, start, end) {
  if (/^\s+(?:markets?|metro|metros|area)\b/i.test(text.slice(end))) return true;
  return /\b(?:markets?|metro)\s+(?:in|of)\s+$/i.test(text.slice(0, start));
}

function commaPlace(text, start) {
  const before = text.slice(0, start);
  const m = before.match(/([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,4})\s*,\s*$/);
  if (!m) return false;
  const words = m[1].split(/\s+/);
  const last = words[words.length - 1].replace(/\./g, '');
  if (last.length < 3) return false;
  if (DISCOURSE.has(last.toLowerCase())) return false;
  if (/^[A-Z]{2}$/.test(last) && STATE_NAMES[last]) return false;
  if (/[A-Z]/.test(last)) return true;
  return STREET_RE.test(before);
}

function shouldExpandState(text, start, end, raw, code) {
  const allUpper = raw === code;
  const allLower = raw === code.toLowerCase();
  const titled = raw[0] === code[0] && raw[1] === code[1].toLowerCase();
  if (!allUpper && !allLower && !titled) return false;
  // "in", "or", "me", "ok" are words. "IN" and "Or" can still be states.
  if (allLower && CONTEXT_ONLY.has(code)) return false;
  if (code === 'AL' && /\bet\s+$/i.test(text.slice(0, start))) return false;
  if (code === 'LA' && /Los\s+Angeles\s*,\s*$/i.test(text.slice(0, start))) return false;
  if (CONTEXT_ONLY.has(code) && zipConflicts(text, end, code)) return false;

  if (allUpper && zipConfirms(text, start, end, code)) return true;

  // "Phoenix, AZ, OR Dallas" is the word or, not Oregon.
  // "IN my view" and "IN order" are the word in, not Indiana.
  // "South Bend, IN" has neither cue and still expands below.
  const joiningPlaces = (code === 'OR' || code === 'IN') && introducesPlace(text, end);
  const inAsWord = code === 'IN' && inWordFollower(text, end);
  const holdAmbiguous = joiningPlaces || inAsWord;
  if (!holdAmbiguous && !NO_MARKET.has(code) && marketCue(text, start, end)) return true;
  if (!holdAmbiguous && !NO_PREPOSITION.has(code) && prepositionCue(text, start)) return true;
  if (stateOfCue(text, start)) return true;
  if (!holdAmbiguous && commaPlace(text, start)) return true;
  if (allUpper && !CONTEXT_ONLY.has(code)) return true;
  return false;
}

function expandStateAbbreviations(text) {
  // "Washington, D.C." is the same postal abbreviation as DC. Leave "D.C.A" alone.
  const prepared = text.replace(/D\.C\.(?![A-Za-z])|D\.C(?![A-Za-z.])/g, 'District of Columbia');
  const re = /\b([A-Za-z]{2})\b/g;
  let out = '';
  let last = 0;
  for (const match of prepared.matchAll(re)) {
    const raw = match[1];
    const code = raw.toUpperCase();
    const name = STATE_NAMES[code];
    if (!name) continue;
    const start = match.index;
    const end = start + raw.length;
    if (!shouldExpandState(prepared, start, end, raw, code)) continue;
    out += prepared.slice(last, start) + name;
    last = end;
  }
  out += prepared.slice(last);
  return out;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
const DIGIT_OH = ['oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const DIGIT_ZERO = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Longest first so "Canadian dollars" wins over "dollars".
const SPOKEN_UNITS = [
  'New Zealand dollars',
  'Australian dollars',
  'Hong Kong dollars',
  'New Taiwan dollars',
  'Singapore dollars',
  'Canadian dollars',
  'dollars',
  'pounds',
  'euros',
];

const RATIO_TERMS = [
  'debt-service coverage ratios',
  'debt-service coverage ratio',
  'debt coverage ratios',
  'debt coverage ratio',
  'after-repair values',
  'after-repair value',
  'maximum allowable offers',
  'maximum allowable offer',
  'loan-to-values',
  'loan-to-value',
  'loan-to-costs',
  'loan-to-cost',
  'returns on investment',
  'return on investment',
  'net operating incomes',
  'net operating income',
  'capitalization rates',
  'capitalization rate',
];

const STREET_TAIL = String.raw`(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+)?(?:[A-Za-z0-9.'’\-]+\s+){0,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|terrace|ter|circle|cir|highway|hwy|parkway|pkwy|trail|trl)\b`;
const ORDINAL_STREET_TAIL = String.raw`(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+\d{1,4}(?:st|nd|rd|th)\b`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten];
}

function threeDigitWords(n) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundred) return twoDigitWords(rest);
  if (!rest) return `${ONES[hundred]} hundred`;
  return `${ONES[hundred]} hundred ${twoDigitWords(rest)}`;
}

// American conversational form. No "and" inside the number.
function integerToWords(raw) {
  const digits = String(raw).replace(/[^\d]/g, '').replace(/^0+/, '');
  if (!digits) return 'zero';
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) {
    groups.push(digits.slice(Math.max(0, i - 3), i));
  }
  if (groups.length > SCALES.length) return null;
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const n = Number(groups[i]);
    if (!n) continue;
    const scale = SCALES[i];
    parts.push(scale ? `${threeDigitWords(n)} ${scale}` : threeDigitWords(n));
  }
  return parts.join(' ');
}

function speakDigits(digits) {
  return [...digits].map((digit) => DIGIT_OH[digit]).join(' ');
}

function speakPointDigits(digits) {
  return [...digits].map((digit) => DIGIT_ZERO[digit]).join(' ');
}

function canonicalUnit(captured) {
  const lower = captured.toLowerCase();
  return SPOKEN_UNITS.find((unit) => unit.toLowerCase() === lower) || captured;
}

function singularUnit(unit) {
  if (unit.endsWith('dollars')) return unit.slice(0, -1);
  if (unit === 'pounds') return 'pound';
  if (unit === 'euros') return 'euro';
  return unit;
}

function minorUnit(unit, count) {
  const lower = unit.toLowerCase();
  if (lower.endsWith('dollar') || lower.endsWith('dollars') || lower === 'euro' || lower === 'euros') {
    return count === 1 ? 'cent' : 'cents';
  }
  if (lower === 'pound' || lower === 'pounds') return count === 1 ? 'penny' : 'pence';
  return null;
}

function centsFrom(dec) {
  const digits = `${dec}000`.slice(0, 3);
  let cents = Number(digits.slice(0, 2));
  if (digits[2] >= '5') cents += 1;
  return cents;
}

function incrementDigits(raw) {
  const chars = String(raw).replace(/[^\d]/g, '').replace(/^0+/, '').split('');
  if (!chars.length) return '1';
  let carry = 1;
  for (let i = chars.length - 1; i >= 0 && carry; i -= 1) {
    const sum = (chars[i].charCodeAt(0) - 48) + carry;
    chars[i] = String(sum % 10);
    carry = sum >= 10 ? 1 : 0;
  }
  if (carry) chars.unshift('1');
  return chars.join('');
}

function speakMoney(prefix, intPart, decPart, unit) {
  const canonical = canonicalUnit(unit);
  let digits = String(intPart).replace(/[^\d]/g, '');
  let cents = null;
  if (decPart && minorUnit(canonical, 2)) {
    cents = centsFrom(decPart);
    if (cents >= 100) {
      digits = incrementDigits(digits);
      cents -= 100;
    }
  }
  const words = integerToWords(digits);
  if (!words) return null;
  const spokenUnit = /^0*1$/.test(digits) ? singularUnit(canonical) : canonical;
  let spoken = `${prefix || ''}${words} ${spokenUnit}`;
  if (cents) {
    const centWords = integerToWords(String(cents));
    spoken += ` and ${centWords} ${minorUnit(canonical, cents)}`;
  }
  return spoken;
}

function speakPlainNumber(intPart, decPart) {
  const words = integerToWords(intPart);
  if (!words) return null;
  if (!decPart) return words;
  return `${words} point ${speakPointDigits(decPart)}`;
}

function speakRatio(num) {
  const [intPart, decPart] = String(num).split('.');
  const words = integerToWords(intPart);
  if (!words || decPart == null || decPart === '') return null;
  return `${words} point ${speakPointDigits(decPart)}`;
}

function speakPercent(intPart, decPart) {
  const words = integerToWords(intPart);
  if (!words) return null;
  const trimmed = decPart ? String(decPart).replace(/0+$/, '') : '';
  if (!trimmed) return `${words} percent`;
  return `${words} point ${speakPointDigits(trimmed)} percent`;
}

function speakPhone(match) {
  const digits = match.replace(/\D/g, '');
  let parts;
  if (digits.length === 11 && digits.startsWith('1')) {
    parts = [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7)];
  } else if (digits.length === 10) {
    parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  } else {
    return null;
  }
  return parts.map(speakDigits).join(', ');
}

function streetNumberFollows(text, end) {
  const rest = text.slice(end);
  if (new RegExp(String.raw`^\s+${STREET_TAIL}`, 'i').test(rest)) return true;
  return new RegExp(String.raw`^\s+${ORDINAL_STREET_TAIL}`, 'i').test(rest);
}

// Skip digits that are only the index inside a protected-span token.
function replaceGuarded(text, regex, replacer) {
  return text.replace(regex, (...args) => {
    const match = args[0];
    const offset = args[args.length - 2];
    const source = args[args.length - 1];
    if (typeof offset !== 'number' || typeof source !== 'string') return match;
    if (source[offset - 1] === '\uE000') return match;
    const next = replacer(args, offset, source);
    return next == null ? match : next;
  });
}

// Phones first so a grouped number cannot be read as a quantity
// ("555-123-4567" must not become "five hundred fifty-five...").
function pronouncePhones(text) {
  const re = /(?<![\p{L}\d])(?:\+?1[\s.-]\s*)?(?:\(\s*\d{3}\s*\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\p{L}\d])/gu;
  return replaceGuarded(text, re, (args) => speakPhone(args[0]));
}

function pronouncePropertyIds(text) {
  const units = SPOKEN_UNITS.map(escapeRegExp).join('|');
  const re = new RegExp(
    String.raw`\b((?:property\s+)?)(ID)\s+(\d+)\b(?!\s+(?:${units})\b)`,
    'giu'
  );
  return replaceGuarded(text, re, (args) => `${args[1]}${args[2]} ${speakDigits(args[3])}`);
}

function pronounceMoney(text) {
  const units = SPOKEN_UNITS.map(escapeRegExp).join('|');
  const re = new RegExp(
    String.raw`(?<![\p{L}\d.,])((?:negative)\s+)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s+(${units})\b`,
    'giu'
  );
  return replaceGuarded(text, re, (args) => speakMoney(args[1], args[2], args[3], args[4]));
}

function pronouncePercents(text) {
  const re = /(?<![\p{L}\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*%/gu;
  return replaceGuarded(text, re, (args) => speakPercent(args[1], args[2]));
}

function pronounceRatios(text) {
  const term = RATIO_TERMS.join('|');
  const units = SPOKEN_UNITS.map(escapeRegExp).join('|');
  const after = new RegExp(
    String.raw`\b(${term})\b(\s*(?:=|of|is|:)?\s*)(\d{1,3}\.\d{1,4})\b(?!\s+(?:${units})\b)`,
    'giu'
  );
  const before = new RegExp(
    String.raw`(?<![\p{L}\d.,])(\d{1,3}\.\d{1,4})\b(\s+)(?=(?:${term})\b)`,
    'giu'
  );
  const withTermFirst = replaceGuarded(text, after, (args) => {
    const spoken = speakRatio(args[3]);
    return spoken == null ? null : `${args[1]}${args[2]}${spoken}`;
  });
  return replaceGuarded(withTermFirst, before, (args) => {
    const spoken = speakRatio(args[1]);
    return spoken == null ? null : `${spoken}${args[2]}`;
  });
}

function pronounceZips(text) {
  const re = /(?<![\p{L}\d.])(\d{5})(?:-(\d{4}))?(?![\p{L}\d])/gu;
  return replaceGuarded(text, re, (args, offset) => {
    const end = offset + args[0].length;
    const source = args[args.length - 1];
    if (streetNumberFollows(source, end)) return null;
    const spoken = speakDigits(args[1]);
    return args[2] ? `${spoken}, ${speakDigits(args[2])}` : spoken;
  });
}

function pronounceCommaNumbers(text) {
  const units = SPOKEN_UNITS.map(escapeRegExp).join('|');
  const re = new RegExp(
    String.raw`(?<![\p{L}\d.,])([-−]\s*)?(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(?![\p{L}\d])(?!\s+(?:${units})\b)`,
    'gu'
  );
  return replaceGuarded(text, re, (args, offset) => {
    const source = args[args.length - 1];
    if (streetNumberFollows(source, offset + args[0].length)) return null;
    const words = speakPlainNumber(args[2], args[3]);
    if (!words) return null;
    return `${args[1] ? 'negative ' : ''}${words}`;
  });
}

// Runs after state expansion. ZIPs must still be digits until a postal
// abbreviation has been confirmed; phones are rewritten before any
// amount so a hyphenated number is not read as hundreds or thousands.
function pronounceNumbers(text) {
  let out = pronouncePhones(text);
  out = pronouncePropertyIds(out);
  out = pronounceMoney(out);
  out = pronouncePercents(out);
  out = pronounceRatios(out);
  out = pronounceZips(out);
  out = pronounceCommaNumbers(out);
  return out;
}

export function normalizeSpeechText(raw) {
  const stripped = stripMarkdownForSpeech(raw);
  if (!stripped) return '';
  const { masked, slots } = maskProtected(stripped);
  const normalized = expandStateAbbreviations(expandAbbreviations(normalizeCurrency(masked)));
  return unmask(pronounceNumbers(normalized), slots);
}

export function prepareSpeechText(raw, limit = SPEECH_CHAR_LIMIT) {
  const full = normalizeSpeechText(raw);
  if (full.length <= limit) return full;
  const cut = full.lastIndexOf(' ', limit);
  const end = cut > Math.floor(limit * 0.5) ? cut : limit;
  return full.slice(0, end).trim();
}
