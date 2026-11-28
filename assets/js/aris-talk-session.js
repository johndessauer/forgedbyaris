/* ARIS Talk Mode browser loop. Coach page only.
 *
 * One tap unlocks playback, opens the microphone, then:
 * listen -> silence -> the existing transcribe path -> the existing
 * chat send -> speak each finished sentence with the existing voice
 * path -> listen again. Member speech during playback stops the audio
 * and starts a new turn. Two minutes without member speech pauses the
 * mic so no further minutes are counted. The control stays hidden
 * until /api/aris-talk says this member is allowed.
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
    var flushTimer = 0;
    var unlockCtx = null;
    var enabled = false;

    function now() { return Date.now(); }

    function tokenHeader() {
      var token = page.getToken ? page.getToken() : '';
      return token ? { Authorization: 'Bearer ' + token } : {};
    }

    function render() {
      var phase = machine ? machine.phase : 'off';
      btn.hidden = !enabled;
      btn.textContent = root.ForgeTalk.buttonLabel(phase);
      btn.classList.toggle('active', phase === 'listening' || phase === 'thinking' || phase === 'speaking');
      btn.setAttribute('aria-pressed', (phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'paused') ? 'true' : 'false');
      var showStatus = phase === 'listening' || phase === 'thinking' || phase === 'speaking';
      statusEl.hidden = !showStatus;
      if (showStatus) statusEl.textContent = root.ForgeTalk.statusLabel(phase, showWarning);
      resumeEl.hidden = phase !== 'paused';
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
          var mode = (machine.phase === 'speaking' || headsAudio) ? 'speaking' : 'listening';
          handleVad(vad.push(root.ForgeTalk.rmsFromTimeDomain(timeBuf), dt, mode));
        }
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
      if (plan.note && machine.phase === 'listening') machine.noteMemberSpeech(now());
      if (plan.ensureRecorder) startRecorder();
      if (plan.finish) finishRecorder();
    }

    function startRecorder() {
      if (!stream || typeof MediaRecorder === 'undefined') return;
      if (recorder && recorder.state === 'recording') return;
      clipToken += 1;
      var mine = clipToken;
      chunks = [];
      try {
        recorder = new MediaRecorder(stream);
      } catch (err) {
        fail(COPY.failed);
        return;
      }
      recorder.ondataavailable = function (event) {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = function () {
        var mime = (recorder && recorder.mimeType) || 'audio/webm';
        var blob = new Blob(chunks, { type: mime });
        chunks = [];
        if (mine !== clipToken) return;
        sendClip(blob, mime);
      };
      recorder.start();
    }

    function finishRecorder() {
      clipToken += 0;
      if (recorder && recorder.state === 'recording') {
        try { recorder.stop(); } catch (err) {}
      }
    }

    function discardRecording() {
      clipToken += 1;
      if (recorder && recorder.state === 'recording') {
        try { recorder.stop(); } catch (err) {}
      }
      chunks = [];
    }

    function sendClip(blob, mime) {
      if (!machine || machine.phase === 'paused' || machine.phase === 'off' || machine.phase === 'capped') return;
      if (!blob || blob.size < 1000) {
        if (machine.phase === 'listening') render();
        return;
      }
      machine.memberSpeechEnd(now());
      render();
      transcribe(blob, mime).then(function (text) {
        if (!machine || machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        if (!text) {
          machine.markListening(now());
          statusEl.textContent = COPY.missed;
          render();
          return;
        }
        if (root.ForgeTalk.isEchoOf(text, COPY.headsUp)) {
          machine.markListening(now());
          render();
          return;
        }
        autoSpeak = true;
        spokenCount = 0;
        researchSpoken = false;
        enqueueReply(text);
      }).catch(function () {
        fail(COPY.hearing);
      });
    }

    function enqueueReply(text) {
      var mine = turn;
      replyChain = replyChain.catch(function () {}).then(function () {
        if (mine !== turn || !machine) return;
        abortFlag = false;
        machine.markThinking(now());
        render();
        return page.sendText(text).then(function () {
          if (mine !== turn) return;
          finishReplyIfIdle(mine);
        });
      }).catch(function () {
        if (mine !== turn) return;
        fail(COPY.failed);
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
        machine.markListening(now());
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
      gain.gain.setValueAtTime(0, plan.startAt);
      gain.gain.linearRampToValueAtTime(1, plan.startAt + fade);
      gain.gain.setValueAtTime(1, Math.max(plan.startAt + fade, endAt - fade));
      gain.gain.linearRampToValueAtTime(0, endAt);
      source.connect(gain);
      gain.connect(ctx.destination);
      try {
        source.start(plan.startAt, offset, plan.playFor);
      } catch (err) {
        return null;
      }
      if (follow) nextStart = plan.nextStart;
      activeSources.push({ source: source, gain: gain });
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
      requestVoice(clip.text, clip.prev, clip.next, controller).then(function (bytes) {
        if (!bytes || token !== playToken || clip.state === 'cancelled') return null;
        return decodeVoice(bytes);
      }).then(function (buffer) {
        if (token !== playToken || clip.state === 'cancelled') return;
        if (!buffer) {
          clip.state = 'done';
          drivePlayback();
          return;
        }
        clip.buffer = buffer;
        clip.state = 'ready';
        drivePlayback();
      }).catch(function (err) {
        if (token !== playToken || clip.state === 'cancelled') return;
        if (err && err.name === 'AbortError') return;
        fail(COPY.failed);
      });
    }

    function scheduleReady(token) {
      if (token !== playToken) return;
      while (clipCursor < clips.length && clips[clipCursor].state === 'ready') {
        var clip = clips[clipCursor];
        var source = scheduleBuffer(clip.buffer, token, {
          follow: true,
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
        if (root.ForgeTalk.talkTimeBlocked(body)) showCap();
        return body;
      });
      var done = flushing;
      flushing = done.then(function (body) { flushing = null; return body; }, function (err) { flushing = null; throw err; });
      return flushing;
    }

    function flushSafe() {
      if (ending) return;
      flush().catch(function () { fail(COPY.unavailable); });
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

    function showCap() {
      turn += 1;
      autoSpeak = false;
      showWarning = false;
      haltPlayback();
      releaseMic();
      if (!machine) machine = root.ForgeTalk.createTalkSession({ idleMs: lastStatus && lastStatus.idleMs });
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
      if (!machine || (machine.phase === 'capped' && status && !status.capped) || (idle && machine.idleMs !== idle && machine.phase === 'off')) {
        machine = root.ForgeTalk.createTalkSession({ idleMs: idle || undefined });
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
        fail(null);
      },
      shouldAbort: function () { return abortFlag; },
    });

    btn.addEventListener('click', onTalkPointer);
    resumeEl.addEventListener('click', onTalkPointer);
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

    getStatus().then(function (status) {
      lastStatus = status;
      if (!status || !status.enabled) return;
      enabled = true;
      ensureMachine(status);
      if (status.capped) {
        machine.cap(now());
      }
      render();
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
