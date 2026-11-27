// Talk Mode sometimes clips the first syllable of "ARIS", and the
// transcript comes back as Iris, Harris, Aris, Aries, Arras, Ris, or
// Eris. Fix that only at the start of the utterance (after a short
// greeting). Leave "Harris County" and any later use of those words
// alone so a real place name is not rewritten.

const MISHEARD = {
  iris: 'ARIS',
  harris: 'ARIS',
  aris: 'ARIS',
  aries: 'ARIS',
  arras: 'ARIS',
  ris: 'ARIS',
  eris: 'ARIS',
};

const GREETING = new Set(['hey', 'hi', 'hello', 'ok', 'okay', 'yo', 'um', 'uh', 'so', 'well', 'ah', 'oh']);
const BLOCK_NEXT = new Set(['county', 'teeter']);

function core(word) {
  const match = String(word || '').match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
  if (!match) return null;
  return { lead: match[1], letters: match[2], tail: match[3] };
}

export function normalizeHeardName(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const words = raw.split(/\s+/);
  let index = 0;
  let skipped = 0;
  while (index < words.length && skipped < 2) {
    const part = core(words[index]);
    if (!part || !GREETING.has(part.letters.toLowerCase())) break;
    index += 1;
    skipped += 1;
  }
  if (index >= words.length) return raw;
  const part = core(words[index]);
  if (!part) return raw;
  if (!MISHEARD[part.letters.toLowerCase()]) return raw;
  const next = words[index + 1] ? core(words[index + 1]) : null;
  if (next && BLOCK_NEXT.has(next.letters.toLowerCase())) return raw;
  words[index] = `${part.lead}ARIS${part.tail}`;
  return words.join(' ');
}
