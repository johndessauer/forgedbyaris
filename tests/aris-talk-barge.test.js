const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const talk = require('../assets/js/aris-talk');

const root = path.join(__dirname, '..');

function dipFrames() {
  const frames = [];
  let cycle;
  let i;
  for (cycle = 0; cycle < 8; cycle += 1) {
    for (i = 0; i < 9; i += 1) frames.push(0.16);
    for (i = 0; i < 2; i += 1) frames.push(0.02);
  }
  return frames;
}

function replay(watch, frames, step, start) {
  let t = start;
  const events = [];
  let i;
  for (i = 0; i < frames.length; i += 1) {
    const event = watch.push({ rms: frames[i], dt: step, now: t });
    events.push(event);
    if (event === 'candidate') return { tripped: true, at: t, elapsed: t - start, events: events };
    t += step;
  }
  return { tripped: false, at: t, elapsed: t - start, events: events };
}

test('desktop speech with syllable dips trips, and a steady echo does not', () => {
  const desk = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  assert.equal(desk.floor, 0.06);
  assert.equal(desk.holdMs, 250);
  assert.equal(desk.windowMs, 400);
  assert.equal(desk.strict, false);
  desk.noteSentence(0);
  const dipped = replay(desk, dipFrames(), 20, 100);
  assert.equal(dipped.tripped, true);
  assert.ok(dipped.elapsed <= 500, 'ducked within half a second, saw ' + dipped.elapsed);
  assert.equal(dipped.events.slice(0, dipped.events.indexOf('candidate')).includes('idle'), false);

  const echo = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  echo.noteSentence(0);
  const steady = [];
  let n;
  for (n = 0; n < 100; n += 1) steady.push(0.08);
  const bleed = replay(echo, steady, 20, 0);
  assert.equal(bleed.tripped, false);

  const underFloor = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  underFloor.noteSentence(0);
  const quiet = [];
  for (n = 0; n < 80; n += 1) quiet.push(0.05);
  assert.equal(replay(underFloor, quiet, 20, 200).tripped, false);
});

test('iOS keeps the 0.10 floor and the unbroken hold', () => {
  const ios = talk.createBargeWatch({ platform: 'ios', baseline: 0.03 });
  assert.equal(ios.floor, talk.BARGE_FLOOR);
  assert.equal(ios.floor, 0.1);
  assert.equal(ios.holdMs, 500);
  assert.equal(ios.graceMs, 300);
  assert.equal(ios.strict, true);
  ios.noteSentence(0);
  const dipped = replay(ios, dipFrames(), 20, 320);
  assert.equal(dipped.tripped, false);

  const sustained = talk.createBargeWatch({ platform: 'ios', baseline: 0.04 });
  sustained.noteSentence(0);
  assert.equal(sustained.push({ rms: 0.4, dt: 50, now: 100 }), 'grace');
  assert.equal(sustained.push({ rms: 0.4, dt: 200, now: 400 }), 'arm');
  assert.equal(sustained.push({ rms: 0.4, dt: 300, now: 700 }), 'candidate');

  const phone = talk.bargeWatchOptions({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)',
    touchPoints: 5,
  });
  assert.equal(phone.platform, 'ios');
  assert.equal(phone.floor, 0.1);
  const pad = talk.bargeWatchOptions({
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)',
    touchPoints: 5,
  });
  assert.equal(pad.platform, 'ios');
  assert.equal(pad.floor, 0.1);
  const ipadDesktop = talk.bargeWatchOptions({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
    touchPoints: 5,
  });
  assert.equal(ipadDesktop.platform, 'ios');
  assert.equal(ipadDesktop.floor, 0.1);
  const macChrome = talk.bargeWatchOptions({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    touchPoints: 0,
  });
  assert.equal(macChrome.platform, 'desktop');
  assert.equal(macChrome.floor, 0.06);
  assert.equal(talk.isIosTalkDevice(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    0
  ), false);
});

test('scheduling a sentence does not clear an in-progress hold', () => {
  const desk = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  desk.noteSentence(0);
  assert.equal(desk.push({ rms: 0.16, dt: 120, now: 200 }), 'arm');
  desk.noteScheduled();
  desk.noteSentence(210);
  assert.equal(desk.push({ rms: 0.16, dt: 150, now: 360 }), 'candidate');

  const ios = talk.createBargeWatch({ platform: 'ios', baseline: 0.03 });
  ios.noteSentence(0);
  assert.equal(ios.push({ rms: 0.4, dt: 200, now: 400 }), 'arm');
  ios.noteSentence(450);
  assert.equal(ios.push({ rms: 0.4, dt: 300, now: 700 }), 'candidate');

  const fresh = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fresh.noteSentence(1000);
  assert.equal(fresh.push({ rms: 0.2, dt: 20, now: 1040 }), 'grace');
});

test('echo ignores short commands and needs four overlapping words', () => {
  const spoken = 'Please stop and wait while ARIS reads the rent roll slowly.';
  assert.equal(talk.interruptionIsEcho('stop', spoken), false);
  assert.equal(talk.interruptionIsEcho('Stop!', spoken), false);
  assert.equal(talk.interruptionIsEcho('wait', spoken), false);
  assert.equal(talk.interruptionIsEcho('hold on', spoken), false);
  assert.equal(talk.interruptionIsEcho('hang on', spoken), false);
  assert.equal(talk.interruptionIsEcho('no', spoken), false);
  assert.equal(talk.interruptionIsEcho('pause', spoken), false);
  assert.equal(talk.interruptionIsEcho('ARIS', spoken), false);
  assert.equal(talk.interruptionIsEcho('the rent roll', spoken), false);
  assert.equal(talk.interruptionIsEcho('', spoken), true);
  assert.equal(talk.interruptionIsEcho('reads the rent roll slowly', spoken), true);
  assert.equal(talk.interruptionIsEcho('What about the schools', spoken), false);

  const playing = 'The taxes are low this year.';
  const previous = 'Schools are nearby and the streets are quiet.';
  assert.equal(talk.interruptionIsEcho('schools are nearby and quiet', playing, previous), true);
  assert.equal(talk.interruptionIsEcho('what about the schools', playing, previous), false);
  assert.equal(talk.interruptionIsEcho('schools are nearby and quiet', playing), false);
});

test('localStorage can retune the floor and the hold', () => {
  const storage = {
    getItem(key) {
      if (key === 'arisBargeFloor') return '0.04';
      if (key === 'arisBargeHoldMs') return '180';
      return null;
    },
  };
  const tuned = talk.bargeWatchOptions({ talkPlatform: 'desktop', storage: storage });
  assert.equal(tuned.floor, 0.04);
  assert.equal(tuned.holdMs, 180);
  const watch = talk.createBargeWatch(tuned);
  assert.equal(watch.floor, 0.04);
  assert.equal(watch.holdMs, 180);
  assert.equal(watch.windowMs >= 400, true);

  const junk = talk.bargeWatchOptions({
    talkPlatform: 'ios',
    storage: { getItem() { return 'nope'; } },
  });
  assert.equal(junk.floor, 0.1);
  assert.equal(junk.holdMs, 500);

  const duck = talk.bargeGainPlan('duck');
  assert.equal(duck.gain, 0.15);
  assert.equal(duck.rampMs, 50);
  assert.equal(talk.bargeGainPlan('restore').gain, 1);
});

test('turn-taking does not duck or stop, and hands-free logs the barge path', () => {
  const session = fs.readFileSync(path.join(root, 'assets/js/aris-talk-session.js'), 'utf8');
  assert.match(session, /function handleSpeakerLevel\(rms, dt, t\) \{[\s\S]*?if \(turnStyle\(\)\) return;/);
  assert.match(session, /function duckPlayback\(\) \{\s*if \(turnStyle\(\)\) return;/);
  assert.match(session, /function restorePlayback\(\) \{\s*if \(!ducked \|\| turnStyle\(\)\) return;/);
  assert.match(session, /function commitBarge\(\) \{\s*if \(turnStyle\(\)\) return;/);
  assert.match(session, /bargeGainPlan\('duck'\)/);
  assert.match(session, /linearRampToValueAtTime/);
  assert.match(session, /noteScheduled/);
  assert.match(session, /logPlayback\('barge-arm /);
  assert.match(session, /logPlayback\('barge-candidate'\)/);
  assert.match(session, /logPlayback\('barge-duck'\)/);
  assert.match(session, /logPlayback\('barge-in confirmed '/);
  assert.match(session, /rejectBarge\('short-clip'\)/);
  assert.match(session, /rejectBarge\('empty'\)/);
  assert.match(session, /rejectBarge\('error'\)/);
  assert.match(session, /rejectBarge\('echo'\)/);
  assert.match(session, /logPlayback\('barge-restore'\)/);
  assert.match(session, /function recoverToListening\(reason\) \{[\s\S]*?returnToMember\(\)/);
  assert.equal(/function recoverToListening\(reason\) \{[\s\S]*?machine\.markListening\(/.test(session), false);
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(session), false);
});
