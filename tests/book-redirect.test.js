// /book 302s to the Chris/Eddie/Ian round-robin widget. The edge function
// keeps the original query and adds standard UTM keys GHL will store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function loadBook() {
  return import('../netlify/edge-functions/book.js');
}

test('/book is an edge redirect, not a static query-forwarding rule', async () => {
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  const blocks = toml.split('[[redirects]]').slice(1);
  const book = blocks.find((block) => /^\s*from\s*=\s*"\/book\/?"/m.test(block));
  assert.equal(book, undefined);
  const edge = fs.readFileSync(path.join(root, 'netlify/edge-functions/book.js'), 'utf8');
  assert.match(edge, /path:\s*\['\/book', '\/book\/'\]/);
  assert.match(edge, /status:\s*302/);
  const { WIDGET } = await loadBook();
  const site = fs.readFileSync(path.join(root, 'assets/site.js'), 'utf8');
  assert.ok(site.includes(`DEMO_URL: '${WIDGET}'`));
});

test('bare /book has no query string', async () => {
  const { WIDGET, bookLocation } = await loadBook();
  assert.equal(bookLocation(''), WIDGET);
  assert.equal(bookLocation('?'), WIDGET);
});

test('src and ref become utm_source and utm_content, and a newsletter day is email', async () => {
  const { WIDGET, bookLocation } = await loadBook();
  assert.equal(
    bookLocation('?src=new-leads&ref=nl-d1'),
    WIDGET + '?src=new-leads&ref=nl-d1&utm_source=new-leads&utm_content=nl-d1&utm_medium=email'
  );
});

test('a text ref sets utm_medium to sms', async () => {
  const { WIDGET, bookLocation } = await loadBook();
  assert.equal(
    bookLocation('?src=new-leads&ref=nl-d5-sms'),
    WIDGET + '?src=new-leads&ref=nl-d5-sms&utm_source=new-leads&utm_content=nl-d5-sms&utm_medium=sms'
  );
});

test('src alone does not invent a medium', async () => {
  const { WIDGET, bookLocation } = await loadBook();
  assert.equal(bookLocation('?src=rs-list'), WIDGET + '?src=rs-list&utm_source=rs-list');
});

test('existing utm values are kept and copied values are sanitized', async () => {
  const { bookLocation } = await loadBook();
  const params = new URL(bookLocation('?src=New Leads!&ref=nl-d1-sms&utm_source=kept&utm_medium=cpc')).searchParams;
  assert.equal(params.get('src'), 'New Leads!');
  assert.equal(params.get('ref'), 'nl-d1-sms');
  assert.equal(params.get('utm_source'), 'kept');
  assert.equal(params.get('utm_content'), 'nl-d1-sms');
  assert.equal(params.get('utm_medium'), 'cpc');
});
