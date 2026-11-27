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
    var vad = root.ForgeTalk.createVad();
    var recorder = null;
    var chunks = [];
    var clipToken = 0;
    var loopOn = false;
    var raf = 0;
    var lastFrame = 0;
    var playToken = 0;
    var queue = [];
    var pumping = false;
    var currentAudio = null;
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

    function haltPlayback() {
      playToken += 1;
      queue = [];
      pumping = false;
      spokenCount = 0;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
        currentAudio = null;
      }
      if (headsAudio) {
        headsAudio.pause();
        headsAudio.src = '';
        headsAudio = null;
      }
    }

    function adoptMic(opened) {
      stream = opened.stream;
      analyser = opened.analyser;
      timeBuf = analyser ? new Uint8Array(analyser.fftSize) : null;
      vad.reset();
      loopOn = true;
      lastFrame = 0;
      var frame = function () {
        if (!loopOn || !machine) return;
        var t = now();
        var ev = machine.tick(t);
        if (ev.paused) {
          showWarning = false;
          pauseSession();
          return;
        }
        if (ev.warning) {
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
      if (heard === 'speech_start') {
        showWarning = false;
        headsUpPlayed = false;
        stopHeadsAudio();
        if (machine.phase === 'speaking' || machine.phase === 'thinking') {
          turn += 1;
          abortFlag = true;
          haltPlayback();
          machine.memberSpeechStart(now());
          autoSpeak = true;
          startRecorder();
          render();
          return;
        }
        if (machine.phase === 'listening') {
          machine.noteMemberSpeech(now());
          startRecorder();
          render();
        }
        return;
      }
      if (heard === 'speech' && machine.phase === 'listening') {
        machine.noteMemberSpeech(now());
        return;
      }
      if (heard === 'speech_reject') {
        discardRecording();
        return;
      }
      if (heard === 'speech_end' && machine.phase === 'listening') {
        finishRecorder();
      }
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

    function finishReplyIfIdle(mine) {
      if (mine !== turn || !machine) return;
      if (pumping || queue.length) return;
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
      for (i = 0; i < diff.next.length; i += 1) queue.push(diff.next[i]);
      spokenCount = flush ? 0 : diff.sentences.length;
      pump();
    }

    function pump() {
      if (pumping) return;
      pumping = true;
      var token = playToken;
      var step = function () {
        if (token !== playToken || !queue.length) return Promise.resolve();
        var sentence = queue.shift();
        if (machine && machine.phase === 'speaking') machine.markThinking(now());
        return fetchAudio(sentence).then(function (url) {
          if (token !== playToken) {
            URL.revokeObjectURL(url);
            return null;
          }
          if (machine) machine.markSpeaking(now());
          render();
          return playUrl(url, token);
        }).then(step);
      };
      step().catch(function () {
        if (token === playToken) fail(COPY.failed);
      }).then(function () {
        if (token !== playToken) return;
        pumping = false;
        if (queue.length) pump();
        else finishReplyIfIdle(turn);
      });
    }

    function fetchAudio(text) {
      if (page.stopClickToPlay) page.stopClickToPlay();
      return fetch('/api/aris-voice', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, tokenHeader()),
        body: JSON.stringify({ text: text }),
      }).then(function (res) {
        if (!res.ok) throw new Error('voice');
        return res.blob();
      }).then(function (blob) {
        return URL.createObjectURL(blob);
      });
    }

    function playUrl(url, token) {
      return new Promise(function (resolve, reject) {
        if (token !== playToken) {
          URL.revokeObjectURL(url);
          resolve();
          return;
        }
        var audio = new Audio(url);
        currentAudio = audio;
        var settled = false;
        var finish = function (err) {
          if (settled) return;
          settled = true;
          if (currentAudio === audio) currentAudio = null;
          URL.revokeObjectURL(url);
          if (err) reject(err);
          else resolve();
        };
        audio.addEventListener('ended', function () { finish(null); });
        audio.addEventListener('error', function () { finish(new Error('playback')); });
        var played = audio.play();
        if (played && played.catch) {
          played.catch(function (err) {
            if (token !== playToken) finish(null);
            else finish(err);
          });
        }
        var watch = setInterval(function () {
          if (token !== playToken) {
            clearInterval(watch);
            audio.pause();
            finish(null);
          } else if (settled) clearInterval(watch);
        }, 40);
      });
    }

    function stopHeadsAudio() {
      if (!headsAudio) return;
      headsAudio.pause();
      headsAudio.src = '';
      headsAudio = null;
    }

    function playHeadsUp() {
      if (headsUpPlayed || !machine || machine.phase !== 'listening') return;
      headsUpPlayed = true;
      var started = 0;
      fetchAudio(COPY.headsUp).then(function (url) {
        if (!machine || machine.phase !== 'listening') {
          URL.revokeObjectURL(url);
          return;
        }
        started = now();
        return new Promise(function (resolve) {
          var audio = new Audio(url);
          headsAudio = audio;
          var done = function () {
            if (headsAudio === audio) headsAudio = null;
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.addEventListener('ended', done);
          audio.addEventListener('error', done);
          var played = audio.play();
          if (played && played.catch) played.catch(done);
        });
      }).then(function () {
        var elapsed = started ? now() - started : 0;
        if (machine) machine.addSpeakMs(elapsed);
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
        if (body && body.capped) showCap();
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
        if (status.capped || status.remainingSeconds <= 0) {
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
      onTypedSend: function () {
        if (!machine) return;
        if (machine.phase === 'off' || machine.phase === 'paused' || machine.phase === 'capped') return;
        haltPlayback();
        discardRecording();
        autoSpeak = true;
        spokenCount = 0;
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
      if (document.visibilityState === 'hidden') {
        if (machine && machine.phase !== 'off' && machine.phase !== 'paused' && machine.phase !== 'capped') pauseSession();
      }
    });
    root.addEventListener('pagehide', function () {
      if (machine && machine.phase !== 'off' && machine.phase !== 'paused' && machine.phase !== 'capped') pauseSession();
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
