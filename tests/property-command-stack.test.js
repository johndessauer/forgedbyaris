// Leaflet panes use z-index 200 through 1000. The command center has to
// stay above the map on desktop and mobile, which only holds if those
// panes are trapped inside the map.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the property search map cannot paint over the command center', () => {
  const page = fs.readFileSync(path.join(__dirname, '../property-search.html'), 'utf8');
  const command = fs.readFileSync(path.join(__dirname, '../assets/js/property-command.js'), 'utf8');
  const wrap = page.match(/\.ps-map-wrap\s*\{[^}]*\}/);
  assert.ok(wrap, 'map wrap rule missing');
  assert.match(wrap[0], /isolation:\s*isolate/);
  assert.match(wrap[0], /z-index:\s*0/);
  const drawer = command.match(/\.pcc\{[^}]*z-index:\s*(\d+)/);
  assert.ok(drawer, 'command center z-index missing');
  const z = Number(drawer[1]);
  assert.ok(z > 1000, 'drawer z-index ' + z + ' is not above Leaflet controls (1000)');
  assert.ok(z < 1100, 'drawer z-index ' + z + ' would cover the comp panel');
});
