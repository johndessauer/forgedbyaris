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

  var ABBREV = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|Ave|Blvd|Rd|No|Fig|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|a\.m|p\.m|e\.g|i\.e|U\.S|U\.K|AM|PM)\.$/i;
  var DOTTED_ABBREV = ['a.m.', 'a.m', 'p.m.', 'p.m', 'e.g.', 'e.g', 'i.e.', 'i.e', 'u.s.', 'u.s', 'u.k.', 'u.k'];

  function collapseSpokenSources(text) {
    return String(text || '').replace(/\n+\s*sources?\s*:?\s*([\s\S]*)$/i, function (_, body) {
      var names = [];
      var lines = String(body || '').split(/\n+/);
      var i;
      for (i = 0; i < lines.length && names.length < 2; i += 1) {
        var cleaned = lines[i].replace(/^[-*•\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
        if (cleaned) names.push(cleaned.slice(0, 80));
      }
      if (!names.length) return '\n';
      return '\nSource: ' + names.join(' and ') + '.';
    });
  }

  function stripMarkdownForSpeech(text) {
    var s = String(text || '');
    s = s.replace(/<<<DEAL_DATA[\s\S]*?DEAL_DATA>>>/g, ' ');
    s = s.replace(/```[\s\S]*?```/g, ' ');
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/!\s*\[([^\]]*)\]\([^)]*\)/g, function (_, alt) {
      var words = String(alt || '').replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{2,}/.test(words) || /\.(?:png|jpe?g|gif|webp|svg|heic|bmp|avif)$/i.test(words)) return ' ';
      return ' ' + words + ' ';
    });
    s = s.replace(/<img\b[^>]*>/gi, ' ');
    s = s.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, ' ');
    s = s.replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|heic|bmp|avif)(?:\?[^\s)]*)?/gi, ' ');
    s = s.replace(/(?:^|\n)[ \t]*(?:(?:[-*_]){3,}|[—–]{2,}|#{3,})[ \t]*(?=\n|$)/g, '\n');
    s = s.replace(/[\u2500-\u257F\u2580-\u259F•●◦▪▫■□◆◇▶►▸]/g, ' ');
    s = s.replace(/\p{Extended_Pictographic}/gu, ' ');
    s = s.replace(/\|/g, ' ');
    s = s.replace(/(?:^|\s)(?:[-*_]){3,}(?=\s|$)/g, ' ');
    s = s.replace(/(?:^|\s)[—–]{2,}(?=\s|$)/g, ' ');
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    s = s.replace(/\bhttps?:\/\/\S+/gi, ' ');
    s = s.replace(/\bwww\.\S+/gi, ' ');
    s = collapseSpokenSources(s);
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/__([^_]+)__/g, '$1');
    s = s.replace(/(^|[\s(])\*([A-Za-z][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1$2');
    s = s.replace(/(^|[\s(])_([A-Za-z][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1$2');
    s = s.replace(/^#{1,6}\s+/gm, '');
    s = s.replace(/^[ \t]*[-*+]\s+/gm, '');
    s = s.replace(/(^|\n)\s*\d{1,2}\.\s+/g, '$1');
    s = s.replace(/\*/g, function (match, offset, src) {
      var prev = src.slice(Math.max(0, offset - 12), offset);
      var next = src.slice(offset + 1, offset + 13);
      if (/\d\s*$/.test(prev) && /^\s*\d/.test(next)) return '*';
      return '';
    });
    return s;
  }

  function polishSpokenChunk(sentence) {
    var s = String(sentence || '').replace(/\s+/g, ' ').trim();
    s = s.replace(/^(?:\d{1,2}\.\s+)+/, '');
    s = s.replace(/^[*_#]+/, '').replace(/[*_#]+$/, '');
    return s.replace(/\s+/g, ' ').trim();
  }

  function dottedAbbrevAt(clean, dotIndex) {
    var start = Math.max(0, dotIndex - 6);
    var end = Math.min(clean.length, dotIndex + 4);
    var slice = clean.slice(start, end).toLowerCase();
    var n;
    var at;
    for (n = 0; n < DOTTED_ABBREV.length; n += 1) {
      var form = DOTTED_ABBREV[n];
      at = slice.indexOf(form);
      while (at !== -1) {
        var abs = start + at;
        var prev = abs > 0 ? clean.charAt(abs - 1) : '';
        if (!prev || /[^A-Za-z0-9]/.test(prev)) {
          if (dotIndex >= abs && dotIndex < abs + form.length) return true;
        }
        at = slice.indexOf(form, at + 1);
      }
    }
    return false;
  }

  function isListMarker(clean, dotIndex) {
    var j = dotIndex - 1;
    var digits = 0;
    if (j < 0 || !/\d/.test(clean.charAt(j))) return false;
    while (j >= 0 && /\d/.test(clean.charAt(j))) {
      digits += 1;
      j -= 1;
    }
    if (digits < 1 || digits > 2) return false;
    var prev = j >= 0 ? clean.charAt(j) : '';
    if (prev && !/\s/.test(prev)) return false;
    var next = dotIndex + 1 < clean.length ? clean.charAt(dotIndex + 1) : '';
    if (next && !/\s/.test(next)) return false;
    return true;
  }

  function segmentSpeech(text, flush) {
    var clean = stripMarkdownForSpeech(text).replace(/[ \t\f\v]+/g, ' ');
    var sentences = [];
    var start = 0;
    var i;
    function push(end) {
      var sentence = polishSpokenChunk(clean.slice(start, end));
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
      if (ch === '.' && dottedAbbrevAt(clean, i)) continue;
      if (ch === '.' && isListMarker(clean, i)) continue;
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

  function planPrefetch(states, ahead) {
    var extra = ahead == null ? 2 : ahead;
    if (extra < 1) extra = 1;
    var origin = -1;
    var found = false;
    var i;
    for (i = 0; i < states.length; i += 1) {
      if (states[i] === 'playing' || states[i] === 'scheduled') {
        origin = i;
        found = true;
        break;
      }
    }
    if (!found) {
      for (i = 0; i < states.length; i += 1) {
        if (states[i] === 'ready') {
          origin = i;
          found = true;
          break;
        }
      }
    }
    var out = [];
    var inflight = 0;
    var limit = found ? extra : extra + 1;
    var begin = found ? origin + 1 : 0;
    for (i = begin; i < states.length; i += 1) {
      if (states[i] === 'fetch' || states[i] === 'ready') inflight += 1;
      else if (states[i] === 'queued') {
        if (inflight >= limit) break;
        out.push(i);
        inflight += 1;
      }
      if (inflight >= limit) break;
    }
    return out;
  }

  function trimPcmEdges(samples, sampleRate, options) {
    var opts = options || {};
    var threshold = opts.threshold == null ? 0.015 : opts.threshold;
    var rate = sampleRate > 0 ? sampleRate : 44100;
    var maxTrim = Math.floor((opts.maxSeconds == null ? 0.04 : opts.maxSeconds) * rate);
    var length = samples && samples.length ? samples.length : 0;
    if (!length) return { start: 0, end: 0 };
    if (maxTrim < 1) return { start: 0, end: length };
    var start = 0;
    var end = length;
    while (start < maxTrim && start < length - 1 && Math.abs(samples[start]) < threshold) start += 1;
    while (end > length - maxTrim && end > start + 1 && Math.abs(samples[end - 1]) < threshold) end -= 1;
    return { start: start, end: end };
  }

  function playbackSchedule(input) {
    var opts = input || {};
    var fade = opts.fade == null ? 0.015 : opts.fade;
    if (fade < 0.01) fade = 0.01;
    if (fade > 0.02) fade = 0.02;
    var cross = opts.crossfade == null ? 0.012 : opts.crossfade;
    var duration = Math.max(0, Number(opts.duration) || 0);
    var playFor = Math.max(duration, fade * 2);
    var now = Number(opts.now) || 0;
    var startAt = Math.max(now + 0.02, Number(opts.nextStart) || 0);
    var usedFade = Math.min(fade, playFor / 3);
    var overlap = Math.min(Math.max(0, cross), playFor / 3);
    return {
      startAt: startAt,
      fade: usedFade,
      playFor: playFor,
      nextStart: startAt + playFor - overlap,
    };
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

  var PRE_ROLL_MS = 500;

  function rmsFromFloat(samples) {
    if (!samples || !samples.length) return 0;
    var sum = 0;
    var i;
    for (i = 0; i < samples.length; i += 1) {
      var v = Number(samples[i]) || 0;
      sum += v * v;
    }
    return Math.sqrt(sum / samples.length);
  }

  function createPreRoll(sampleRate, ms) {
    var rate = sampleRate > 0 ? sampleRate : 48000;
    var windowMs = ms == null ? PRE_ROLL_MS : ms;
    if (windowMs < 300) windowMs = 300;
    if (windowMs > 500) windowMs = 500;
    var capacity = Math.max(1, Math.round(rate * windowMs / 1000));
    var buffer = new Float32Array(capacity);
    var write = 0;
    var filled = 0;
    return {
      sampleRate: rate,
      windowMs: windowMs,
      capacity: capacity,
      push: function (samples) {
        var incoming = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
        var i;
        for (i = 0; i < incoming.length; i += 1) {
          buffer[write] = incoming[i];
          write = (write + 1) % capacity;
          if (filled < capacity) filled += 1;
        }
      },
      snapshot: function () {
        var out = new Float32Array(filled);
        var start = filled < capacity ? 0 : write;
        var i;
        for (i = 0; i < filled; i += 1) out[i] = buffer[(start + i) % capacity];
        return out;
      },
      reset: function () {
        write = 0;
        filled = 0;
        buffer.fill(0);
      },
    };
  }

  function concatPcm(parts) {
    var list = [];
    var total = 0;
    var i;
    for (i = 0; i < parts.length; i += 1) {
      if (!parts[i] || !parts[i].length) continue;
      list.push(parts[i]);
      total += parts[i].length;
    }
    var out = new Float32Array(total);
    var offset = 0;
    var j;
    for (j = 0; j < list.length; j += 1) {
      out.set(list[j], offset);
      offset += list[j].length;
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    var rate = sampleRate > 0 ? sampleRate : 16000;
    var data = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    var n = data.length;
    var buffer = new ArrayBuffer(44 + n * 2);
    var view = new DataView(buffer);
    function writeStr(offset, str) {
      var c;
      for (c = 0; c < str.length; c += 1) view.setUint8(offset + c, str.charCodeAt(c));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, n * 2, true);
    var o = 44;
    var s;
    for (s = 0; s < n; s += 1) {
      var sample = Math.max(-1, Math.min(1, data[s] || 0));
      view.setInt16(o, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      o += 2;
    }
    return new Uint8Array(buffer);
  }

  // Captures from the moment the mic is open. speech_start snapshots the
  // pre-roll, so the onset that the VAD needed in order to fire is inside
  // the clip instead of being dropped.
  function createTalkCapture(options) {
    var opts = options || {};
    var sampleRate = opts.sampleRate > 0 ? opts.sampleRate : 48000;
    var pre = createPreRoll(sampleRate, opts.preRollMs == null ? PRE_ROLL_MS : opts.preRollMs);
    var vad = createVad(opts.vad);
    var active = false;
    var lead = null;
    var chunks = [];

    function copyOf(samples) {
      var incoming = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
      return incoming.slice();
    }

    return {
      sampleRate: sampleRate,
      preRollMs: pre.windowMs,
      pending: function () { return active; },
      reset: function () {
        active = false;
        lead = null;
        chunks = [];
        pre.reset();
        vad.reset();
      },
      push: function (samples, dt, mode) {
        var incoming = copyOf(samples);
        pre.push(incoming);
        var heard = vad.push(rmsFromFloat(incoming), dt, mode || 'listening');
        if (heard === 'speech_start') {
          lead = pre.snapshot();
          chunks = [];
          active = true;
          return { event: 'speech_start' };
        }
        if (heard === 'speech_reject') {
          active = false;
          lead = null;
          chunks = [];
          return { event: 'speech_reject' };
        }
        if (heard === 'speech_end') {
          if (!active) return { event: 'speech_end', samples: new Float32Array(0), wav: null };
          var merged = concatPcm([lead].concat(chunks));
          active = false;
          lead = null;
          chunks = [];
          return { event: 'speech_end', samples: merged, wav: encodeWav(merged, sampleRate) };
        }
        if (active) chunks.push(incoming);
        return { event: heard };
      },
    };
  }

  // A clip that finishes while permissions or the session handshake are
  // still in flight is held and sent once listening is actually on.
  function holdOpeningClip(state, result) {
    var held = state || { ready: false, wav: null };
    if (result && result.event === 'speech_end' && result.wav && result.wav.length > 44) {
      if (!held.ready) {
        held.wav = result.wav;
        return { state: held, send: null };
      }
      return { state: held, send: result.wav };
    }
    return { state: held, send: null };
  }

  function markCaptureReady(state) {
    var held = state || { ready: false, wav: null };
    var send = held.wav || null;
    held.ready = true;
    held.wav = null;
    return { state: held, send: send };
  }

  // A mid-question breath is often longer than the old 900ms cutoff.
  // Ending there sent a partial question, then the rest of the sentence
  // was treated as an interruption and the answer was cut off.
  var DEFAULT_SILENCE_MS = 1800;
  // iOS Safari can fire pagehide or visibility hidden for a moment when
  // the mic and playback share the audio session. Wait this long, and
  // only pause if the page is still hidden.
  var HIDE_PAUSE_MS = 2000;

  function createHidePause(delayMs) {
    var wait = delayMs == null ? HIDE_PAUSE_MS : delayMs;
    var due = 0;
    return {
      delayMs: wait,
      hidden: function (now) {
        if (!due) due = now + wait;
        return { pause: false };
      },
      visible: function () {
        due = 0;
        return { pause: false };
      },
      tick: function (now, visibilityState) {
        if (!due || now < due) return { pause: false };
        due = 0;
        if (visibilityState === 'visible') return { pause: false };
        return { pause: true };
      },
    };
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
    var silenceLimit = opts.silenceMs == null ? DEFAULT_SILENCE_MS : opts.silenceMs;
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
    stripMarkdownForSpeech: stripMarkdownForSpeech,
    polishSpokenChunk: polishSpokenChunk,
    planPrefetch: planPrefetch,
    trimPcmEdges: trimPcmEdges,
    playbackSchedule: playbackSchedule,
    nextSentences: nextSentences,
    isEchoOf: isEchoOf,
    rmsFromTimeDomain: rmsFromTimeDomain,
    rmsFromFloat: rmsFromFloat,
    createPreRoll: createPreRoll,
    concatPcm: concatPcm,
    encodeWav: encodeWav,
    createTalkCapture: createTalkCapture,
    holdOpeningClip: holdOpeningClip,
    markCaptureReady: markCaptureReady,
    PRE_ROLL_MS: PRE_ROLL_MS,
    DEFAULT_SILENCE_MS: DEFAULT_SILENCE_MS,
    HIDE_PAUSE_MS: HIDE_PAUSE_MS,
    createHidePause: createHidePause,
    createVad: createVad,
    statusLabel: statusLabel,
    buttonLabel: buttonLabel,
    createTalkSession: createTalkSession,
  };
});
