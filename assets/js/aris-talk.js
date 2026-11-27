/* ARIS Talk Mode — pure logic.
 *
 * No microphone, no network, no vendor names. The coach page and the
 * aris-talk Netlify function both use this file. Member-facing strings
 * live in COPY and must stay free of vendor names.
 *
 * Idle: 2 minutes of no member speech by default, clamped to 2–3 minutes.
 * Hitting the idle deadline pauses the session. It does not end it.
 * Listening and speaking time count toward the monthly cap. Paused,
 * off, capped, and thinking time do not.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeTalk = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var DEFAULT_IDLE_MS = 120000;
  var MIN_IDLE_MS = 120000;
  var MAX_IDLE_MS = 180000;
  var WARN_LEAD_MS = 15000;
  var DEFAULT_CAP_MINUTES = 30;
  var DEFAULT_ALERT_MINUTES = 300;
  var MAX_CHUNK_SECONDS = 180;

  var COPY = {
    buttonTalk: 'Talk',
    buttonEnd: 'End',
    buttonResume: 'Resume',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    warning: 'Still there? Talk Mode will pause in a moment.',
    headsUp: "I'm still here. I'll pause in a moment if you're done.",
    paused: 'Talk Mode paused — tap to resume',
    cap: "You've used your Talk Mode time for this month. You can keep typing, and you can play any reply with the speaker button.",
    mic: "I couldn't access your microphone. Check your browser's permission settings and try again. You can keep typing.",
    failed: 'Talk Mode stopped. You can keep typing, and you can play a reply with the speaker button.',
    missed: "I didn't catch that. I'm listening again.",
    hearing: 'I had trouble hearing that. Talk Mode stopped. You can keep typing, and you can play a reply with the speaker button.',
    unavailable: 'Talk Mode is unavailable right now. You can keep typing.',
    confirmPause: 'Talk Mode paused — tap to resume',
  };

  function clampIdleMs(value) {
    if (value == null || String(value).trim() === '') return DEFAULT_IDLE_MS;
    var n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_IDLE_MS;
    var ms = n > 0 && n < 1000 ? Math.round(n * 1000) : Math.round(n);
    if (ms < MIN_IDLE_MS) return MIN_IDLE_MS;
    if (ms > MAX_IDLE_MS) return MAX_IDLE_MS;
    return ms;
  }

  function clampIdleSeconds(value) {
    return Math.round(clampIdleMs(value == null || String(value).trim() === '' ? 120 : value) / 1000);
  }

  function capMinutesFromEnv(env) {
    var source = env || {};
    var raw = source.ARIS_TALK_CAP_MINUTES;
    if (raw == null || String(raw).trim() === '') return DEFAULT_CAP_MINUTES;
    var n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_CAP_MINUTES;
    return Math.round(n);
  }

  function alertMinutesFromEnv(env) {
    var source = env || {};
    var raw = source.ARIS_TALK_ALERT_MINUTES;
    if (raw == null || String(raw).trim() === '') return DEFAULT_ALERT_MINUTES;
    var n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_ALERT_MINUTES;
    return Math.round(n);
  }

  function idleMsFromEnv(env) {
    var source = env || {};
    var raw = source.ARIS_TALK_IDLE_SECONDS;
    if (raw == null || String(raw).trim() === '') return DEFAULT_IDLE_MS;
    return clampIdleMs(raw);
  }

  function envFlagOn(value) {
    var v = String(value == null ? '' : value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
  }

  function parseAllowlist(value) {
    return String(value == null ? '' : value)
      .split(',')
      .map(function (part) { return part.trim().toLowerCase(); })
      .filter(Boolean);
  }

  function talkModeAccess(input) {
    var opts = input || {};
    var env = opts.env || {};
    if (envFlagOn(env.TALK_MODE_ENABLED)) return { enabled: true, reason: 'global' };
    var list = parseAllowlist(env.TALK_MODE_ALLOWLIST);
    var id = String(opts.memberId || '').trim().toLowerCase();
    var email = String(opts.email || '').trim().toLowerCase();
    if (id && list.indexOf(id) !== -1) return { enabled: true, reason: 'allowlist' };
    if (email && list.indexOf(email) !== -1) return { enabled: true, reason: 'allowlist' };
    return { enabled: false, reason: 'off' };
  }

  function monthKeyFromDate(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) throw new Error('bad date');
    var month = String(d.getUTCMonth() + 1);
    if (month.length < 2) month = '0' + month;
    return d.getUTCFullYear() + '-' + month;
  }

  function cleanSeconds(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function applyUsage(state, input) {
    var current = state || {};
    var used = Math.max(0, Math.floor(Number(current.usedSeconds) || 0));
    var seen = current.seen || {};
    var requestId = String((input && input.requestId) || '').trim();
    var capSeconds = Math.max(0, Math.floor(Number(input && input.capSeconds) || 0));
    var maxChunk = Math.max(0, Math.floor(Number(input && input.maxChunkSeconds) || MAX_CHUNK_SECONDS));
    if (!requestId) return { error: 'request' };
    var listen = cleanSeconds(input.listenSeconds);
    var speak = cleanSeconds(input.speakSeconds);
    if (listen == null || speak == null) return { error: 'seconds' };

    if (seen[requestId]) {
      return {
        usedSeconds: used,
        acceptedListen: 0,
        acceptedSpeak: 0,
        capped: used >= capSeconds,
        replayed: true,
        seen: seen,
      };
    }

    var room = Math.max(0, capSeconds - used);
    var chunkListen = Math.min(listen, maxChunk);
    var chunkSpeak = Math.min(speak, Math.max(0, maxChunk - chunkListen));
    var acceptedListen = Math.min(chunkListen, room);
    var acceptedSpeak = Math.min(chunkSpeak, Math.max(0, room - acceptedListen));
    var nextUsed = used + acceptedListen + acceptedSpeak;
    var nextSeen = {};
    var key;
    for (key in seen) {
      if (Object.prototype.hasOwnProperty.call(seen, key)) nextSeen[key] = true;
    }
    nextSeen[requestId] = true;
    return {
      usedSeconds: nextUsed,
      acceptedListen: acceptedListen,
      acceptedSpeak: acceptedSpeak,
      capped: nextUsed >= capSeconds,
      replayed: false,
      seen: nextSeen,
    };
  }

  function evaluateMonthAlert(input) {
    var opts = input || {};
    var threshold = Math.max(0, Math.floor(Number(opts.thresholdMinutes) || 0));
    var total = Math.max(0, Math.floor(Number(opts.totalSeconds) || 0));
    if (!threshold) return { flag: false, reason: 'disabled', totalSeconds: total, thresholdMinutes: 0 };
    if (total < threshold * 60) return { flag: false, reason: 'under', totalSeconds: total, thresholdMinutes: threshold };
    if (opts.alreadyFlagged) return { flag: false, reason: 'already', totalSeconds: total, thresholdMinutes: threshold };
    return { flag: true, reason: 'cross', totalSeconds: total, thresholdMinutes: threshold };
  }

  function createMemoryStore() {
    var rows = {};
    var alerts = {};

    function key(memberId, monthKey) {
      return memberId + '|' + monthKey;
    }

    return {
      async add(input) {
        var id = key(input.memberId, input.monthKey);
        var row = rows[id] || { usedSeconds: 0, listenSeconds: 0, speakSeconds: 0, seen: {} };
        var applied = applyUsage({
          usedSeconds: row.listenSeconds + row.speakSeconds,
          seen: row.seen,
        }, input);
        if (applied.error) {
          var err = new Error(applied.error);
          err.code = applied.error;
          throw err;
        }
        rows[id] = {
          listenSeconds: row.listenSeconds + applied.acceptedListen,
          speakSeconds: row.speakSeconds + applied.acceptedSpeak,
          seen: applied.seen,
        };
        return {
          usedSeconds: rows[id].listenSeconds + rows[id].speakSeconds,
          listenSeconds: rows[id].listenSeconds,
          speakSeconds: rows[id].speakSeconds,
          acceptedListen: applied.acceptedListen,
          acceptedSpeak: applied.acceptedSpeak,
          capped: applied.capped,
          replayed: applied.replayed,
        };
      },
      async read(memberId, monthKey) {
        var row = rows[key(memberId, monthKey)];
        if (!row) return { listenSeconds: 0, speakSeconds: 0, usedSeconds: 0 };
        return {
          listenSeconds: row.listenSeconds,
          speakSeconds: row.speakSeconds,
          usedSeconds: row.listenSeconds + row.speakSeconds,
        };
      },
      async monthTotal(monthKey) {
        var total = 0;
        var id;
        for (id in rows) {
          if (!Object.prototype.hasOwnProperty.call(rows, id)) continue;
          if (id.slice(id.indexOf('|') + 1) !== monthKey) continue;
          total += rows[id].listenSeconds + rows[id].speakSeconds;
        }
        return total;
      },
      async hasAlert(monthKey, thresholdMinutes) {
        return !!alerts[monthKey + '|' + thresholdMinutes];
      },
      async insertAlert(row) {
        var id = row.monthKey + '|' + row.thresholdMinutes;
        if (alerts[id]) return false;
        alerts[id] = {
          monthKey: row.monthKey,
          thresholdMinutes: row.thresholdMinutes,
          totalSeconds: row.totalSeconds,
        };
        return true;
      },
    };
  }

  var ABBREV = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|Ave|Blvd|Rd|No|Fig|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|e\.g|i\.e)\.$/i;

  function stripUnspeakable(text) {
    return String(text || '')
      .replace(/<<<DEAL_DATA[\s\S]*?DEAL_DATA>>>/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ');
  }

  function segmentSpeech(text, flush) {
    var clean = stripUnspeakable(text).replace(/[ \t\f\v]+/g, ' ');
    var sentences = [];
    var start = 0;
    var i;
    function push(end) {
      var sentence = clean.slice(start, end).replace(/\s+/g, ' ').trim();
      if (sentence) sentences.push(sentence);
      start = end;
      while (start < clean.length && /\s/.test(clean.charAt(start))) start += 1;
    }
    for (i = 0; i < clean.length; i += 1) {
      var ch = clean.charAt(i);
      if (ch === '\n') {
        var pending = clean.slice(start, i).trim();
        if (pending.length >= 40 || (i + 1 < clean.length && clean.charAt(i + 1) === '\n' && pending)) {
          push(i);
          i = start - 1;
        }
        continue;
      }
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      if (ch === '.' && i > 0 && i + 1 < clean.length && /\d/.test(clean.charAt(i - 1)) && /\d/.test(clean.charAt(i + 1))) continue;
      if (ch === '.' && clean.charAt(i + 1) === '.') continue;
      var slice = clean.slice(start, i + 1);
      if (ch === '.' && ABBREV.test(slice.trim())) continue;
      var next = i + 1 < clean.length ? clean.charAt(i + 1) : '';
      if (next && !/\s/.test(next)) continue;
      push(i + 1);
      i = start - 1;
    }
    var rest = clean.slice(start).replace(/\s+/g, ' ').trim();
    if (flush && rest) {
      sentences.push(rest);
      rest = '';
    }
    return { sentences: sentences, rest: rest };
  }

  function nextSentences(alreadyCount, fullText, flush) {
    var segmented = segmentSpeech(fullText, !!flush);
    var count = Math.max(0, alreadyCount || 0);
    return {
      sentences: segmented.sentences,
      next: segmented.sentences.slice(count),
      rest: segmented.rest,
    };
  }

  function normalizeEcho(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function isEchoOf(heard, spoken) {
    var a = normalizeEcho(heard);
    var b = normalizeEcho(spoken);
    if (!a || !b) return false;
    return a === b;
  }

  function rmsFromTimeDomain(samples) {
    if (!samples || !samples.length) return 0;
    var sum = 0;
    var i;
    for (i = 0; i < samples.length; i += 1) {
      var v = (Number(samples[i]) - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / samples.length);
  }

  function createVad(options) {
    var opts = options || {};
    var speechRms = opts.speechRms == null ? 0.045 : opts.speechRms;
    var bargeRms = opts.bargeRms == null ? 0.09 : opts.bargeRms;
    var speechFrames = opts.speechFrames == null ? 4 : opts.speechFrames;
    var bargeFrames = opts.bargeFrames == null ? 8 : opts.bargeFrames;
    var silenceLimit = opts.silenceMs == null ? 900 : opts.silenceMs;
    var minUtteranceMs = opts.minUtteranceMs == null ? 280 : opts.minUtteranceMs;
    var run = 0;
    var inSpeech = false;
    var silence = 0;
    var speechMs = 0;

    return {
      push: function (rms, dt, mode) {
        var threshold = mode === 'speaking' ? bargeRms : speechRms;
        var need = mode === 'speaking' ? bargeFrames : speechFrames;
        var dtMs = Math.max(0, Number(dt) || 0);
        if (rms >= threshold) {
          run += 1;
          silence = 0;
          if (!inSpeech && run >= need) {
            inSpeech = true;
            speechMs = dtMs;
            return 'speech_start';
          }
          if (inSpeech) {
            speechMs += dtMs;
            return 'speech';
          }
          return 'noise';
        }
        run = 0;
        if (!inSpeech) return 'silence';
        silence += dtMs;
        speechMs += dtMs;
        if (silence >= silenceLimit) {
          var voiced = speechMs - silence;
          inSpeech = false;
          silence = 0;
          speechMs = 0;
          return voiced >= minUtteranceMs ? 'speech_end' : 'speech_reject';
        }
        return 'speech';
      },
      reset: function () {
        run = 0;
        inSpeech = false;
        silence = 0;
        speechMs = 0;
      },
    };
  }

  function statusLabel(phase, warning) {
    if (phase === 'paused') return COPY.paused;
    if (phase === 'capped') return COPY.cap;
    if (warning && phase === 'listening') return COPY.warning;
    if (phase === 'listening') return COPY.listening;
    if (phase === 'thinking') return COPY.thinking;
    if (phase === 'speaking') return COPY.speaking;
    return '';
  }

  function buttonLabel(phase) {
    if (phase === 'paused') return COPY.buttonResume;
    if (phase === 'listening' || phase === 'thinking' || phase === 'speaking') return COPY.buttonEnd;
    return COPY.buttonTalk;
  }

  function createTalkSession(options) {
    var opts = options || {};
    var idleMs = clampIdleMs(opts.idleMs == null ? DEFAULT_IDLE_MS : opts.idleMs);
    var warnLeadMs = Math.min(WARN_LEAD_MS, Math.floor(idleMs / 2));
    var phase = 'off';
    var listenAnchor = 0;
    var warned = false;
    var lastTick = null;
    var listenMs = 0;
    var speakMs = 0;

    function account(now) {
      if (lastTick == null) return;
      var dt = Math.max(0, now - lastTick);
      if (phase === 'listening') listenMs += dt;
      else if (phase === 'speaking') speakMs += dt;
      lastTick = null;
    }

    function enter(next, now) {
      account(now);
      phase = next;
      lastTick = (next === 'listening' || next === 'speaking') ? now : null;
      if (next === 'listening') {
        listenAnchor = now;
        warned = false;
      }
    }

    function snapshot(extra) {
      var out = extra || {};
      out.phase = phase;
      out.capture = phase === 'listening' || phase === 'thinking' || phase === 'speaking';
      out.playback = phase === 'speaking';
      out.usageStopped = phase !== 'listening' && phase !== 'speaking';
      return out;
    }

    return {
      get phase() { return phase; },
      get capture() { return snapshot().capture; },
      get playback() { return phase === 'speaking'; },
      get idleMs() { return idleMs; },
      get warnLeadMs() { return warnLeadMs; },
      start: function (now) {
        if (phase === 'capped') return snapshot({ ok: false, reason: 'capped' });
        if (phase !== 'off') return snapshot({ ok: false, reason: 'busy' });
        enter('listening', now);
        return snapshot({ ok: true, unlockAudio: true });
      },
      resume: function (now) {
        if (phase !== 'paused') return snapshot({ ok: false, reason: 'not-paused' });
        enter('listening', now);
        return snapshot({ ok: true, unlockAudio: true });
      },
      stop: function (now) {
        if (phase === 'off') return snapshot({ ok: true });
        enter('off', now);
        return snapshot({ ok: true, stopMic: true, stopPlayback: true });
      },
      pause: function (now) {
        if (phase === 'off' || phase === 'paused' || phase === 'capped') {
          return snapshot({ ok: false });
        }
        enter('paused', now);
        return snapshot({ ok: true, paused: true, stopMic: true, stopPlayback: true });
      },
      fail: function (now) {
        enter('off', now);
        return snapshot({ ok: true, ended: true, stopMic: true, stopPlayback: true });
      },
      cap: function (now) {
        enter('capped', now);
        return snapshot({ ok: true, capped: true, stopMic: true, stopPlayback: true });
      },
      noteMemberSpeech: function (now) {
        if (phase !== 'listening') return snapshot({ ok: false });
        listenAnchor = now;
        warned = false;
        return snapshot({ ok: true });
      },
      memberSpeechStart: function (now) {
        if (phase === 'speaking' || phase === 'thinking') {
          var from = phase;
          enter('listening', now);
          return snapshot({ ok: true, bargeIn: true, stopPlayback: true, abortReply: true, from: from });
        }
        if (phase === 'listening') {
          listenAnchor = now;
          warned = false;
          return snapshot({ ok: true });
        }
        return snapshot({ ok: false });
      },
      memberSpeechEnd: function (now) {
        if (phase !== 'listening') return snapshot({ ok: false });
        enter('thinking', now);
        return snapshot({ ok: true, transcribe: true });
      },
      markThinking: function (now) {
        if (phase !== 'listening' && phase !== 'speaking' && phase !== 'thinking') {
          return snapshot({ ok: false });
        }
        enter('thinking', now);
        return snapshot({ ok: true });
      },
      markSpeaking: function (now) {
        if (phase !== 'thinking' && phase !== 'speaking' && phase !== 'listening') {
          return snapshot({ ok: false });
        }
        enter('speaking', now);
        return snapshot({ ok: true });
      },
      markListening: function (now) {
        if (phase === 'off' || phase === 'paused' || phase === 'capped') return snapshot({ ok: false });
        enter('listening', now);
        return snapshot({ ok: true });
      },
      tick: function (now) {
        if (phase === 'listening' || phase === 'speaking') {
          account(now);
          lastTick = now;
        }
        if (phase !== 'listening') return snapshot();
        var quiet = now - listenAnchor;
        if (quiet >= idleMs) {
          enter('paused', now);
          return snapshot({ paused: true, stopMic: true, stopPlayback: true, warning: false });
        }
        if (!warned && quiet >= idleMs - warnLeadMs) {
          warned = true;
          return snapshot({ warning: true, msUntilPause: idleMs - quiet });
        }
        return snapshot({ warning: false, msUntilPause: idleMs - quiet });
      },
      pageHide: function (now) {
        if (phase === 'off' || phase === 'paused' || phase === 'capped') {
          return snapshot({ ok: true, alreadyStopped: true });
        }
        enter('paused', now);
        return snapshot({ ok: true, paused: true, stopMic: true, stopPlayback: true });
      },
      addSpeakMs: function (ms) {
        if (phase === 'paused' || phase === 'off' || phase === 'capped') return false;
        var n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return false;
        speakMs += n;
        return true;
      },
      drainSeconds: function () {
        var listen = Math.floor(listenMs / 1000);
        var speak = Math.floor(speakMs / 1000);
        listenMs -= listen * 1000;
        speakMs -= speak * 1000;
        return { listen: listen, speak: speak };
      },
      pendingMs: function () {
        return { listenMs: listenMs, speakMs: speakMs };
      },
    };
  }

  return {
    COPY: COPY,
    DEFAULT_IDLE_MS: DEFAULT_IDLE_MS,
    MIN_IDLE_MS: MIN_IDLE_MS,
    MAX_IDLE_MS: MAX_IDLE_MS,
    WARN_LEAD_MS: WARN_LEAD_MS,
    DEFAULT_CAP_MINUTES: DEFAULT_CAP_MINUTES,
    DEFAULT_ALERT_MINUTES: DEFAULT_ALERT_MINUTES,
    MAX_CHUNK_SECONDS: MAX_CHUNK_SECONDS,
    clampIdleMs: clampIdleMs,
    clampIdleSeconds: clampIdleSeconds,
    capMinutesFromEnv: capMinutesFromEnv,
    alertMinutesFromEnv: alertMinutesFromEnv,
    idleMsFromEnv: idleMsFromEnv,
    envFlagOn: envFlagOn,
    parseAllowlist: parseAllowlist,
    talkModeAccess: talkModeAccess,
    monthKeyFromDate: monthKeyFromDate,
    cleanSeconds: cleanSeconds,
    applyUsage: applyUsage,
    evaluateMonthAlert: evaluateMonthAlert,
    createMemoryStore: createMemoryStore,
    segmentSpeech: segmentSpeech,
    nextSentences: nextSentences,
    isEchoOf: isEchoOf,
    rmsFromTimeDomain: rmsFromTimeDomain,
    createVad: createVad,
    statusLabel: statusLabel,
    buttonLabel: buttonLabel,
    createTalkSession: createTalkSession,
  };
});
