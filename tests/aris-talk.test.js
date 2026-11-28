const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const talk = require('../assets/js/aris-talk');
const { createHandler } = require('../netlify/functions/aris-talk');

const root = path.join(__dirname, '..');
const {
  COPY,
  createTalkSession,
  applyUsage,
  segmentSpeech,
  nextSentences,
  createVad,
  rmsFromTimeDomain,
  talkModeAccess,
  clampIdleMs,
  idleMsFromEnv,
  capMinutesFromEnv,
  evaluateMonthAlert,
  monthKeyFromDate,
  isEchoOf,
} = talk;

function session(idleMs) {
  return createTalkSession({ idleMs: idleMs == null ? 120000 : idleMs });
}

test('idle warns 15s before a 2 minute pause and usage stops while paused', () => {
  const s = session();
  assert.equal(s.start(0).unlockAudio, true);
  assert.equal(s.phase, 'listening');
  assert.equal(s.capture, true);

  let warned = null;
  for (let t = 1000; t <= 105000; t += 1000) {
    const ev = s.tick(t);
    if (ev.warning) warned = { t, ev };
  }
  assert.ok(warned, 'expected a heads-up');
  assert.equal(warned.t, 105000);
  assert.equal(warned.ev.msUntilPause, 15000);
  assert.equal(s.phase, 'listening');
  assert.equal(talk.statusLabel(s.phase, true), COPY.warning);

  const paused = s.tick(120000);
  assert.equal(paused.paused, true);
  assert.equal(paused.stopMic, true);
  assert.equal(paused.stopPlayback, true);
  assert.equal(s.phase, 'paused');
  assert.equal(s.capture, false);
  assert.equal(s.playback, false);
  assert.equal(talk.statusLabel(s.phase, false), COPY.paused);
  assert.equal(talk.buttonLabel(s.phase), COPY.buttonResume);

  const before = s.drainSeconds();
  assert.equal(before.listen, 120);
  assert.equal(before.speak, 0);
  s.tick(180000);
  s.tick(240000);
  const during = s.drainSeconds();
  assert.deepEqual(during, { listen: 0, speak: 0 });
  assert.deepEqual(s.pendingMs(), { listenMs: 0, speakMs: 0 });

  const resumed = s.resume(240000);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.unlockAudio, true);
  assert.equal(s.phase, 'listening');
  assert.equal(s.capture, true);
  s.tick(250000);
  assert.equal(s.drainSeconds().listen, 10);
});

test('member speech resets the idle clock, including after ARIS finishes', () => {
  const s = session();
  s.start(0);
  s.tick(100000);
  s.noteMemberSpeech(100000);
  assert.notEqual(s.tick(120000).paused, true);
  assert.equal(s.phase, 'listening');

  s.memberSpeechEnd(130000);
  s.markSpeaking(131000);
  s.tick(200000);
  assert.equal(s.phase, 'speaking');
  s.markListening(200000);
  const warn = s.tick(200000 + 105000);
  assert.equal(warn.warning, true);
  assert.equal(s.phase, 'listening');
  assert.notEqual(s.tick(200000 + 119000).paused, true);
  assert.equal(s.tick(200000 + 120000).paused, true);
});

test('idle seconds clamp to the 2–3 minute range', () => {
  assert.equal(clampIdleMs(60000), 120000);
  assert.equal(clampIdleMs(90), 120000);
  assert.equal(clampIdleMs(120), 120000);
  assert.equal(clampIdleMs(150), 150000);
  assert.equal(clampIdleMs(180), 180000);
  assert.equal(clampIdleMs(180000), 180000);
  assert.equal(clampIdleMs(240), 180000);
  assert.equal(clampIdleMs(''), 120000);
  assert.equal(idleMsFromEnv({}), 120000);
  assert.equal(idleMsFromEnv({ ARIS_TALK_IDLE_SECONDS: '150' }), 150000);
  assert.equal(idleMsFromEnv({ ARIS_TALK_IDLE_SECONDS: '30' }), 120000);
  assert.equal(capMinutesFromEnv({}), 30);
  assert.equal(capMinutesFromEnv({ ARIS_TALK_CAP_MINUTES: '45' }), 45);
  assert.equal(capMinutesFromEnv({ ARIS_TALK_CAP_MINUTES: '0' }), 0);
});

test('page hide pauses playback and stops the usage clock', () => {
  const s = session();
  s.start(0);
  s.memberSpeechEnd(1000);
  s.markSpeaking(1000);
  s.tick(4000);
  const hidden = s.pageHide(4000);
  assert.equal(hidden.paused, true);
  assert.equal(hidden.capture, false);
  assert.equal(hidden.playback, false);
  assert.equal(hidden.stopMic, true);
  const used = s.drainSeconds();
  assert.equal(used.listen, 1);
  assert.equal(used.speak, 3);
  s.tick(64000);
  assert.deepEqual(s.drainSeconds(), { listen: 0, speak: 0 });
  assert.equal(s.addSpeakMs(2000), false);
});

test('thinking time is not counted and a later resume is a fresh listen', () => {
  const s = session();
  s.start(0);
  s.memberSpeechStart(0);
  s.memberSpeechEnd(2000);
  s.tick(9000);
  assert.equal(s.phase, 'thinking');
  assert.equal(s.capture, true);
  assert.equal(s.playback, false);
  s.markSpeaking(9000);
  s.tick(11000);
  const used = s.drainSeconds();
  assert.equal(used.listen, 2);
  assert.equal(used.speak, 2);
});

test('barge-in while speaking stops playback and the next listen starts after the new reply', () => {
  const s = session();
  s.start(0);
  s.memberSpeechStart(200);
  s.memberSpeechEnd(1200);
  assert.equal(s.phase, 'thinking');
  s.markSpeaking(1500);
  assert.equal(s.playback, true);
  assert.equal(s.phase, 'speaking');

  const barge = s.memberSpeechStart(4000);
  assert.equal(barge.bargeIn, true);
  assert.equal(barge.stopPlayback, true);
  assert.equal(barge.abortReply, true);
  assert.equal(barge.from, 'speaking');
  assert.equal(s.phase, 'listening');
  assert.equal(s.playback, false);
  assert.equal(s.capture, true);

  const heard = s.memberSpeechEnd(5600);
  assert.equal(heard.transcribe, true);
  assert.equal(s.phase, 'thinking');
  s.markSpeaking(6000);
  s.markListening(9000);
  assert.equal(s.phase, 'listening');
  assert.equal(s.capture, true);
  assert.equal(s.playback, false);
  assert.equal(s.tick(9000 + 1000).paused, undefined);
});

test('barge-in during thinking aborts the reply and returns to a live listen', () => {
  const s = session();
  s.start(0);
  s.memberSpeechEnd(500);
  const barge = s.memberSpeechStart(800);
  assert.equal(barge.bargeIn, true);
  assert.equal(barge.abortReply, true);
  assert.equal(barge.from, 'thinking');
  assert.equal(s.capture, true);
  assert.equal(s.playback, false);
});

test('cap accounting accepts listening before speaking, replays a request, and ignores paused zeroes', () => {
  let state = { usedSeconds: 0, seen: {} };
  const first = applyUsage(state, {
    listenSeconds: 50,
    speakSeconds: 20,
    capSeconds: 60,
    requestId: 'a',
    maxChunkSeconds: 180,
  });
  assert.equal(first.acceptedListen, 50);
  assert.equal(first.acceptedSpeak, 10);
  assert.equal(first.usedSeconds, 60);
  assert.equal(first.capped, true);
  state = { usedSeconds: first.usedSeconds, seen: first.seen };

  const replay = applyUsage(state, {
    listenSeconds: 50,
    speakSeconds: 20,
    capSeconds: 60,
    requestId: 'a',
    maxChunkSeconds: 180,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.acceptedListen, 0);
  assert.equal(replay.acceptedSpeak, 0);
  assert.equal(replay.usedSeconds, 60);

  const blocked = applyUsage(state, {
    listenSeconds: 5,
    speakSeconds: 5,
    capSeconds: 60,
    requestId: 'b',
    maxChunkSeconds: 180,
  });
  assert.equal(blocked.acceptedListen, 0);
  assert.equal(blocked.acceptedSpeak, 0);
  assert.equal(blocked.capped, true);

  const chunk = applyUsage({ usedSeconds: 0, seen: {} }, {
    listenSeconds: 500,
    speakSeconds: 40,
    capSeconds: 10000,
    requestId: 'c',
    maxChunkSeconds: 180,
  });
  assert.equal(chunk.acceptedListen, 180);
  assert.equal(chunk.acceptedSpeak, 0);

  const pausedAdd = applyUsage({ usedSeconds: 10, seen: {} }, {
    listenSeconds: 0,
    speakSeconds: 0,
    capSeconds: 1800,
    requestId: 'pause',
    maxChunkSeconds: 180,
  });
  assert.equal(pausedAdd.usedSeconds, 10);
  assert.equal(pausedAdd.acceptedListen, 0);
  assert.equal(pausedAdd.acceptedSpeak, 0);
  assert.equal(pausedAdd.capped, false);
});

test('month alert flags once when total minutes cross the threshold', () => {
  assert.deepEqual(evaluateMonthAlert({ totalSeconds: 59, thresholdMinutes: 1, alreadyFlagged: false }).flag, false);
  const cross = evaluateMonthAlert({ totalSeconds: 60, thresholdMinutes: 1, alreadyFlagged: false });
  assert.equal(cross.flag, true);
  assert.equal(cross.reason, 'cross');
  assert.equal(evaluateMonthAlert({ totalSeconds: 120, thresholdMinutes: 1, alreadyFlagged: true }).reason, 'already');
  assert.equal(evaluateMonthAlert({ totalSeconds: 99999, thresholdMinutes: 0 }).reason, 'disabled');
});

test('sentence chunking keeps decimals and abbreviations, flushes the tail, and drops deal data', () => {
  const money = segmentSpeech('The ARV is $185,000. The spread is 3.5 percent', false);
  assert.deepEqual(money.sentences, ['The ARV is $185,000.']);
  assert.equal(money.rest, 'The spread is 3.5 percent');

  const finished = segmentSpeech('The spread is 3.5 percent.', false);
  assert.deepEqual(finished.sentences, ['The spread is 3.5 percent.']);
  assert.equal(finished.rest, '');

  const flushed = segmentSpeech('The ARV is $185,000. The spread is 3.5 percent', true);
  assert.deepEqual(flushed.sentences, ['The ARV is $185,000.', 'The spread is 3.5 percent']);
  assert.equal(flushed.rest, '');

  const doctor = segmentSpeech('Dr. Smith said yes. Then we moved', false);
  assert.deepEqual(doctor.sentences, ['Dr. Smith said yes.']);
  assert.equal(doctor.rest, 'Then we moved');

  const deal = segmentSpeech('Price is firm. <<<DEAL_DATA {"tab":"flip"} DEAL_DATA>>> Ask about repairs.', true);
  assert.deepEqual(deal.sentences, ['Price is firm.', 'Ask about repairs.']);
  assert.equal(deal.sentences.join(' ').includes('DEAL_DATA'), false);

  const live = nextSentences(0, 'First sentence is ready. Second is still', false);
  assert.deepEqual(live.next, ['First sentence is ready.']);
  const more = nextSentences(live.sentences.length, 'First sentence is ready. Second is still growing.', true);
  assert.deepEqual(more.next, ['Second is still growing.']);
});

test('voice activity needs a longer run to interrupt playback', () => {
  const vad = createVad({ speechRms: 0.05, bargeRms: 0.1, speechFrames: 3, bargeFrames: 5, silenceMs: 200, minUtteranceMs: 50 });
  assert.equal(vad.push(0.2, 40, 'listening'), 'noise');
  assert.equal(vad.push(0.2, 40, 'listening'), 'noise');
  assert.equal(vad.push(0.2, 80, 'listening'), 'speech_start');
  assert.equal(vad.push(0.2, 80, 'listening'), 'speech');
  assert.equal(vad.push(0.01, 250, 'listening'), 'speech_end');

  const barge = createVad({ speechRms: 0.05, bargeRms: 0.1, speechFrames: 3, bargeFrames: 5, silenceMs: 200, minUtteranceMs: 50 });
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.04, 40, 'speaking'), 'silence');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'noise');
  assert.equal(barge.push(0.2, 40, 'speaking'), 'speech_start');

  const quiet = new Uint8Array(8);
  quiet.fill(128);
  assert.equal(rmsFromTimeDomain(quiet), 0);
  const loud = new Uint8Array(4);
  loud[0] = 255;
  loud[1] = 0;
  loud[2] = 255;
  loud[3] = 0;
  assert.ok(rmsFromTimeDomain(loud) > 0.9);
});

test('list markers, clock times, and markdown stay in one spoken chunk', () => {
  const { segmentSpeech, planPrefetch, trimPcmEdges, playbackSchedule } = talk;
  const fortWayne = segmentSpeech(
    '1. Post the offer at 6-7 p.m. CT, Forge Group Coaching Call. 2. Send the *scripts* tonight.',
    true
  );
  assert.deepEqual(fortWayne.sentences, [
    'Post the offer at 6-7 p.m. CT, Forge Group Coaching Call.',
    'Send the scripts tonight.',
  ]);
  assert.equal(fortWayne.sentences.some(function (line) { return line === '1.' || line === '2.'; }), false);
  assert.equal(fortWayne.sentences.join(' ').includes('*'), false);

  const clock = segmentSpeech('Doors open at 6-7 p.m. CT, Forge Group Coaching Call.', false);
  assert.deepEqual(clock.sentences, ['Doors open at 6-7 p.m. CT, Forge Group Coaching Call.']);

  const morning = segmentSpeech('The call is at 8 a.m. Bring the sheet.', false);
  assert.deepEqual(morning.sentences, ['The call is at 8 a.m. Bring the sheet.']);

  const example = segmentSpeech('Use a range, e.g. three to five percent.', false);
  assert.equal(example.sentences.length, 1);
  assert.match(example.sentences[0], /e\.g\. three to five percent/);

  const italic = segmentSpeech('Use the *script* tonight. Then follow up.', true);
  assert.deepEqual(italic.sentences, ['Use the script tonight.', 'Then follow up.']);

  const stray = segmentSpeech('See the * note before you post.', true);
  assert.equal(stray.sentences[0].includes('*'), false);
  assert.match(stray.sentences[0], /See the note before you post/);

  const divided = segmentSpeech('Post the offer.\n\n---\n\nSend the scripts.', true);
  assert.deepEqual(divided.sentences, ['Post the offer.', 'Send the scripts.']);
  assert.equal(divided.sentences.join(' ').includes('---'), false);

  const google = segmentSpeech('Sophisticated renters will Google it. They still call you.', true);
  assert.deepEqual(google.sentences, [
    'Sophisticated renters will Google it.',
    'They still call you.',
  ]);
  const quoted = segmentSpeech('He said "Google it." Then he left.', true);
  assert.match(quoted.sentences.join(' '), /Google it/);
  assert.match(quoted.sentences.join(' '), /Then he left/);
  const dash = segmentSpeech('Sophisticated renters — the careful ones — will Google it. Then they call.', true);
  assert.match(dash.sentences.join(' '), /Sophisticated renters/);
  assert.match(dash.sentences.join(' '), /will Google it/);
  assert.match(dash.sentences.join(' '), /Then they call/);
  const quoteBlock = segmentSpeech('> Sophisticated renters will Google it.\n\nThey still call.', true);
  assert.match(quoteBlock.sentences.join(' '), /Sophisticated renters will Google it/);
  assert.match(quoteBlock.sentences.join(' '), /They still call/);
  assert.equal(quoteBlock.sentences.join(' ').includes('>'), false);

  assert.deepEqual(planPrefetch(['playing', 'queued', 'queued', 'queued'], 2), [1, 2]);
  assert.deepEqual(planPrefetch(['queued', 'queued', 'queued', 'queued'], 2), [0, 1, 2]);
  assert.deepEqual(planPrefetch(['playing', 'fetch', 'queued', 'queued'], 2), [2]);
  assert.deepEqual(planPrefetch(['ready', 'queued', 'queued', 'queued'], 2), [1, 2]);

  const samples = [0, 0, 0, 0.5, 0.2, 0, 0];
  const trimmed = trimPcmEdges(samples, 100, { threshold: 0.05, maxSeconds: 0.05 });
  assert.equal(trimmed.start, 3);
  assert.equal(trimmed.end, 5);
  const loud = trimPcmEdges([0.4, 0.5, 0.4], 100, { threshold: 0.05, maxSeconds: 0.05 });
  assert.deepEqual(loud, { start: 0, end: 3 });

  const plan = playbackSchedule({ now: 10, nextStart: 0, duration: 1.2, fade: 0.015, crossfade: 0.012 });
  assert.ok(plan.fade >= 0.01 && plan.fade <= 0.02);
  assert.ok(plan.nextStart > plan.startAt);
  assert.ok(plan.nextStart < plan.startAt + plan.playFor);
});

test('a mid-question pause does not end the turn, and a long research wait does not pause', () => {
  const vad = createVad();
  assert.equal(talk.DEFAULT_SILENCE_MS, 1800);
  assert.equal(vad.push(0.2, 40, 'listening'), 'noise');
  assert.equal(vad.push(0.2, 40, 'listening'), 'noise');
  assert.equal(vad.push(0.2, 40, 'listening'), 'noise');
  assert.equal(vad.push(0.2, 40, 'listening'), 'speech_start');
  assert.equal(vad.push(0.2, 400, 'listening'), 'speech');
  assert.equal(vad.push(0.01, 1200, 'listening'), 'speech');
  assert.equal(vad.push(0.2, 200, 'listening'), 'speech');
  assert.equal(vad.push(0.01, 1800, 'listening'), 'speech_end');

  const session = createTalkSession({ idleMs: 120000 });
  assert.equal(session.start(0).phase, 'listening');
  session.noteMemberSpeech(1000);
  session.markThinking(5000);
  const duringResearch = session.tick(5000 + 3 * 60 * 1000);
  assert.equal(duringResearch.paused, undefined);
  assert.equal(session.phase, 'thinking');
  session.markSpeaking(200000);
  assert.equal(session.tick(200000 + 3 * 60 * 1000).phase, 'speaking');

  const hide = talk.createHidePause();
  assert.equal(hide.hidden(0).pause, false);
  assert.equal(hide.tick(500, 'hidden').pause, false);
  assert.equal(hide.visible().pause, false);
  assert.equal(hide.tick(hide.delayMs + 10, 'visible').pause, false);
  hide.hidden(0);
  assert.equal(hide.tick(hide.delayMs, 'hidden').pause, true);
});

test('pre-roll keeps the onset that voice activity used to notice speech', () => {
  const { createTalkCapture, createPreRoll, holdOpeningClip, markCaptureReady, PRE_ROLL_MS } = talk;
  assert.ok(PRE_ROLL_MS >= 300 && PRE_ROLL_MS <= 500);
  const roll = createPreRoll(1000, 400);
  assert.equal(roll.windowMs, 400);
  assert.equal(roll.capacity, 400);
  roll.push(new Float32Array(500).fill(0.25));
  const snap = roll.snapshot();
  assert.equal(snap.length, 400);
  assert.ok(snap.every((sample) => sample === 0.25));

  const capture = createTalkCapture({
    sampleRate: 1000,
    preRollMs: 400,
    vad: { speechRms: 0.05, speechFrames: 3, silenceMs: 200, minUtteranceMs: 50 },
  });
  const quiet = new Float32Array(100);
  const loud = new Float32Array(100).fill(0.5);
  assert.equal(capture.push(quiet, 100, 'listening').event, 'silence');
  assert.equal(capture.push(loud, 100, 'listening').event, 'noise');
  assert.equal(capture.push(loud, 100, 'listening').event, 'noise');
  assert.equal(capture.push(loud, 100, 'listening').event, 'speech_start');
  capture.push(loud, 100, 'listening');
  const ended = capture.push(quiet, 250, 'listening');
  assert.equal(ended.event, 'speech_end');
  const loudSamples = Array.from(ended.samples).filter((sample) => sample > 0.4).length;
  assert.ok(loudSamples >= 300, 'onset frames before speech_start must stay in the clip, got ' + loudSamples);
  assert.equal(ended.wav[0], 82); // R
  assert.equal(String.fromCharCode(ended.wav[8], ended.wav[9], ended.wav[10], ended.wav[11]), 'WAVE');

  let opening = { ready: false, wav: null };
  const early = holdOpeningClip(opening, { event: 'speech_end', wav: ended.wav });
  opening = early.state;
  assert.equal(early.send, null);
  const ready = markCaptureReady(opening);
  assert.equal(ready.send, ended.wav);
  assert.equal(ready.state.ready, true);
  const later = holdOpeningClip(ready.state, { event: 'speech_end', wav: ended.wav });
  assert.equal(later.send, ended.wav);
});

test('a sourced reply is spoken without the URL', () => {
  const cited = segmentSpeech(
    'Crown Point has no stop.\n\nSources\n- NICTD https://nictd.com/stations\n- West Lake Corridor',
    true
  );
  const spoken = cited.sentences.join(' ');
  assert.equal(spoken.includes('http'), false);
  assert.match(spoken, /Source: NICTD and West Lake Corridor/);
});

test('heads-up echo matches only the same words', () => {
  assert.equal(isEchoOf("I'm still here. I'll pause in a moment if you're done.", COPY.headsUp), true);
  assert.equal(isEchoOf('What is the ARV?', COPY.headsUp), false);
});

test('member-facing Talk Mode copy never names a vendor', () => {
  const banned = /elevenlabs|scribe|deepgram|openai|whisper|anthropic|claude|web speech|speechrecognition|google/i;
  for (const value of Object.values(COPY)) {
    assert.equal(banned.test(value), false, value);
  }
  assert.equal(COPY.listening, 'Listening');
  assert.equal(COPY.thinking, 'Thinking');
  assert.equal(COPY.speaking, 'Speaking');
  assert.match(COPY.paused, /Talk Mode paused — tap to resume/);
  assert.match(COPY.cap, /speaker button/);
});

test('speaker echo does not stop playback, and a louder sustained voice can', () => {
  const watch = talk.createBargeWatch({ baseline: 0.08, floor: 0.1, ratio: 2.5, holdMs: 500, graceMs: 300 });
  watch.noteSentence(0);
  var t;
  for (t = 0; t < 1000; t += 50) {
    assert.notEqual(watch.push({ rms: 0.09, dt: 50, now: t }), 'candidate');
  }
  const loud = talk.createBargeWatch({ baseline: 0.04, floor: 0.1, ratio: 2.5, holdMs: 500, graceMs: 300 });
  loud.noteSentence(0);
  assert.equal(loud.push({ rms: 0.4, dt: 50, now: 100 }), 'grace');
  assert.equal(loud.push({ rms: 0.4, dt: 200, now: 400 }), 'arm');
  assert.equal(loud.push({ rms: 0.4, dt: 300, now: 700 }), 'candidate');
  assert.equal(talk.interruptionIsEcho('', 'Sophisticated renters will Google it.'), true);
  assert.equal(talk.interruptionIsEcho('Sophisticated renters will Google it', 'Sophisticated renters will Google it.'), true);
  assert.equal(talk.interruptionIsEcho('What about the schools', 'Sophisticated renters will Google it.'), false);
  assert.equal(talk.BARGE_HOLD_MS >= 400 && talk.BARGE_HOLD_MS <= 600, true);
  assert.equal(talk.BARGE_GRACE_MS, 300);
  var learned = talk.createBargeWatch({ baseline: 0.03 });
  learned.noteSentence(0);
  learned.push({ rms: 0.5, dt: 40, now: 10 });
  assert.ok(learned.baseline() > 0.1);
  learned.release();
  assert.equal(learned.baseline(), 0.03);

  var stuck = talk.createTalkWatchdog();
  stuck.enter('speaking', 0);
  assert.equal(stuck.tick(10000, { lastProgress: 9000 }).recover, false);
  assert.equal(stuck.tick(30000, { lastProgress: 0 }).recover, true);
  assert.equal(stuck.tick(30000, { lastProgress: 0 }).from, 'speaking');
  stuck.enter('thinking', 0);
  assert.equal(stuck.tick(5000, { transcribeSince: 4000 }).recover, false);
  assert.equal(stuck.tick(80000, { lastProgress: 70000 }).recover, false);
  assert.equal(stuck.tick(80000, { lastProgress: 0 }).from, 'thinking');
  assert.equal(stuck.tick(20000, { transcribeSince: 0 }).from, 'transcribing');
  assert.equal(stuck.tick(20000, { transcribeSince: 0 }).recover, true);
  var many = talk.simulateTalkTurns(10);
  assert.equal(many.phase, 'listening');
  assert.equal(many.turns, 10);
  assert.equal(many.recovered, null);
  assert.ok(many.log.filter(function (name) { return name === 'listening'; }).length >= 11);

  var mogulStall = talk.simulateTalkTurns(1, { style: 'natural', stall: true });
  assert.equal(mogulStall.recovered.from, 'speaking');
  assert.equal(mogulStall.phase, 'listening');
  assert.equal(talk.statusLabel(mogulStall.phase, false), 'Listening');

  var turnStall = talk.simulateTalkTurns(1, { style: 'turn', stall: true });
  assert.equal(turnStall.style, 'turn');
  assert.equal(turnStall.recovered.from, 'speaking');
  assert.equal(turnStall.recovered.phase, 'ready');
  assert.equal(turnStall.phase, 'ready');
  assert.equal(talk.statusLabel(turnStall.phase, false), 'Your turn — tap Talk');
  assert.equal(talk.COPY.yourTurn, 'Your turn — tap Talk');

  const session = fs.readFileSync(path.join(root, 'assets/js/aris-talk-session.js'), 'utf8');
  assert.match(session, /createBargeWatch/);
  assert.match(session, /logPlayback\('barge-in confirmed '/);
  assert.match(session, /logPlayback\('queue-end'\)/);
  assert.match(session, /logPlayback\('tts-error'\)/);
  assert.match(session, /ARIS talk state:/);
  assert.match(session, /createTalkWatchdog/);
  assert.match(session, /recoverToListening/);
  assert.match(session, /function recoverToListening\(reason\) \{[\s\S]*?returnToMember\(\)/);
  assert.equal(/function recoverToListening\(reason\) \{[\s\S]*?machine\.markListening\(/.test(session), false);
  assert.match(session, /logPlayback\('recorder-error'\)/);
  assert.match(session, /speechDeadline/);
  assert.match(session, /recoverToListening\('stream'\)/);
  assert.equal(/tts-error[\s\S]{0,80}fail\(/.test(session), false);
  const coach = fs.readFileSync(path.join(root, 'aris-coach.html'), 'utf8');
  assert.match(coach, /abortCoachStream/);
  assert.match(coach, /talkHook\('shouldAbort'\)/);
});

test('unlimited members skip the cap and other members do not', async () => {
  const store = talk.createMemoryStore();
  const env = {
    TALK_MODE_ENABLED: 'true',
    TALK_MODE_UNLIMITED: 'Mem_John',
    ARIS_TALK_CAP_MINUTES: '1',
  };
  const { handler } = handlerFor(env, store);
  const over = await call(handler, 'POST', {
    action: 'add',
    listenSeconds: 50,
    speakSeconds: 40,
    requestId: 'owner-1',
  });
  assert.equal(over.body.unlimited, true);
  assert.equal(over.body.capped, false);
  assert.equal(over.body.acceptedListen, 50);
  assert.equal(over.body.acceptedSpeak, 40);
  assert.equal(talk.talkTimeBlocked(over.body), false);
  const status = await call(handler, 'GET');
  assert.equal(status.body.capped, false);
  assert.equal(status.body.unlimited, true);
  assert.ok(status.body.remainingSeconds > 0);

  const other = handlerFor({
    TALK_MODE_ENABLED: 'true',
    ARIS_TALK_CAP_MINUTES: '1',
  }, talk.createMemoryStore(), {
    enforce: async () => ({ access: { memberId: 'mem_other', active: true } }),
  });
  const blocked = await call(other.handler, 'POST', {
    action: 'add',
    listenSeconds: 50,
    speakSeconds: 40,
    requestId: 'other-1',
  });
  assert.equal(blocked.body.unlimited, false);
  assert.equal(blocked.body.capped, true);
  assert.equal(talk.talkTimeBlocked(blocked.body), true);

  const byEmail = handlerFor({
    TALK_MODE_ENABLED: 'true',
    TALK_MODE_UNLIMITED: 'owner@example.com',
    ARIS_TALK_CAP_MINUTES: '1',
  }, talk.createMemoryStore(), {
    enforce: async () => ({ access: { memberId: 'mem_owner', active: true } }),
    getMember: async () => ({ auth: { email: 'owner@example.com' } }),
  });
  const mailed = await call(byEmail.handler, 'GET');
  assert.equal(mailed.body.unlimited, true);
  assert.equal(mailed.body.capped, false);

  const src = fs.readFileSync(path.join(root, 'assets/js/aris-talk.js'), 'utf8')
    + fs.readFileSync(path.join(root, 'netlify/functions/aris-talk.js'), 'utf8')
    + fs.readFileSync(path.join(root, 'docs/ARIS-TALK-MODE.md'), 'utf8');
  assert.equal(src.includes('mem_cmrjn9b9z1x7p0sql1r0j3fxs'), false);
  assert.match(src, /TALK_MODE_UNLIMITED/);
});

test('Talk Mode stays off unless the global flag or allowlist matches', () => {
  assert.deepEqual(talkModeAccess({ env: {}, memberId: 'mem_john', email: 'john@thedessauergroup.com' }), {
    enabled: false,
    reason: 'off',
  });
  assert.equal(talkModeAccess({ env: { TALK_MODE_ENABLED: 'false' }, memberId: 'mem_john' }).enabled, false);
  assert.equal(talkModeAccess({ env: { TALK_MODE_ENABLED: 'yes' }, memberId: 'mem_john' }).reason, 'global');
  assert.equal(talkModeAccess({
    env: { TALK_MODE_ALLOWLIST: ' mem_other , John@Example.com ' },
    memberId: 'mem_john',
    email: 'john@example.com',
  }).reason, 'allowlist');
  assert.equal(talkModeAccess({
    env: { TALK_MODE_ALLOWLIST: 'mem_john' },
    memberId: 'mem_john',
    email: '',
  }).enabled, true);
  assert.equal(talkModeAccess({
    env: { TALK_MODE_ENABLED: 'true', TALK_MODE_ALLOWLIST: 'nobody@example.com' },
    memberId: 'mem_else',
    email: 'else@example.com',
  }).reason, 'global');
});

function handlerFor(env, store, extras) {
  const lines = [];
  const log = {
    log: (message) => lines.push(String(message)),
    error: (message) => lines.push('ERR ' + String(message)),
  };
  const handler = createHandler(Object.assign({
    env: env,
    now: () => new Date('2026-11-27T18:00:00Z'),
    store: store,
    log: log,
    enforce: async () => ({ access: { memberId: 'mem_john', active: true } }),
    getMember: async () => ({ auth: { email: 'john@example.com' } }),
  }, extras || {}));
  return { handler, lines };
}

async function call(handler, method, body) {
  const res = await handler({
    httpMethod: method,
    headers: { authorization: 'Bearer token' },
    body: body ? JSON.stringify(body) : '',
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

test('status hides Talk Mode when the flag is off and does not read usage', async () => {
  let reads = 0;
  const store = {
    async read() { reads += 1; return { usedSeconds: 0 }; },
    async monthTotal() { return 0; },
    async hasAlert() { return false; },
    async insertAlert() { return true; },
    async add() { throw new Error('no add'); },
  };
  const { handler, lines } = handlerFor({}, store);
  const res = await call(handler, 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(reads, 0);
  assert.equal(lines.some((line) => /ARIS_TALK_ALERT|@/.test(line)), false);
});

test('allowlisted member can add minutes, hit the cap, and raise the log alert once', async () => {
  const store = talk.createMemoryStore();
  const env = {
    TALK_MODE_ALLOWLIST: 'john@example.com',
    ARIS_TALK_CAP_MINUTES: '1',
    ARIS_TALK_IDLE_SECONDS: '150',
    ARIS_TALK_ALERT_MINUTES: '1',
  };
  const { handler, lines } = handlerFor(env, store);
  const status = await call(handler, 'GET');
  assert.equal(status.status, 200);
  assert.equal(status.body.enabled, true);
  assert.equal(status.body.capSeconds, 60);
  assert.equal(status.body.idleMs, 150000);
  assert.equal(status.body.monthKey, monthKeyFromDate(new Date('2026-11-27T18:00:00Z')));
  assert.equal(status.body.capped, false);

  const add = await call(handler, 'POST', {
    action: 'add',
    listenSeconds: 40,
    speakSeconds: 30,
    requestId: 'req-1',
  });
  assert.equal(add.status, 200);
  assert.equal(add.body.acceptedListen, 40);
  assert.equal(add.body.acceptedSpeak, 20);
  assert.equal(add.body.capped, true);
  assert.match(add.body.capMessage, /Talk Mode/);
  assert.equal(/elevenlabs|scribe/i.test(JSON.stringify(add.body)), false);

  const replay = await call(handler, 'POST', {
    action: 'add',
    listenSeconds: 40,
    speakSeconds: 30,
    requestId: 'req-1',
  });
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.usedSeconds, 60);

  const alerts = lines.filter((line) => line.startsWith('ARIS_TALK_ALERT'));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /note=log-only-no-email/);
  assert.equal(lines.some((line) => /mailto|sendgrid|nodemailer/i.test(line)), false);

  const again = await call(handler, 'GET');
  assert.equal(again.body.capped, true);
  assert.equal(lines.filter((line) => line.startsWith('ARIS_TALK_ALERT')).length, 1);
});

test('global flag does not need an email lookup', async () => {
  const store = talk.createMemoryStore();
  const { handler } = handlerFor(
    { TALK_MODE_ENABLED: 'true' },
    store,
    { getMember: async () => { throw new Error('should not look up email'); } }
  );
  const res = await call(handler, 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.capSeconds, 1800);
});

test('a signed-out caller cannot read or add Talk Mode usage', async () => {
  const { handler } = handlerFor({}, talk.createMemoryStore(), {
    enforce: async () => ({ response: { statusCode: 401, body: JSON.stringify({ error: 'Active membership required' }) } }),
  });
  const res = await call(handler, 'POST', { action: 'add', listenSeconds: 5, speakSeconds: 0, requestId: 'x' });
  assert.equal(res.status, 401);
});

test('coach page gates Talk Mode and the dashboard Ask ARIS box does not get it', () => {
  const coach = fs.readFileSync(path.join(root, 'aris-coach.html'), 'utf8');
  const dash = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  assert.match(coach, /id="talk-btn"[^>]*hidden/);
  assert.match(coach, /id="talk-pack"[^>]*hidden/);
  assert.match(coach, /Talk Mode paused — tap to resume/);
  assert.match(coach, /\/assets\/js\/aris-talk\.js/);
  assert.match(coach, /\/assets\/js\/aris-talk-session\.js/);
  assert.match(coach, /ForgeTalkSession\.attach/);
  assert.equal(dash.includes('talk-btn'), false);
  assert.equal(dash.includes('ForgeTalk'), false);
  assert.equal(dash.includes('TALK_MODE'), false);
  assert.equal(dash.includes('aris-talk'), false);

  const fn = fs.readFileSync(path.join(root, 'netlify/functions/aris-talk.js'), 'utf8');
  const session = fs.readFileSync(path.join(root, 'assets/js/aris-talk-session.js'), 'utf8');
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(fn), false);
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(session), false);
  assert.match(session, /\/api\/aris-transcribe/);
  assert.match(session, /onResearch/);
  assert.equal(session.includes('createScriptProcessor'), false);
  assert.match(session, /new MediaRecorder/);
  assert.match(session, /createHidePause/);
  assert.match(session, /DEFAULT_SILENCE_MS/);
  assert.match(session, /\/api\/aris-voice/);
  assert.match(session, /\/api\/aris-talk/);
  assert.equal(/SpeechRecognition|webkitSpeechRecognition/.test(session), false);

  const sql = fs.readFileSync(path.join(root, 'sql/migrations/add-aris-talk-usage.sql'), 'utf8');
  assert.match(sql, /add_aris_talk_seconds/);
  assert.match(sql, /aris_talk_alert_log/);
  assert.match(sql, /for update/);
  assert.match(sql, /replayed/);
  assert.match(sql, /does not\s+send email/i);
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(toml, /\/api\/aris-talk/);
  assert.match(toml, /\/api\/aris-talk-pack/);
  assert.match(toml, /\/docs\/ARIS-TALK-MODE\.md/);
  assert.match(session, /returnToMember/);
  assert.match(session, /lastStatus\.style === 'turn'/);
  assert.match(session, /\/api\/aris-talk-pack/);
  assert.equal(/createRequire\s*\(\s*import\.meta\.url\s*\)/.test(session), false);
});

test('Mogul is hands-free with 600 minutes; everyone else takes turns at the 30 minute cap', () => {
  assert.equal(talk.isMogul({ id: 'mem_student' }, { env: {} }), false);
  assert.equal(talk.isMogul({
    id: 'mem_empire',
    planConnections: [{ planId: 'pln_empire--871c00ah3', status: 'ACTIVE' }],
  }, { env: {} }), false);
  assert.equal(talk.isMogul({ id: 'mem_m' }, { awards: { investor: true, mogul: false } }), false);
  assert.equal(talk.isMogul({ id: 'mem_m' }, { awards: { mogul: true } }), true);
  assert.equal(talk.isMogul({ id: 'Mem_Test' }, {
    env: { TALK_MOGUL_MEMBER_IDS: 'mem_test, coach@example.com' },
  }), true);
  assert.equal(talk.isMogul({ auth: { email: 'Coach@Example.com' } }, {
    env: { TALK_MOGUL_MEMBER_IDS: 'coach@example.com' },
  }), true);

  const mogul = talk.talkAllowance({
    env: { ARIS_TALK_CAP_MINUTES: '30' },
    memberId: 'mem_m',
    awards: { mogul: true },
    usedSeconds: 0,
  });
  assert.equal(mogul.mogul, true);
  assert.equal(mogul.style, 'natural');
  assert.equal(mogul.capSeconds, 600 * 60);
  assert.equal(mogul.packOffer, null);

  const near = talk.talkAllowance({
    awards: { mogul: true },
    usedSeconds: Math.floor(600 * 60 * 0.9),
  });
  assert.equal(near.warnLevel, 90);
  assert.match(near.warnMessage, /90%/);
  assert.equal(near.packOffer, null);
  const closer = talk.talkAllowance({
    awards: { mogul: true },
    usedSeconds: Math.floor(600 * 60 * 0.95),
  });
  assert.equal(closer.warnLevel, 95);
  assert.equal(closer.capped, false);
  const stopped = talk.talkAllowance({
    awards: { mogul: true },
    usedSeconds: 600 * 60,
  });
  assert.equal(stopped.capped, true);
  assert.equal(stopped.warnLevel, 0);
  assert.equal(stopped.packOffer.minutes, 60);
  assert.equal(stopped.packOffer.amountCents, 1997);
  assert.match(stopped.packOffer.label, /\$19\.97/);
  assert.equal(/stripe|memberstack|supabase/i.test(stopped.packOffer.label), false);

  const student = talk.talkAllowance({
    env: { ARIS_TALK_CAP_MINUTES: '30' },
    usedSeconds: 0,
  });
  assert.equal(student.mogul, false);
  assert.equal(student.style, 'turn');
  assert.equal(student.capSeconds, 30 * 60);
  const withPack = talk.talkAllowance({
    env: { ARIS_TALK_CAP_MINUTES: '30' },
    usedSeconds: 30 * 60,
    packSeconds: talk.PACK_SECONDS,
  });
  assert.equal(withPack.capped, false);
  assert.equal(withPack.capSeconds, 30 * 60 + talk.PACK_SECONDS);
  assert.equal(withPack.packOffer, null);

  const staff = talk.talkAllowance({
    env: { TALK_MODE_UNLIMITED: 'mem_john', ARIS_TALK_CAP_MINUTES: '1' },
    memberId: 'mem_john',
    awards: { mogul: false },
    usedSeconds: 99999,
  });
  assert.equal(staff.unlimited, true);
  assert.equal(staff.style, 'natural');
  assert.equal(staff.capped, false);
  assert.equal(staff.packOffer, null);
});

test('turn-taking does not barge in and waits for the next tap', () => {
  const s = talk.createTalkSession({ style: 'turn' });
  assert.equal(s.style, 'turn');
  s.start(0);
  assert.equal(s.capture, true);
  s.memberSpeechEnd(1000);
  s.markSpeaking(1200);
  assert.equal(s.capture, false);
  assert.equal(s.playback, true);
  const barge = s.memberSpeechStart(1500);
  assert.equal(barge.bargeIn, false);
  assert.equal(s.phase, 'speaking');
  const yielded = s.yieldTurn(4000);
  assert.equal(yielded.stopMic, true);
  assert.equal(s.phase, 'ready');
  assert.equal(s.capture, false);
  assert.equal(talk.statusLabel('ready', false), talk.COPY.yourTurn);
  assert.equal(talk.buttonLabel('ready'), 'Talk');
  assert.equal(s.start(5000).ok, true);
  assert.equal(s.phase, 'listening');
  assert.equal(talk.planVadAction({ phase: 'speaking', allowBarge: false }, 'speech_start').barge, false);
  assert.equal(talk.planVadAction({ phase: 'speaking' }, 'speech_start').barge, true);
  const natural = talk.createTalkSession();
  assert.equal(natural.style, 'natural');
});

test('a Mogul allowance is 600 minutes and a stored badge or the env list is what counts', async () => {
  const byBadge = handlerFor({ TALK_MODE_ENABLED: 'true' }, talk.createMemoryStore({ moguls: ['mem_john'] }));
  const badge = await call(byBadge.handler, 'GET');
  assert.equal(badge.body.mogul, true);
  assert.equal(badge.body.style, 'natural');
  assert.equal(badge.body.capSeconds, 600 * 60);
  assert.equal(badge.body.packOffer, null);

  const byEnv = handlerFor({
    TALK_MODE_ENABLED: 'true',
    TALK_MOGUL_MEMBER_IDS: 'mem_john',
    ARIS_TALK_CAP_MINUTES: '5',
  }, talk.createMemoryStore());
  const listed = await call(byEnv.handler, 'GET');
  assert.equal(listed.body.mogul, true);
  assert.equal(listed.body.capSeconds, 600 * 60);
  assert.equal(listed.body.style, 'natural');

  const student = handlerFor({
    TALK_MODE_ENABLED: 'true',
    ARIS_TALK_CAP_MINUTES: '1',
  }, talk.createMemoryStore());
  const open = await call(student.handler, 'GET');
  assert.equal(open.body.style, 'turn');
  assert.equal(open.body.mogul, false);
  assert.equal(open.body.capSeconds, 60);
  assert.equal(open.body.packOffer, null);

  const warm = await call(student.handler, 'POST', {
    action: 'add',
    listenSeconds: 54,
    speakSeconds: 0,
    requestId: 'warm',
  });
  assert.equal(warm.body.warnLevel, 90);
  assert.equal(warm.body.capped, false);
  assert.equal(warm.body.packOffer, null);

  const capped = await call(student.handler, 'POST', {
    action: 'add',
    listenSeconds: 20,
    speakSeconds: 0,
    requestId: 'cap',
  });
  assert.equal(capped.body.capped, true);
  assert.equal(capped.body.packOffer.amountCents, 1997);
  assert.equal(/stripe|memberstack|supabase|elevenlabs/i.test(JSON.stringify(capped.body)), false);
});
