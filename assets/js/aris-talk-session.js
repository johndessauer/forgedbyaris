/* ARIS Talk Mode browser loop. Coach page only.
 *
 * One tap unlocks playback, opens the microphone, then:
 * listen -> silence -> the existing transcribe path -> the existing
 * chat send -> speak each finished sentence with the existing voice
 * path -> listen again. Member speech during playback stops the audio
 * and starts a new turn. Two minutes without member speech pauses the
 * mic so no further minutes are counted. The control stays hidden
 * until /api/aris-talk says this member is allowed.
 *
 * style "turn" (below Mogul) closes the mic after each utterance and
 * does not barge in. style "natural" keeps this hands-free loop.
 * recoverToListening() calls returnToMember(). Turn-taking recovery
 * waits with "Your turn — tap Talk." Hands-free recovery listens again.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeTalkSession = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  var live = null;

  function attach(page) {
    if (!root.ForgeTalk || !page || live) return;
    var btn = document.getElementById('talk-btn');
    var statusEl = document.getElementById('talk-status');
    var resumeEl = document.getElementById('talk-resume');
    var interruptEl = document.getElementById('talk-interrupt');
    var packBtn = document.getElementById('talk-pack');
    if (!btn || !statusEl || !resumeEl) return;

    var COPY = root.ForgeTalk.COPY;
    var machine = null;
    var lastStatus = null;
    var stream = null;
    var analyser = null;
    var timeBuf = null;
    var vad = root.ForgeTalk.createVad({ silenceMs: root.ForgeTalk.DEFAULT_SILENCE_MS });
    var hidePause = root.ForgeTalk.createHidePause();
    var researchSpoken = false;
    var utteranceLive = false;
    var priming = false;
    var bargeWatch = root.ForgeTalk.createBargeWatch(root.ForgeTalk.bargeWatchOptions(root));
    var bargeHold = false;
    var bargeToken = 0;
    var currentSpoken = '';
    var playingSpoken = '';
    var previousSpoken = '';
    var currentPrev = '';
    var bargeArmedAt = 0;
    var lastArmLog = 0;
    var ducked = false;
    var bargeLeadText = '';
    var lastRms = 0;
    var recorder = null;
    var chunks = [];
    var clipToken = 0;
    var loopOn = false;
    var raf = 0;
    var lastFrame = 0;
    var playToken = 0;
    var queue = [];
    var clips = [];
    var clipCursor = 0;
    var nextStart = 0;
    var activeSources = [];
    var pumping = false;
    var spokenCount = 0;
    var autoSpeak = false;
    var turn = 0;
    var abortFlag = false;
    var replyChain = Promise.resolve();
    var inflight = null;
    var flushing = null;
    var ending = false;
    var showWarning = false;
    var headsUpPlayed = false;
    var headsAudio = null;
    var capNoted = false;
    var notedWarn = 0;
    var packBuying = false;
    var flushTimer = 0;
    var unlockCtx = null;
    var enabled = false;
    var loggedPhase = '';
    var watchdog = root.ForgeTalk.createTalkWatchdog();
    var lastProgress = 0;
    var speechDeadline = 0;
    var micOpening = false;
    var micReviveAt = 0;
    var watchTimer = 0;
    var transcribeSince = 0;
    var silentSince = 0;
    var cueUntil = 0;

    function now() { return Date.now(); }

    function tokenHeader() {
      var token = page.getToken ? page.getToken() : '';
      return token ? { Authorization: 'Bearer ' + token } : {};
    }

    function logState(name) {
      try { console.info('ARIS talk state: ' + name); } catch (err) {}
    }

    function render() {
      var phase = machine ? machine.phase : 'off';
      if (phase !== loggedPhase) {
        logState(phase);
        loggedPhase = phase;
        watchdog.enter(phase, now());
        if (phase === 'listening') {
          silentSince = now();
          if (bargeWatch.release) bargeWatch.release();
        }
        if (phase === 'speaking') lastProgress = now();
      }
      btn.hidden = !enabled;
      btn.textContent = root.ForgeTalk.buttonLabel(phase);
      btn.classList.toggle('active', phase === 'listening' || phase === 'thinking' || phase === 'speaking');
      btn.setAttribute('aria-pressed', (phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'paused') ? 'true' : 'false');
      var showStatus = phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'ready';
      statusEl.hidden = !showStatus;
      if (showStatus) {
        statusEl.textContent = (phase === 'listening' && now() < cueUntil)
          ? COPY.here
          : root.ForgeTalk.statusLabel(phase, showWarning);
      }
      resumeEl.hidden = phase !== 'paused';
      if (interruptEl) interruptEl.hidden = !(enabled && phase === 'speaking');
      if (packBtn) {
        var offer = lastStatus && lastStatus.packOffer;
        var showPack = phase === 'capped' && !!offer;
        packBtn.hidden = !showPack;
        if (showPack && offer.label) packBtn.textContent = offer.label;
      }
      if (lastStatus && lastStatus.style === 'turn') btn.title = 'Tap to take your turn with ARIS';
      else btn.title = 'Talk with ARIS hands-free';
      if (page.setPushToTalkEnabled) {
        page.setPushToTalkEnabled(!(phase === 'listening' || phase === 'thinking' || phase === 'speaking'));
      }
    }

    function unlockAudio() {
      var AC = root.AudioContext || root.webkitAudioContext;
      try {
        if (AC) {
          if (!unlockCtx) unlockCtx = new AC();
          unlockCtx.resume();
          var buffer = unlockCtx.createBuffer(1, 1, 22050);
          var src = unlockCtx.createBufferSource();
          src.buffer = buffer;
          src.connect(unlockCtx.destination);
          src.start(0);
        }
      } catch (err) {}
      try {
        var silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
        var played = silent.play();
        if (played && played.catch) played.catch(function () {});
      } catch (err) {}
    }

    function openMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('mic'));
      }
      return navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }).catch(function (err) {
        var wrapped = new Error('mic');
        wrapped.cause = err;
        throw wrapped;
      }).then(function (micStream) {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return { stream: micStream, analyser: null };
        var ctx = unlockCtx || new AC();
        unlockCtx = ctx;
        return Promise.resolve(ctx.resume()).catch(function () {}).then(function () {
          var source = ctx.createMediaStreamSource(micStream);
          var node = ctx.createAnalyser();
          node.fftSize = 2048;
          source.connect(node);
          return { stream: micStream, analyser: node };
        });
      });
    }

    function releaseMic() {
      loopOn = false;
      utteranceLive = false;
      priming = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clipToken += 1;
      if (recorder && recorder.state === 'recording') {
        try { recorder.stop(); } catch (err) {}
      }
      recorder = null;
      chunks = [];
      if (stream) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        stream = null;
      }
      analyser = null;
      vad.reset();
    }

    function stopSources() {
      activeSources.forEach(function (item) {
        try { item.source.stop(); } catch (err) {}
        try { if (item.gain) item.gain.disconnect(); } catch (err) {}
      });
      activeSources = [];
    }

    function logPlayback(reason) {
      try { console.info('ARIS talk playback: ' + reason); } catch (err) {}
    }

    function haltPlayback() {
      playToken += 1;
      clips.forEach(function (clip) {
        clip.state = 'cancelled';
        if (clip.controller) {
          try { clip.controller.abort(); } catch (err) {}
        }
      });
      clips = [];
      clipCursor = 0;
      nextStart = 0;
      queue = [];
      pumping = false;
      spokenCount = 0;
      bargeToken += 1;
      bargeHold = false;
      bargeWatch.reset();
      ducked = false;
      playingSpoken = '';
      previousSpoken = '';
      stopSources();
      if (headsAudio) {
        try { headsAudio.stop(); } catch (err) {}
        headsAudio = null;
      }
    }

    function adoptMic(opened) {
      stream = opened.stream;
      analyser = opened.analyser;
      timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
      vad.reset();
      utteranceLive = false;
      priming = false;
      loopOn = true;
      lastFrame = 0;
      var frame = function () {
        if (!loopOn || !machine) return;
        audioContext();
        var t = now();
        var hidden = hidePause.tick(t, document.visibilityState);
        if (hidden.pause) {
          pauseSession();
          return;
        }
        var ev = machine.tick(t);
        if (ev.paused) {
          showWarning = false;
          pauseSession();
          return;
        }
        if (ev.warning && machine.phase === 'listening') {
          showWarning = true;
          render();
          playHeadsUp();
        }
        if (analyser && timeBuf && machine.capture) {
          analyser.getByteTimeDomainData(timeBuf);
          var dt = lastFrame ? t - lastFrame : 50;
          lastFrame = t;
          var rms = root.ForgeTalk.rmsFromTimeDomain(timeBuf);
          lastRms = rms;
          if (machine.phase === 'speaking') handleSpeakerLevel(rms, dt, t);
          else {
            if (bargeWatch.observeListening) bargeWatch.observeListening(rms);
            handleVad(vad.push(rms, dt, 'listening'));
          }
          if (machine.phase === 'speaking' && activeSources.length && t < speechDeadline + 1200) {
            var playing = audioContext();
            if (playing && playing.state === 'running') lastProgress = t;
          }
        }
        watchdogTick();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    function handleVad(heard) {
      if (!machine) return;
      // Echo cancellation stays on in getUserMedia. The speaking threshold
      // is higher than listening, so the speaker does not count as the member.
      // The recorder arms on the first loud frames and keeps rolling through
      // the new utterance after playback stops.
      var plan = root.ForgeTalk.planVadAction({
        phase: machine.phase,
        priming: priming,
        utteranceLive: utteranceLive,
        allowBarge: !(lastStatus && lastStatus.style === 'turn'),
      }, heard);
      if (plan.prime) {
        startRecorder();
        priming = true;
      }
      if (plan.clearPrime) priming = false;
      if (plan.live === true) utteranceLive = true;
      if (plan.live === false) utteranceLive = false;
      if (plan.discard) {
        discardRecording();
        return;
      }
      if (plan.barge) {
        showWarning = false;
        headsUpPlayed = false;
        stopHeadsAudio();
        turn += 1;
        abortFlag = true;
        haltPlayback();
        machine.memberSpeechStart(now());
        autoSpeak = true;
        researchSpoken = false;
        if (plan.ensureRecorder) startRecorder();
        render();
        return;
      }
      if (plan.note && machine.phase === 'listening') {
        machine.noteMemberSpeech(now());
        silentSince = now();
      }
      if (plan.ensureRecorder) startRecorder();
      if (plan.finish) finishRecorder();
    }

    function handleSpeakerLevel(rms, dt, t) {
      // Turn-taking closes the mic and must not duck or stop the reply.
      if (turnStyle()) return;
      syncPlayingSentence(t);
      if (bargeHold || utteranceLive) return;
      var gate = bargeWatch.push({ rms: rms, dt: dt, now: t });
      // Duck as soon as speech is being detected, not after the full hold.
      if (gate === 'arm' || gate === 'candidate') {
        logBargeArm(rms, t);
        if (!ducked) duckPlayback();
      }
      if (gate === 'arm' && !priming) {
        startRecorder('hold');
        priming = true;
      }
      if (gate === 'idle' && priming) {
        priming = false;
        discardRecording();
        bargeWatch.reset();
      }
      if (gate === 'idle') restorePlayback();
      if (gate === 'candidate') {
        bargeHold = true;
        priming = false;
        bargeArmedAt = t;
        logPlayback('barge-candidate');
        confirmBarge();
      }
    }

    function logBargeArm(rms, t) {
      if (t - lastArmLog < 500) return;
      lastArmLog = t;
      var ceiling = bargeWatch.limit ? bargeWatch.limit() : 0;
      var platform = bargeWatch.platform || 'desktop';
      logPlayback('barge-arm level=' + Number(rms).toFixed(3) + ' limit=' + Number(ceiling).toFixed(3) + ' platform=' + platform);
    }

    function rampActiveGain(value, rampMs) {
      if (turnStyle()) return;
      var ctx = audioContext();
      if (!ctx) return;
      var at = ctx.currentTime;
      var ramp = Math.max(0.01, (Number(rampMs) || 50) / 1000);
      activeSources.forEach(function (item) {
        if (!item.gain || !item.gain.gain) return;
        try {
          var param = item.gain.gain;
          param.cancelScheduledValues(at);
          param.setValueAtTime(param.value, at);
          param.linearRampToValueAtTime(value, at + ramp);
          if (value >= 0.99 && item.endAt && item.endAt > at + ramp + 0.02) {
            var fade = 0.015;
            param.setValueAtTime(1, Math.max(at + ramp, item.endAt - fade));
            param.linearRampToValueAtTime(0, item.endAt);
          }
        } catch (err) {}
      });
    }

    function duckPlayback() {
      if (turnStyle()) return;
      var plan = root.ForgeTalk.bargeGainPlan('duck');
      rampActiveGain(plan.gain, plan.rampMs);
      ducked = true;
      logPlayback('barge-duck');
    }

    function restorePlayback() {
      if (!ducked || turnStyle()) return;
      var plan = root.ForgeTalk.bargeGainPlan('restore');
      rampActiveGain(plan.gain, plan.rampMs);
      ducked = false;
      logPlayback('barge-restore');
    }

    // The sentence coming out of the speakers, plus the one before it.
    // currentSpoken is only the last clip we scheduled, which can be ahead.
    function syncPlayingSentence(t) {
      var ctx = audioContext();
      if (!ctx || !activeSources.length) return;
      var audioNow = ctx.currentTime;
      var latest = null;
      var i;
      for (i = 0; i < activeSources.length; i += 1) {
        var item = activeSources[i];
        if (!item || item.startAt == null) continue;
        if (audioNow + 0.001 < item.startAt) continue;
        if (item.endAt != null && audioNow > item.endAt) continue;
        if (!latest || item.startAt >= latest.startAt) latest = item;
      }
      if (!latest || latest.opened) return;
      latest.opened = true;
      if (latest.text && latest.text !== playingSpoken) {
        previousSpoken = playingSpoken;
        playingSpoken = latest.text;
      }
      if (bargeWatch.noteSentence) bargeWatch.noteSentence(t);
    }

    function spokenForEcho() {
      syncPlayingSentence(now());
      if (playingSpoken) return { spoken: playingSpoken, previous: previousSpoken };
      return { spoken: currentSpoken, previous: currentPrev };
    }

    function rejectBarge(reason) {
      logPlayback('barge-rejected ' + reason);
      bargeHold = false;
      bargeWatch.reset();
      restorePlayback();
    }

    function takeRecording() {
      return new Promise(function (resolve) {
        if (!recorder || recorder.state !== 'recording') {
          resolve(null);
          return;
        }
        var rec = recorder;
        var mime = rec.mimeType || 'audio/webm';
        var pending = chunks.slice();
        var settled = false;
        function finish(blob) {
          if (settled) return;
          settled = true;
          resolve(blob);
        }
        rec.onstop = function () {
          if (settled) return;
          var extra = chunks.slice();
          chunks = [];
          if (recorder === rec) recorder = null;
          finish(new Blob(pending.concat(extra), { type: mime }));
        };
        try { rec.stop(); }
        catch (err) {
          if (recorder === rec) recorder = null;
          finish(null);
        }
        root.setTimeout(function () {
          if (settled) return;
          if (recorder === rec) recorder = null;
          chunks = [];
          finish(null);
        }, 2500);
      });
    }

    function confirmBarge() {
      if (turnStyle()) return;
      var token = bargeToken;
      var pair = spokenForEcho();
      var spoken = pair.spoken;
      var previous = pair.previous;
      takeRecording().then(function (blob) {
        if (token !== bargeToken) return null;
        if (!blob || blob.size < 800) {
          rejectBarge('short-clip');
          return null;
        }
        startRecorder('hold');
        transcribeSince = now();
        return transcribe(blob, blob.type).then(function (text) {
          transcribeSince = 0;
          if (token !== bargeToken || !bargeHold) return;
          if (!text) {
            bargeLeadText = '';
            discardRecording();
            rejectBarge('empty');
            return;
          }
          if (root.ForgeTalk.interruptionIsEcho(text, spoken, previous)) {
            bargeLeadText = '';
            discardRecording();
            rejectBarge('echo');
            return;
          }
          bargeLeadText = text;
          bargeHold = false;
          commitBarge();
        });
      }).catch(function () {
        transcribeSince = 0;
        if (token !== bargeToken) return;
        discardRecording();
        rejectBarge('error');
      });
    }

    // Space or the Interrupt control. Same stop as a confirmed barge, with
    // no microphone level and no echo check. Works in natural and turn style.
    function manualBarge() {
      if (!machine || machine.phase !== 'speaking') return;
      logPlayback('barge-manual');
      bargeLeadText = '';
      discardRecording();
      showWarning = false;
      headsUpPlayed = false;
      stopHeadsAudio();
      turn += 1;
      abortFlag = true;
      autoSpeak = true;
      researchSpoken = false;
      haltPlayback();
      utteranceLive = false;
      priming = false;
      vad.reset();
      if (loopOn && micAlive()) {
        resumeListening();
        return;
      }
      reopenMicForListen();
    }

    function resumeListening() {
      utteranceLive = false;
      priming = false;
      vad.reset();
      if (machine && machine.phase !== 'off' && machine.phase !== 'paused' && machine.phase !== 'capped') {
        machine.markListening(now());
      }
      silentSince = now();
      render();
    }

    function reopenMicForListen() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      loopOn = false;
      if (stream) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (err) {}
        });
        stream = null;
      }
      analyser = null;
      openMic().then(function (opened) {
        if (!machine || machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') {
          releaseOpened(opened);
          return;
        }
        adoptMic(opened);
        resumeListening();
      }).catch(function () {
        resumeListening();
        logState('mic-dead');
      });
    }

    function commitBarge() {
      if (turnStyle()) return;
      var latency = bargeArmedAt ? Math.max(0, now() - bargeArmedAt) : 0;
      logPlayback('barge-in confirmed ' + latency + 'ms');
      showWarning = false;
      headsUpPlayed = false;
      stopHeadsAudio();
      turn += 1;
      abortFlag = true;
      if (machine) machine.memberSpeechStart(now());
      haltPlayback();
      autoSpeak = true;
      researchSpoken = false;
      utteranceLive = true;
      priming = false;
      vad.reset();
      bargeWatch.reset();
      if (recorder && recorder.state === 'recording') recorder._intent = 'send';
      else startRecorder('send');
      if (lastRms < 0.045) finishRecorder();
      render();
    }

    function startRecorder(intent) {
      if (!stream || typeof MediaRecorder === 'undefined') return;
      if (recorder && recorder.state === 'recording') {
        recorder._intent = intent || 'send';
        return;
      }
      clipToken += 1;
      var mine = clipToken;
      chunks = [];
      try {
        recorder = new MediaRecorder(stream);
        recorder._intent = intent || 'send';
        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = function () {
          var mime = (recorder && recorder.mimeType) || 'audio/webm';
          var intentNow = recorder && recorder._intent;
          var blob = new Blob(chunks, { type: mime });
          chunks = [];
          if (mine !== clipToken) return;
          if (intentNow === 'send') sendClip(blob, mime);
        };
        try { recorder.start(200); }
        catch (err) { recorder.start(); }
      } catch (err) {
        logPlayback('recorder-error');
        recorder = null;
      }
    }

    function finishRecorder() {
      if (!recorder || recorder.state !== 'recording') return;
      var rec = recorder;
      var mine = clipToken;
      var mime = rec.mimeType || 'audio/webm';
      var fired = false;
      var prior = rec.onstop;
      rec.onstop = function (event) {
        if (fired) return;
        fired = true;
        if (prior) prior(event);
      };
      try { rec.stop(); }
      catch (err) { fired = true; }
      root.setTimeout(function () {
        if (fired || mine !== clipToken) return;
        fired = true;
        var blob = new Blob(chunks, { type: mime });
        chunks = [];
        recorder = null;
        sendClip(blob, mime);
      }, 2500);
    }

    function discardRecording() {
      clipToken += 1;
      if (recorder && recorder.state === 'recording') {
        try { recorder.stop(); } catch (err) {}
      }
      chunks = [];
    }

    function turnStyle() {
      return !!(lastStatus && lastStatus.style === 'turn');
    }

    // Hands-free returns to listening. Turn-taking closes the mic and waits
    // for another tap. recoverToListening() uses this so a stall stays in style.
    function returnToMember() {
      if (!machine) return;
      if (turnStyle()) {
        machine.yieldTurn(now());
        releaseMic();
        flushSafe();
        return;
      }
      machine.markListening(now());
    }

    function closeMicForTurn() {
      loopOn = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      bargeHold = false;
      priming = false;
      utteranceLive = false;
      if (stream) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (err) {}
        });
        stream = null;
      }
      analyser = null;
      vad.reset();
    }

    function sendClip(blob, mime) {
      if (!machine || machine.phase === 'paused' || machine.phase === 'off' || machine.phase === 'capped') return;
      if (!blob || blob.size < 1000) {
        if (turnStyle()) {
          returnToMember();
          render();
        } else if (machine.phase === 'listening') render();
        return;
      }
      if (turnStyle()) closeMicForTurn();
      machine.memberSpeechEnd(now());
      render();
      transcribeSince = now();
      transcribe(blob, mime).then(function (text) {
        transcribeSince = 0;
        var lead = bargeLeadText;
        bargeLeadText = '';
        var full = [lead, text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (!machine || machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        if (!full) {
          if (turnStyle() && page.appendNote) page.appendNote(COPY.missedTurn);
          else statusEl.textContent = COPY.missed;
          returnToMember();
          render();
          return;
        }
        if (root.ForgeTalk.isEchoOf(full, COPY.headsUp)) {
          returnToMember();
          render();
          return;
        }
        autoSpeak = true;
        spokenCount = 0;
        researchSpoken = false;
        enqueueReply(full);
      }).catch(function () {
        transcribeSince = 0;
        recoverToListening('transcribing');
      });
    }

    function enqueueReply(text) {
      var mine = turn;
      replyChain = replyChain.catch(function () {}).then(function () {
        if (mine !== turn || !machine) return;
        stopSources();
        abortFlag = false;
        lastProgress = now();
        machine.markThinking(now());
        render();
        return page.sendText(text).then(function () {
          if (mine !== turn) return;
          finishReplyIfIdle(mine);
        });
      }).catch(function () {
        if (mine !== turn) return;
        recoverToListening('reply');
      });
    }

    function playbackBusy() {
      return clips.some(function (clip) {
        return clip.state === 'queued' || clip.state === 'fetch' || clip.state === 'ready' || clip.state === 'playing';
      });
    }

    function finishReplyIfIdle(mine) {
      if (mine !== turn || !machine) return;
      if (playbackBusy() || activeSources.length) return;
      if (machine.phase === 'thinking' || machine.phase === 'speaking') {
        logPlayback('queue-end');
        clips = [];
        clipCursor = 0;
        spokenCount = 0;
        nextStart = 0;
        returnToMember();
        showWarning = false;
        headsUpPlayed = false;
        render();
      }
    }

    function queueNewSentences(text, flush) {
      var diff = root.ForgeTalk.nextSentences(spokenCount, text, flush);
      var i;
      for (i = 0; i < diff.next.length; i += 1) {
        var sentence = diff.next[i];
        var prev = clips.length ? clips[clips.length - 1].text : '';
        clips.push({
          text: sentence,
          prev: prev,
          next: '',
          state: 'queued',
          controller: null,
          buffer: null,
        });
        if (clips.length >= 2 && clips[clips.length - 2].state === 'queued') {
          clips[clips.length - 2].next = sentence;
        }
      }
      spokenCount = flush ? 0 : diff.sentences.length;
      if (!diff.next.length) {
        if (flush) finishReplyIfIdle(turn);
        return;
      }
      drivePlayback();
    }

    function clipStates() {
      return clips.map(function (clip) {
        if (clip.state === 'playing' || clip.state === 'scheduled') return 'playing';
        return clip.state;
      });
    }

    function audioContext() {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      if (!unlockCtx) unlockCtx = new AC();
      if (unlockCtx.state === 'suspended' && unlockCtx.resume) unlockCtx.resume();
      return unlockCtx;
    }

    function requestVoice(text, previousText, nextText, controller) {
      if (page.stopClickToPlay) page.stopClickToPlay();
      var body = { text: text };
      if (previousText) body.previousText = String(previousText).slice(-800);
      if (nextText) body.nextText = String(nextText).slice(0, 800);
      var init = {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tokenHeader()),
        body: JSON.stringify(body),
      };
      if (controller) init.signal = controller.signal;
      return fetch('/api/aris-voice', init).then(function (res) {
        if (res.status === 400) return null;
        if (!res.ok) throw new Error('voice');
        return res.arrayBuffer();
      });
    }

    function decodeVoice(bytes) {
      var ctx = audioContext();
      if (!ctx || !ctx.decodeAudioData) return Promise.reject(new Error('voice'));
      var copy = bytes.slice(0);
      return new Promise(function (resolve, reject) {
        var result;
        try {
          result = ctx.decodeAudioData(copy, resolve, reject);
        } catch (err) {
          reject(err);
          return;
        }
        if (result && result.then) result.then(resolve, reject);
      });
    }

    function scheduleBuffer(buffer, token, hooks) {
      var ctx = audioContext();
      if (!ctx || token !== playToken) return null;
      var channel = buffer.getChannelData(0);
      var edge = root.ForgeTalk.trimPcmEdges(channel, buffer.sampleRate, { threshold: 0.015, maxSeconds: 0.04 });
      var offset = edge.start / buffer.sampleRate;
      var duration = Math.max(0.02, (edge.end - edge.start) / buffer.sampleRate);
      var follow = hooks && hooks.follow;
      var plan = root.ForgeTalk.playbackSchedule({
        now: ctx.currentTime,
        nextStart: follow ? nextStart : 0,
        duration: duration,
        fade: 0.015,
        crossfade: 0.012,
      });
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      var gain = ctx.createGain();
      var fade = plan.fade;
      var endAt = plan.startAt + plan.playFor;
      var peak = root.ForgeTalk.bargePlaybackPeak(ducked);
      gain.gain.setValueAtTime(0, plan.startAt);
      gain.gain.linearRampToValueAtTime(peak, plan.startAt + fade);
      if (peak >= 0.99) {
        gain.gain.setValueAtTime(1, Math.max(plan.startAt + fade, endAt - fade));
        gain.gain.linearRampToValueAtTime(0, endAt);
      } else {
        gain.gain.setValueAtTime(peak, endAt);
      }
      source.connect(gain);
      gain.connect(ctx.destination);
      try {
        source.start(plan.startAt, offset, plan.playFor);
      } catch (err) {
        return null;
      }
      if (follow) nextStart = plan.nextStart;
      var remainMs = Math.max(0, (plan.startAt + plan.playFor - ctx.currentTime) * 1000);
      speechDeadline = Math.max(speechDeadline, now() + remainMs);
      lastProgress = now();
      activeSources.push({
        source: source,
        gain: gain,
        startAt: plan.startAt,
        endAt: endAt,
        text: (hooks && hooks.text) || '',
      });
      source.onended = function () {
        activeSources = activeSources.filter(function (item) { return item.source !== source; });
        if (hooks && hooks.onended) hooks.onended();
      };
      return source;
    }

    function startClipFetch(index, token) {
      var clip = clips[index];
      if (!clip || clip.state !== 'queued' || token !== playToken) return;
      clip.state = 'fetch';
      if (clips[index + 1] && !clip.next) clip.next = clips[index + 1].text;
      var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      clip.controller = controller;
      var voiceTimer = root.setTimeout(function () {
        if (token !== playToken || clip.state !== 'fetch') return;
        clip.state = 'skipped';
        logPlayback('tts-error');
        if (controller) {
          try { controller.abort(); } catch (err) {}
        }
        drivePlayback();
      }, 12000);
      requestVoice(clip.text, clip.prev, clip.next, controller).then(function (bytes) {
        root.clearTimeout(voiceTimer);
        if (token !== playToken || clip.state === 'cancelled') return null;
        if (!bytes) {
          clip.state = 'skipped';
          logPlayback('tts-error');
          drivePlayback();
          return null;
        }
        return decodeVoice(bytes);
      }).then(function (buffer) {
        if (token !== playToken || clip.state === 'cancelled' || clip.state === 'skipped') return;
        if (!buffer) {
          clip.state = 'skipped';
          logPlayback('decode-error');
          drivePlayback();
          return;
        }
        clip.buffer = buffer;
        clip.state = 'ready';
        drivePlayback();
      }).catch(function (err) {
        root.clearTimeout(voiceTimer);
        if (token !== playToken || clip.state === 'cancelled' || clip.state === 'skipped') return;
        if (err && err.name === 'AbortError') return;
        clip.state = 'skipped';
        logPlayback('tts-error');
        drivePlayback();
      });
    }

    function scheduleReady(token) {
      if (token !== playToken) return;
      while (clipCursor < clips.length) {
        var clip = clips[clipCursor];
        if (clip.state === 'skipped' || clip.state === 'done') {
          clipCursor += 1;
          continue;
        }
        if (clip.state !== 'ready') break;
        var source = scheduleBuffer(clip.buffer, token, {
          follow: true,
          text: clip.text,
          onended: function () {
            if (clip.state === 'playing') clip.state = 'done';
            if (token !== playToken) return;
            if (!playbackBusy() && !activeSources.length) {
              pumping = false;
              finishReplyIfIdle(turn);
            }
          },
        });
        if (!source) {
          clip.state = 'done';
          clipCursor += 1;
          continue;
        }
        clip.state = 'playing';
        currentSpoken = clip.text;
        currentPrev = clip.prev || '';
        if (bargeWatch.noteScheduled) bargeWatch.noteScheduled();
        clipCursor += 1;
        if (machine && machine.phase !== 'speaking') {
          machine.markSpeaking(now());
          render();
        }
      }
    }

    function fillPrefetch(token) {
      root.ForgeTalk.planPrefetch(clipStates(), 2).forEach(function (index) {
        startClipFetch(index, token);
      });
    }

    function drivePlayback() {
      var token = playToken;
      if (token !== playToken) return;
      pumping = true;
      fillPrefetch(token);
      scheduleReady(token);
      fillPrefetch(token);
      if (!playbackBusy() && !activeSources.length) {
        pumping = false;
        finishReplyIfIdle(turn);
      }
    }

    function stopHeadsAudio() {
      if (!headsAudio) return;
      try { headsAudio.stop(); } catch (err) {}
      headsAudio = null;
    }

    function playHeadsUp() {
      if (headsUpPlayed || !machine || machine.phase !== 'listening') return;
      headsUpPlayed = true;
      var started = 0;
      requestVoice(COPY.headsUp, '', '').then(function (bytes) {
        if (!machine || machine.phase !== 'listening') return null;
        return decodeVoice(bytes);
      }).then(function (buffer) {
        if (!buffer || !machine || machine.phase !== 'listening') return;
        started = now();
        headsAudio = scheduleBuffer(buffer, playToken, {
          follow: false,
          onended: function () {
            headsAudio = null;
            if (machine && started) machine.addSpeakMs(now() - started);
          },
        });
      }).catch(function () {});
    }

    function transcribe(blob, mime) {
      return fetch('/api/aris-transcribe', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': mime || 'audio/webm' }, tokenHeader()),
        body: blob,
      }).then(function (res) {
        if (!res.ok) throw new Error('transcribe');
        return res.json();
      }).then(function (data) {
        return data && data.text ? String(data.text).trim() : '';
      });
    }

    function newRequestId() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      return 'talk-' + now() + '-' + Math.random().toString(16).slice(2);
    }

    function postUsage(batch) {
      return fetch('/api/aris-talk', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tokenHeader()),
        body: JSON.stringify({
          action: 'add',
          listenSeconds: batch.listen,
          speakSeconds: batch.speak,
          requestId: batch.requestId,
        }),
        keepalive: true,
      }).then(function (res) {
        if (!res.ok) throw new Error('usage');
        return res.json();
      });
    }

    function flush() {
      if (flushing) return flushing;
      if (!machine) return Promise.resolve();
      if (!inflight) {
        var drained = machine.drainSeconds();
        if (!drained.listen && !drained.speak) return Promise.resolve();
        inflight = { listen: drained.listen, speak: drained.speak, requestId: newRequestId() };
      }
      var batch = inflight;
      flushing = postUsage(batch).catch(function () {
        return postUsage(batch);
      }).then(function (body) {
        inflight = null;
        if (body) {
          lastStatus = body;
          noteApproach(body);
        }
        if (root.ForgeTalk.talkTimeBlocked(body)) showCap();
        return body;
      });
      var done = flushing;
      flushing = done.then(function (body) { flushing = null; return body; }, function (err) { flushing = null; throw err; });
      return flushing;
    }

    function flushSafe() {
      if (ending) return;
      flush().catch(function () { logState('usage'); });
    }

    function playHereCue() {
      cueUntil = now() + 2500;
      render();
      requestVoice(COPY.here, '', '').then(function (bytes) {
        if (!bytes || !machine || machine.phase !== 'listening') return null;
        return decodeVoice(bytes);
      }).then(function (buffer) {
        if (!buffer || !machine || machine.phase !== 'listening') return;
        scheduleBuffer(buffer, playToken, { follow: false, onended: function () {} });
      }).catch(function () {});
    }

    function recoverToListening(reason) {
      logState('recover-' + reason);
      turn += 1;
      abortFlag = true;
      autoSpeak = true;
      showWarning = false;
      bargeHold = false;
      utteranceLive = false;
      priming = false;
      transcribeSince = 0;
      bargeLeadText = '';
      haltPlayback();
      discardRecording();
      vad.reset();
      if (bargeWatch.release) bargeWatch.release();
      audioContext();
      if (machine && machine.phase !== 'listening' && machine.phase !== 'off' && machine.phase !== 'paused' && machine.phase !== 'capped' && machine.phase !== 'ready') {
        returnToMember();
      }
      lastProgress = now();
      silentSince = now();
      render();
      playHereCue();
    }

    function micAlive() {
      if (!stream || !stream.getAudioTracks) return false;
      return stream.getAudioTracks().some(function (track) { return track.readyState === 'live'; });
    }

    function ensureMic() {
      if (micOpening || !machine) return;
      var phase = machine.phase;
      if (phase !== 'listening' && phase !== 'thinking' && phase !== 'speaking') return;
      if (micAlive()) {
        micReviveAt = 0;
        return;
      }
      if (micReviveAt && now() - micReviveAt < 20000) return;
      micReviveAt = now();
      micOpening = true;
      openMic().then(function (opened) {
        micOpening = false;
        if (!opened || !opened.stream || !machine) return;
        if (stream) {
          stream.getTracks().forEach(function (track) {
            try { track.stop(); } catch (err) {}
          });
        }
        stream = opened.stream;
        analyser = opened.analyser;
        timeBuf = analyser ? new Uint8Array(analyser.fftSize) : timeBuf;
        logState('mic-restart');
      }).catch(function () {
        micOpening = false;
        logState('mic-dead');
      });
    }

    function watchdogTick() {
      if (!machine || ending) return;
      var decision = watchdog.tick(now(), {
        lastProgress: lastProgress,
        silentSince: machine.phase === 'listening' ? silentSince : null,
        transcribeSince: transcribeSince || null,
      });
      if (!decision.recover) return;
      if (decision.from === 'listening') {
        logState('listening-idle');
        pauseSession();
        return;
      }
      recoverToListening(decision.from);
    }

    function fail(note) {
      if (ending) return;
      ending = true;
      turn += 1;
      abortFlag = false;
      autoSpeak = false;
      showWarning = false;
      haltPlayback();
      releaseMic();
      if (machine && machine.phase !== 'off' && machine.phase !== 'capped') machine.fail(now());
      var pending = flush().catch(function () {});
      ending = false;
      if (note && page.appendNote) page.appendNote(note);
      render();
      return pending;
    }

    function noteApproach(status) {
      if (!status || !status.warnLevel || status.warnLevel <= notedWarn) return;
      notedWarn = status.warnLevel;
      if (status.warnMessage && page.appendNote) page.appendNote(status.warnMessage);
    }

    function showCap() {
      turn += 1;
      autoSpeak = false;
      showWarning = false;
      haltPlayback();
      releaseMic();
      if (!machine) {
        machine = root.ForgeTalk.createTalkSession({
          idleMs: lastStatus && lastStatus.idleMs,
          style: lastStatus && lastStatus.style,
        });
      }
      if (machine.phase !== 'capped') machine.cap(now());
      if (!capNoted && page.appendNote) {
        capNoted = true;
        page.appendNote(COPY.cap);
      }
      render();
    }

    function pauseSession() {
      turn += 1;
      autoSpeak = false;
      abortFlag = false;
      showWarning = false;
      haltPlayback();
      releaseMic();
      if (machine && machine.phase !== 'paused' && machine.phase !== 'off' && machine.phase !== 'capped') {
        machine.pause(now());
      }
      flushSafe();
      render();
    }

    function endSession() {
      turn += 1;
      autoSpeak = false;
      abortFlag = false;
      showWarning = false;
      haltPlayback();
      releaseMic();
      if (machine && machine.phase !== 'off') machine.stop(now());
      flushSafe();
      render();
    }

    function interruptForSpeaker() {
      if (!machine) return;
      var phase = machine.phase;
      if (phase === 'listening' || phase === 'thinking' || phase === 'speaking') pauseSession();
      else haltPlayback();
    }

    function getStatus() {
      return fetch('/api/aris-talk', { headers: tokenHeader() }).then(function (res) {
        if (!res.ok) throw new Error('status');
        return res.json();
      });
    }

    function ensureMachine(status) {
      var idle = status && status.idleMs;
      var style = status && status.style === 'turn' ? 'turn' : 'natural';
      var staleStyle = machine && machine.style && machine.style !== style;
      var idlePhase = machine && (machine.phase === 'off' || machine.phase === 'ready');
      if (!machine || staleStyle || (machine.phase === 'capped' && status && !status.capped) || (idle && machine.idleMs !== idle && idlePhase)) {
        machine = root.ForgeTalk.createTalkSession({ idleMs: idle || undefined, style: style });
      }
    }

    function beginOrResume(resuming, micPromise) {
      return getStatus().then(function (status) {
        lastStatus = status;
        if (!status || !status.enabled) {
          enabled = false;
          return micPromise.then(releaseOpened, releaseOpened).then(function () {
            render();
          });
        }
        enabled = true;
        if (root.ForgeTalk.talkTimeBlocked(status)) {
          ensureMachine(status);
          return micPromise.then(releaseOpened, releaseOpened).then(function () {
            showCap();
          });
        }
        return micPromise.then(function (opened) {
          ensureMachine(status);
          var ev = resuming ? machine.resume(now()) : machine.start(now());
          if (!ev.ok) {
            releaseOpened(opened);
            if (ev.reason === 'capped') showCap();
            return;
          }
          if (page.cancelPushToTalk) page.cancelPushToTalk();
          capNoted = false;
          showWarning = false;
          headsUpPlayed = false;
          adoptMic(opened);
          render();
        });
      }).catch(function (err) {
        micPromise.then(releaseOpened, function () {});
        fail(err && err.message === 'mic' ? COPY.mic : COPY.unavailable);
      });
    }

    function releaseOpened(opened) {
      if (opened && opened.stream) opened.stream.getTracks().forEach(function (track) { track.stop(); });
    }

    function onTalkPointer() {
      unlockAudio();
      var phase = machine ? machine.phase : 'off';
      if (phase === 'listening' || phase === 'thinking' || phase === 'speaking') {
        endSession();
        return;
      }
      beginOrResume(phase === 'paused', openMic());
    }

    page.armHooks({
      onDelta: function (text) {
        lastProgress = now();
        if (!autoSpeak || !machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        queueNewSentences(text, false);
      },
      onFinal: function (text) {
        if (!autoSpeak || !machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        queueNewSentences(text, true);
      },
      onDiscard: function () {
        if (!machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        haltPlayback();
        spokenCount = 0;
        if (machine.phase === 'speaking') machine.markThinking(now());
        render();
      },
      onConfirm: function () {
        if (!machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        pauseSession();
      },
      onResearch: function (text) {
        lastProgress = now();
        if (!autoSpeak || !machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        if (researchSpoken) return;
        researchSpoken = true;
        var line = String(text || 'Let me research that').replace(/\s+/g, ' ').trim();
        if (!/[.!?]$/.test(line)) line += '.';
        clips.push({
          text: line,
          prev: clips.length ? clips[clips.length - 1].text : '',
          next: '',
          state: 'queued',
          controller: null,
          buffer: null,
        });
        drivePlayback();
      },
      onTypedSend: function () {
        if (!machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        haltPlayback();
        discardRecording();
        autoSpeak = true;
        spokenCount = 0;
        researchSpoken = false;
        machine.markThinking(now());
        render();
      },
      onStreamError: function () {
        if (!machine || machine.phase === 'off' || machine.phase === 'paused') return;
        recoverToListening('stream');
      },
      shouldAbort: function () { return abortFlag; },
    });

    function buyPack() {
      if (!packBtn || packBuying) return;
      if (!lastStatus || !lastStatus.packOffer) return;
      packBuying = true;
      packBtn.disabled = true;
      fetch('/api/aris-talk-pack', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tokenHeader()),
        body: JSON.stringify({ action: 'checkout' }),
      }).then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      }).then(function (result) {
        if (result.ok && result.data && result.data.url) {
          root.location.href = result.data.url;
          return;
        }
        packBuying = false;
        packBtn.disabled = false;
        if (page.appendNote) page.appendNote((result.data && result.data.error) || COPY.packFailed);
      }).catch(function () {
        packBuying = false;
        packBtn.disabled = false;
        if (page.appendNote) page.appendNote(COPY.packFailed);
      });
    }

    function notePackReturn(status) {
      var search = '';
      try { search = (root.location && root.location.search) || ''; } catch (err) { search = ''; }
      if (!search || search.indexOf('talkpack=') === -1 || !page.appendNote) return;
      if (search.indexOf('talkpack=success') === -1) return;
      page.appendNote(status && !root.ForgeTalk.talkTimeBlocked(status) ? COPY.packReady : COPY.packPending);
    }

    btn.addEventListener('click', onTalkPointer);
    resumeEl.addEventListener('click', onTalkPointer);
    if (interruptEl) interruptEl.addEventListener('click', function (event) {
      if (event) event.preventDefault();
      manualBarge();
    });
    if (packBtn) packBtn.addEventListener('click', buyPack);
    document.addEventListener('keydown', function (event) {
      if (!root.ForgeTalk.isManualBargeKey(event, machine && machine.phase)) return;
      event.preventDefault();
      manualBarge();
    });
    document.addEventListener('visibilitychange', function () {
      if (!machine || machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
      if (document.visibilityState === 'hidden') hidePause.hidden(now());
      else hidePause.visible();
    });
    root.addEventListener('pagehide', function () {
      if (!machine || machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
      hidePause.hidden(now());
    });
    root.addEventListener('pageshow', function () {
      hidePause.visible();
    });
    flushTimer = root.setInterval(function () {
      if (!machine) return;
      if (machine.phase === 'listening' || machine.phase === 'speaking') flushSafe();
    }, 15000);
    watchTimer = root.setInterval(function () {
      if (!machine) return;
      ensureMic();
      watchdogTick();
    }, 2000);

    getStatus().then(function (status) {
      lastStatus = status;
      if (!status || !status.enabled) return;
      enabled = true;
      ensureMachine(status);
      noteApproach(status);
      if (status.capped) {
        machine.cap(now());
      }
      render();
      notePackReturn(status);
    }).catch(function () {
      enabled = false;
      btn.hidden = true;
    });

    live = {
      haltPlayback: haltPlayback,
      interruptForSpeaker: interruptForSpeaker,
    };
    render();
  }

  return {
    attach: attach,
    haltPlayback: function () { if (live) live.haltPlayback(); },
    interruptForSpeaker: function () { if (live) live.interruptForSpeaker(); },
  };
});
