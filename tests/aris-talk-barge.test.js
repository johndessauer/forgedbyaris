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
  assert.equal(desk.floor, 0.035);
  assert.equal(desk.floor, talk.BARGE_FLOOR_DESKTOP);
  assert.equal(desk.ratio, 1.4);
  assert.equal(desk.holdMs, 250);
  assert.equal(desk.windowMs, 400);
  assert.equal(desk.strict, false);
  desk.noteSentence(0);
  const dipped = replay(desk, dipFrames(), 20, 100);
  assert.equal(dipped.tripped, true);
  assert.ok(dipped.elapsed <= 500, 'ducked within half a second, saw ' + dipped.elapsed);
  assert.equal(dipped.events.slice(0, dipped.events.indexOf('candidate')).includes('idle'), false);
  const armAt = dipped.events.indexOf('arm');
  assert.ok(armAt >= 0 && armAt < dipped.events.indexOf('candidate'));
  assert.ok(armAt * 20 <= 120, 'arm is the early speech signal, saw frame ' + armAt);

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
  for (n = 0; n < 80; n += 1) quiet.push(0.02);
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
  assert.equal(macChrome.floor, 0.035);
  assert.equal(macChrome.ratio, 1.4);
  assert.equal(phone.ratio, 2.5);
  assert.equal(talk.bargeWatchOptions({ talkPlatform: 'ios' }).ratio, 2.5);
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
  assert.match(session, /logPlayback\('barge-manual'\)/);
  assert.match(session, /gate === 'arm' \|\| gate === 'candidate'\) \{[\s\S]{0,220}duckPlayback\(\)/);
  assert.match(session, /bargePlaybackPeak\(ducked\)/);
  assert.match(session, /observeListening\(rms\)/);
  assert.match(session, /isManualBargeKey\(event, machine && machine\.phase\)/);
  assert.match(session, /function manualBarge\(\) \{/);
  assert.equal(/function manualBarge\(\) \{\s*if \(turnStyle\(\)\) return;/.test(session), false);
  assert.match(session, /function recoverToListening\(reason\) \{[\s\S]*?returnToMember\(\)/);
  const coach = fs.readFileSync(path.join(root, 'aris-coach.html'), 'utf8');
  assert.match(coach, /id="talk-interrupt"[^>]*hidden/);
  assert.match(coach, />Interrupt</);
  assert.equal(/function recoverToListening\(reason\) \{[\s\S]*?machine\.markListening\(/.test(session), false);
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(session), false);
});

function fill(rms, count) {
  const out = [];
  let i;
  for (i = 0; i < count; i += 1) out.push(rms);
  return out;
}

function speechDips(peak, dip, cycles) {
  const out = [];
  let cycle;
  let i;
  for (cycle = 0; cycle < cycles; cycle += 1) {
    for (i = 0; i < 9; i += 1) out.push(peak);
    for (i = 0; i < 2; i += 1) out.push(dip);
  }
  return out;
}

function playFrom(watch, frames, step, start) {
  let t = start;
  let armed = null;
  let confirmed = null;
  let i;
  for (i = 0; i < frames.length; i += 1) {
    const event = watch.push({ rms: frames[i], dt: step, now: t });
    if (armed == null && (event === 'arm' || event === 'candidate')) armed = t - start;
    if (confirmed == null && event === 'candidate') {
      confirmed = t - start;
      break;
    }
    t += step;
  }
  return { armed: armed, confirmed: confirmed, baseline: watch.baseline(), limit: watch.limit() };
}

test('desktop baseline is the pre-speech level, and speech under the old limit does not climb it', () => {
  const seeded = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  seeded.observeListening(0.2);
  assert.equal(seeded.baseline(), 0.03);
  seeded.observeListening(0.016);
  assert.ok(Math.abs(seeded.baseline() - 0.016) < 0.001);
  seeded.observeListening(0.018);
  assert.ok(seeded.baseline() > 0.016 && seeded.baseline() < 0.017);
  const room = seeded.baseline();
  seeded.noteSentence(1000);
  seeded.observeListening(0.01);
  assert.equal(seeded.baseline(), room);
  seeded.release();
  assert.ok(Math.abs(seeded.baseline() - room) < 0.001);

  const ios = talk.createBargeWatch({ platform: 'ios', baseline: 0.03 });
  ios.observeListening(0.016);
  assert.equal(ios.baseline(), 0.03);
  ios.noteSentence(0);
  ios.push({ rms: 0.02, dt: 20, now: 400 });
  assert.ok(Math.abs(ios.baseline() - (0.03 * 0.8 + 0.02 * 0.2)) < 0.0001);

  const desk = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  desk.noteSentence(0);
  desk.push({ rms: 0.02, dt: 20, now: 200 });
  assert.ok(Math.abs(desk.baseline() - (0.03 * 0.95 + 0.02 * 0.05)) < 0.0001);

  // 0.039 sits under limit max(0.035, 0.03*1.4)=0.042 and above the bleed
  // band (0.036). The old 0.2 blend climbed the floor on frames like this
  // until real speech missed. These frames must not move the baseline.
  const parked = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  parked.noteSentence(0);
  const parkedPlay = playFrom(parked, fill(0.039, 80), 20, 200);
  assert.equal(parkedPlay.confirmed, null);
  assert.ok(parked.baseline() < 0.032, 'baseline climbed to ' + parked.baseline());
  const burst = playFrom(parked, fill(0.06, 20), 20, 2000);
  assert.ok(burst.confirmed != null && burst.confirmed <= 500, 'soft peak missed, saw ' + burst.confirmed);
  assert.ok(parked.baseline() < 0.032, 'burst climbed baseline to ' + parked.baseline());

  const hidden = talk.createBargeWatch({ platform: 'desktop', baseline: 0.05 });
  hidden.noteSentence(0);
  const under = playFrom(hidden, fill(0.062, 50), 20, 200);
  assert.equal(under.confirmed, null);
  assert.ok(hidden.baseline() < 0.051, 'sub-limit speech climbed to ' + hidden.baseline());
  const over = playFrom(hidden, fill(0.09, 20), 20, 2000);
  assert.ok(over.confirmed != null && over.confirmed <= 500);
  assert.ok(over.armed != null && over.armed <= 120);
  assert.ok(hidden.baseline() < 0.055);
});

test('speaker bleed stays quiet and AEC-sized speech still trips', () => {
  const speakers = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fill(0.018, 30).forEach((rms) => speakers.observeListening(rms));
  assert.ok(speakers.baseline() < 0.025, 'seed stayed at ' + speakers.baseline());
  speakers.noteSentence(600);
  const bleed = playFrom(speakers, fill(0.032, 40), 20, 600);
  assert.equal(bleed.confirmed, null, 'steady bleed confirmed at ' + bleed.confirmed);
  assert.ok(speakers.baseline() < 0.05, 'bleed baseline ' + speakers.baseline());
  const speech = playFrom(speakers, speechDips(0.06, 0.02, 3), 20, 1600);
  assert.ok(speech.armed != null && speech.armed <= 160, 'arm at ' + speech.armed);
  assert.ok(speech.confirmed != null && speech.confirmed <= 500, 'confirm at ' + speech.confirmed);
  assert.ok(speakers.baseline() < 0.05, 'speech climbed baseline to ' + speakers.baseline());

  const phones = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fill(0.012, 20).forEach((rms) => phones.observeListening(rms));
  phones.noteSentence(400);
  const phoneBleed = playFrom(phones, fill(0.016, 20), 20, 400);
  assert.equal(phoneBleed.confirmed, null);
  const phoneSpeech = playFrom(phones, speechDips(0.07, 0.012, 3), 20, 900);
  assert.ok(phoneSpeech.confirmed != null && phoneSpeech.confirmed <= 500, 'headphones confirm ' + phoneSpeech.confirmed);
  assert.ok(phones.baseline() < 0.03);

  const soft = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fill(0.016, 20).forEach((rms) => soft.observeListening(rms));
  soft.noteSentence(400);
  playFrom(soft, fill(0.026, 25), 20, 400);
  const softSpeech = playFrom(soft, speechDips(0.05, 0.018, 3), 20, 1000);
  assert.ok(softSpeech.confirmed != null && softSpeech.confirmed <= 500, 'soft confirm ' + softSpeech.confirmed + ' limit ' + soft.limit());

  const edge = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fill(0.02, 20).forEach((rms) => edge.observeListening(rms));
  edge.noteSentence(400);
  const edgeBleed = playFrom(edge, fill(0.03, 40), 20, 400);
  assert.equal(edgeBleed.confirmed, null, '0.03 bleed tripped');
  const edgeSpeech = playFrom(edge, speechDips(0.045, 0.02, 4), 20, 1400);
  assert.ok(edgeSpeech.armed != null && edgeSpeech.armed <= 120, 'edge arm ' + edgeSpeech.armed);
  assert.ok(edgeSpeech.confirmed != null && edgeSpeech.confirmed <= 500, 'edge confirm ' + edgeSpeech.confirmed + ' limit ' + edge.limit());

  const loudBleed = talk.createBargeWatch({ platform: 'desktop', baseline: 0.03 });
  fill(0.02, 15).forEach((rms) => loudBleed.observeListening(rms));
  loudBleed.noteSentence(300);
  const held = playFrom(loudBleed, fill(0.05, 100), 20, 300);
  assert.equal(held.confirmed, null, '0.05 bleed confirmed, baseline ' + loudBleed.baseline());

  const shout = talk.createBargeWatch({ platform: 'desktop', baseline: 0.02 });
  shout.noteSentence(0);
  playFrom(shout, fill(0.2, 4), 20, 0);
  assert.ok(shout.baseline() < 0.04, 'grace ate the shout, baseline ' + shout.baseline());
  const shouted = playFrom(shout, fill(0.2, 20), 20, 100);
  assert.ok(shouted.confirmed != null && shouted.confirmed <= 500);
});

test('manual interrupt ignores typing focus and ducks new sentences at the arm peak', () => {
  const body = { tagName: 'BODY', parentElement: null };
  const box = { tagName: 'TEXTAREA', parentElement: body };
  const nested = { tagName: 'SPAN', parentElement: box };
  const editable = { tagName: 'DIV', isContentEditable: true, parentElement: body };
  const button = { tagName: 'BUTTON', parentElement: body };
  assert.equal(talk.focusBlocksManualBarge(box), true);
  assert.equal(talk.focusBlocksManualBarge(nested), true);
  assert.equal(talk.focusBlocksManualBarge(editable), true);
  assert.equal(talk.focusBlocksManualBarge({ tagName: 'INPUT', parentElement: null }), true);
  assert.equal(talk.focusBlocksManualBarge(button), false);
  assert.equal(talk.focusBlocksManualBarge(body), false);

  assert.equal(talk.isManualBargeKey({ key: ' ', target: body }, 'speaking'), true);
  assert.equal(talk.isManualBargeKey({ code: 'Space', target: button }, 'speaking'), true);
  assert.equal(talk.isManualBargeKey({ key: ' ', target: box }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', target: nested }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', target: editable }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', repeat: true, target: body }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', metaKey: true, target: body }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: 'Enter', target: body }, 'speaking'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', target: body }, 'listening'), false);
  assert.equal(talk.isManualBargeKey({ key: ' ', target: body }, 'thinking'), false);

  assert.equal(talk.bargePlaybackPeak(false), 1);
  assert.equal(talk.bargePlaybackPeak(true), 0.15);
  assert.equal(talk.bargePlaybackPeak(true), talk.BARGE_DUCK_GAIN);
});
