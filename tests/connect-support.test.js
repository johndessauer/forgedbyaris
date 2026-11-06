const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('homepage support lives under Connect, with no corner launchers', () => {
  const index = read('index.html');
  const site = read('assets/site.js');
  const css = read('assets/sales-chat.css');
  assert.match(index, /id="navConnectBtn"/);
  assert.match(index, /aria-haspopup="menu"/);
  assert.match(site, /ArrowDown/);
  assert.match(site, /focusItem\(0\)/);
  assert.match(index, />Connect /);
  assert.match(index, /id="navAskAris"/);
  assert.match(index, /id="navSupportChat"/);
  assert.match(index, /id="salesChatPanel"/);
  assert.doesNotMatch(index, /id="salesChatToggle"/);
  assert.doesNotMatch(index, /id="navContactChat"/);
  assert.doesNotMatch(index, /Ask ARIS<\/span>/);
  assert.match(site, /button\.lc_text-widget--bubble/);
  assert.match(site, /\.lc_text-widget--prompt/);
  assert.match(site, /openWidget/);
  assert.match(site, /navSupportChat/);
  assert.match(site, /navAskAris/);
  assert.doesNotMatch(css, /sales-chat__toggle/);
  assert.doesNotMatch(css, /\.sales-chat \{ position: fixed/);
});
