const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const schedule = require('../assets/js/webinar-schedule');
const reg = require('../netlify/functions/_Lib/webinar-register');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('approved cadence is Tuesdays at 8 PM CT, with Monday Nov 30 instead of Dec 1', () => {
  assert.deepEqual(schedule.DATES, [
    '2026-11-17',
    '2026-11-24',
    '2026-11-30',
    '2026-12-08',
    '2026-12-15',
    '2027-01-05',
  ]);
  assert.equal(schedule.DATES.includes('2026-12-01'), false);
  assert.equal(schedule.TIME_LABEL, '8:00 PM CT');
  assert.equal(schedule.TIME_ZONE, 'America/Chicago');
  const weekdays = schedule.sessions().map((s) => s.weekday);
  assert.deepEqual(weekdays, ['Tuesday', 'Tuesday', 'Monday', 'Tuesday', 'Tuesday', 'Tuesday']);
  assert.equal(schedule.weekdayOf('2026-12-01'), 'Tuesday');
  // 8:00 PM CST (UTC-6) after the November DST change.
  assert.equal(schedule.sessions()[0].startsAt.toISOString(), '2026-11-18T02:00:00.000Z');
  assert.equal(schedule.sessions()[2].startsAt.toISOString(), '2026-12-01T02:00:00.000Z');
});

test('registration default date and time come from the same schedule', () => {
  assert.equal(reg.DEFAULT_DATE, schedule.FIRST_DATE);
  assert.equal(reg.DEFAULT_TIME, schedule.TIME_LABEL);
  assert.equal(reg.DEFAULT_DATE, '2026-11-17');
});

test('banner names the Nov 17 start, then the next session, and keeps the Monday exception', () => {
  const start = 'Live Weekly Webinars start Tuesday, November 17, 2026 at 8:00 PM CT.';
  assert.equal(schedule.bannerText(new Date('2026-11-06T16:00:00Z')), start);
  assert.equal(schedule.bannerText(new Date('2026-11-18T01:59:00Z')), start);
  assert.equal(
    schedule.bannerText(new Date('2026-11-18T02:30:00Z')),
    'Live Weekly Webinar: Tuesday, November 17, 2026 at 8:00 PM CT.'
  );
  assert.equal(
    schedule.bannerText(new Date('2026-11-18T04:00:00Z')),
    'Next Live Weekly Webinar: Tuesday, November 24, 2026 at 8:00 PM CT.'
  );
  assert.equal(
    schedule.bannerText(new Date('2026-11-25T04:00:00Z')),
    'Next Live Weekly Webinar: Monday, November 30, 2026 at 8:00 PM CT.'
  );
  assert.equal(
    schedule.bannerText(new Date('2026-12-01T04:00:00Z')),
    'Next Live Weekly Webinar: Tuesday, December 8, 2026 at 8:00 PM CT.'
  );
  const afterSeries = schedule.bannerText(new Date('2027-01-06T04:00:00Z'));
  assert.equal(afterSeries, 'Live Weekly Webinars, Tuesdays at 8:00 PM CT.');
  assert.equal(/\d{4}/.test(afterSeries), false);
});

test('registration label follows the approved sessions and an env pin', () => {
  const early = new Date('2026-11-06T16:00:00Z');
  assert.equal(schedule.sessionLabel(early), 'Tuesday, November 17, 2026 at 8:00 PM CT');
  assert.equal(
    schedule.sessionLabel(new Date('2026-11-18T04:00:00Z')),
    'Tuesday, November 24, 2026 at 8:00 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(new Date('2026-11-25T04:00:00Z')),
    'Monday, November 30, 2026 at 8:00 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(new Date('2026-12-01T04:00:00Z')),
    'Tuesday, December 8, 2026 at 8:00 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(new Date('2026-12-09T04:00:00Z')),
    'Tuesday, December 15, 2026 at 8:00 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(new Date('2026-12-16T04:00:00Z')),
    'Tuesday, January 5, 2027 at 8:00 PM CT'
  );
  assert.equal(schedule.sessionLabel(new Date('2027-01-06T04:00:00Z')), 'Tuesdays at 8:00 PM CT');
  assert.equal(
    schedule.sessionLabel(early, '2026-11-30'),
    'Monday, November 30, 2026 at 8:00 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(early, '2026-11-18', '6:30 PM CT'),
    'Wednesday, November 18, 2026 at 6:30 PM CT'
  );
  assert.equal(
    schedule.sessionLabel(new Date('2026-12-01T04:00:00Z'), '2026-11-17', '8:00 PM CT'),
    'Tuesday, December 8, 2026 at 8:00 PM CT'
  );
});

test('a registration pin is used only when it is an approved date that has not ended', () => {
  const early = new Date('2026-11-06T16:00:00Z');
  assert.equal(
    schedule.bannerText(early, '2026-11-30'),
    'Next Live Weekly Webinar: Monday, November 30, 2026 at 8:00 PM CT.'
  );
  assert.equal(
    schedule.bannerText(new Date('2026-12-01T04:00:00Z'), '2026-11-17'),
    'Next Live Weekly Webinar: Tuesday, December 8, 2026 at 8:00 PM CT.'
  );
  assert.equal(
    schedule.bannerText(early, '2026-12-01'),
    'Live Weekly Webinars start Tuesday, November 17, 2026 at 8:00 PM CT.'
  );
});

test('homepage banners use evergreen coaching copy and the registration page, not a join link', () => {
  const index = read('index.html');
  const site = read('assets/site.js');
  assert.match(index, /LIVE Group Coaching every week\./);
  assert.match(index, /href="\/education\.html#group-coaching"/);
  assert.match(index, /Watch Replays/);
  assert.match(index, /Live Weekly Webinars start Tuesday, November 17, 2026 at 8:00 PM CT\./);
  assert.match(index, /href="\/webinar\/register\?src=banner"/);
  assert.match(index, /Reserve Your Spot/);
  const bar = index.slice(index.indexOf('id="announcement-bar"'), index.indexOf('<nav'));
  assert.doesNotMatch(bar, /webinar\/join/);
  assert.doesNotMatch(bar, /data-cta="demo"/);
  assert.doesNotMatch(bar, /Join Now/i);
  assert.doesNotMatch(bar, /October 15/);
  assert.doesNotMatch(index, /October 15, 2026/);
  assert.doesNotMatch(index, /OCT 1/);
  assert.doesNotMatch(index, /group-coaching-oct15/);
  assert.doesNotMatch(site, /October 15, 2026/);
  assert.doesNotMatch(site, /group-coaching-oct15/);
  assert.doesNotMatch(site, /#webinar-link-pending/);
  assert.match(site, /WEBINAR_URL: '\/webinar\/register\?src=site'/);
});

test('public pages no longer advertise the expired Oct 1 webinar', () => {
  const htmlFiles = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) htmlFiles.push(p);
    }
  }
  walk(ROOT);
  const stale = [];
  for (const file of htmlFiles) {
    const text = fs.readFileSync(file, 'utf8');
    if (/OCT 1|2X\/WEEK STARTING|DETAILS COMING SOON/.test(text)) stale.push(path.relative(ROOT, file));
  }
  assert.deepEqual(stale, []);
});
