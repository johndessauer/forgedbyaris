// /book is a short redirect to the Chris/Eddie/Ian round-robin widget.
// DEMO_URL stays on that same URL; this test only locks the Netlify rule
// that makes forgedbyaris.com/book reach it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BOOK_URL = 'https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx';
const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function redirectBlock(toml, from) {
  const blocks = toml.split('[[redirects]]').slice(1);
  return blocks.find((block) => {
    const fromLine = block.match(/^\s*from\s*=\s*"([^"]+)"/m);
    return fromLine && fromLine[1] === from;
  });
}

test('/book 302s to the Chris/Eddie/Ian round-robin widget', () => {
  const toml = read('netlify.toml');
  const block = redirectBlock(toml, '/book');
  assert.ok(block, 'netlify.toml is missing a /book redirect');

  assert.ok(block.includes(`to = "${BOOK_URL}"`), block);
  assert.match(block, /status = 302/);
  assert.match(block, /force = true/);
  // A query condition matches only the listed params. Leaving it unset is
  // what makes Netlify forward the rest (for example ?ref=blog).
  assert.equal(/^\s*query\s*=/m.test(block), false);
  assert.equal(block.includes('?'), false, 'the destination must not replace the incoming query string');

  // One rule covers /book and /book/. A second rule between those two
  // paths is an infinite redirect under Netlify's slash normalization.
  assert.equal(redirectBlock(toml, '/book/'), undefined);
});

test('DEMO_URL stays on the same round-robin widget', () => {
  const site = read('assets/site.js');
  assert.ok(site.includes(`DEMO_URL: '${BOOK_URL}'`));
});
