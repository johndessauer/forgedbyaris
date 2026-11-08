// Currency rule for one-shot ARIS completions.
//
// This is the CommonJS copy that netlify/functions/aris-quote.js can
// require(). The edge runtime cannot load this file; it keeps the same
// rule in netlify/edge-functions/lib/speech-text.js. tests/aris-quote.test.js
// fails if the two instructions diverge.

const CURRENCY_RULE = `CURRENCY AND UNITS:
FORGE property and market figures are United States dollars unless the member explicitly places the property outside the United States or names another currency (for example GBP, pounds sterling, EUR, CAD, or AUD).
- For a US property, or when no country or currency was named, write US dollars with $ or the word "dollars". Do not say "pounds" and do not use £.
- If the member explicitly supplies a non-US currency, keep that amount in that currency. Do not convert it, and do not relabel it as dollars or change its number.
- $ or USD marks US dollars. £, GBP, or pounds sterling marks pounds. Never swap those symbols or words in a way that presents one currency as the other.
- Percentages, cap rates, ratios, and calculated results stay in the units given.
- This does not depend on account age, an empty profile, saved preferences, or the browser's language. A new account with no settings is still US dollars by default.`;

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

function analysisCurrencyInstruction(opts = {}) {
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

module.exports = { analysisCurrencyInstruction };
