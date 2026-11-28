/* ARIS Talk Mode — pure logic.
 *
 * No microphone, no network, no vendor names. The coach page and the
 * aris-talk Netlify function both use this file. Member-facing strings
 * live in COPY and must stay free of vendor names.
 *
 * Idle: 2 minutes of no member speech by default, clamped to 2–3 minutes.
 * Hitting the idle deadline pauses the session. It does not end it.
 * Listening and speaking time count toward the monthly cap. Paused,
 * off, capped, ready, and thinking time do not.
 *
 * style "natural" is the hands-free loop (Mogul, and TALK_MODE_UNLIMITED).
 * style "turn" is strict turn-taking: one tap, one utterance, no barge-in,
 * and the microphone closes while ARIS answers.
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
    here: "I'm here.",
    missedTurn: "I didn't catch that. Tap Talk to try again.",
    yourTurn: 'Your turn — tap Talk',
    near90: "You've used 90% of your Talk Mode time this month.",
    near95: "You've used 95% of your Talk Mode time this month.",
    packLabel: 'Add 60 more minutes this month for $19.97.',
    packReady: 'Your extra Talk Mode minutes are ready for this month.',
    packPending: 'Your extra minutes will show up in a moment. Refresh this page, then tap Talk.',
    packFailed: 'Extra minutes could not be started. You can keep typing.',
    packNotYet: 'You can add minutes after you have used your Talk Mode time for this month.',
    hearing: 'I had trouble hearing that. Talk Mode stopped. You can keep typing, and you can play a reply with the speaker button.',
    unavailable: 'Talk Mode is unavailable right now. You can keep typing.',
    confirmPause: 'Talk Mode paused — tap to resume',
  };

  // Mogul cap is fixed. Non-Mogul keeps ARIS_TALK_CAP_MINUTES (default 30).
  // The pack is one charge of 60 minutes. Price stays in cents so the
  // checkout and the ledger cannot drift. Product ids stay on the server.
  var MOGUL_CAP_MINUTES = 600;
  var PACK_MINUTES = 60;
  var PACK_SECONDS = PACK_MINUTES * 60;
  var PACK_AMOUNT_CENTS = 1997;

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

  // Commas, semicolons, and any whitespace. A Netlify value pasted with
  // spaces or line breaks still matches. Comparison is case-insensitive.
  function parseAllowlist(value) {
    return String(value == null ? '' : value)
      .split(/[,;\s]+/)
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

  // Same separator rules as the allowlist. A match skips the monthly cap.
  // Ids and emails are compared case-insensitively. Nothing is hardcoded.
  function talkUnlimited(input) {
    var opts = input || {};
    var env = opts.env || {};
    var list = parseAllowlist(env.TALK_MODE_UNLIMITED);
    if (!list.length) return false;
    var id = String(opts.memberId || '').trim().toLowerCase();
    var email = String(opts.email || '').trim().toLowerCase();
    if (id && list.indexOf(id) !== -1) return true;
    if (email && list.indexOf(email) !== -1) return true;
    return false;
  }

  // TODO(mogul-source): realwiseacademy.com is not in this repository, and
  // nothing here reads a REALWISE progression. Memberstack plans are
  // Foundation and Empire. Memberstack custom fields do not store Mogul.
  // The only Mogul record in FORGE is the education badge
  // education_level_awards.level = 'mogul' (Rookie, Investor, Mogul).
  // Pass that as awards.mogul. TALK_MOGUL_MEMBER_IDS is the test override
  // (Memberstack ids and emails). If John's Mogul is a
  // progression that lives only on the REALWISE site, this returns false
  // for those students until that source is passed in as awards.mogul.
  function isMogul(member, options) {
    var opts = options || {};
    var env = opts.env || {};
    var list = parseAllowlist(env.TALK_MOGUL_MEMBER_IDS);
    var id = String((member && (member.id || member.memberId)) || opts.memberId || '').trim().toLowerCase();
    var email = '';
    if (member && member.auth && member.auth.email) email = String(member.auth.email);
    else if (member && member.email) email = String(member.email);
    else email = String(opts.email || '');
    email = email.trim().toLowerCase();
    if (id && list.indexOf(id) !== -1) return true;
    if (email && list.indexOf(email) !== -1) return true;
    var awards = opts.awards || null;
    return !!(awards && awards.mogul === true);
  }

  function capWarning(usedSeconds, capSeconds) {
    var used = Math.max(0, Math.floor(Number(usedSeconds) || 0));
    var cap = Math.max(0, Math.floor(Number(capSeconds) || 0));
    if (!cap || used >= cap) return { level: 0, message: '' };
    var ratio = used / cap;
    if (ratio >= 0.95) return { level: 95, message: COPY.near95 };
    if (ratio >= 0.9) return { level: 90, message: COPY.near90 };
    return { level: 0, message: '' };
  }

  function packOffer() {
    return {
      minutes: PACK_MINUTES,
      amountCents: PACK_AMOUNT_CENTS,
      label: COPY.packLabel,
    };
  }

  // unlimited wins over Mogul. Mogul gets natural Talk and 600 minutes.
  // Everyone else gets turn-taking and ARIS_TALK_CAP_MINUTES.
  // Pack minutes add to this month's cap only. They do not raise a future month.
  function talkAllowance(input) {
    var opts = input || {};
    var env = opts.env || {};
    var unlimited = opts.unlimited;
    if (unlimited == null) {
      unlimited = talkUnlimited({ env: env, memberId: opts.memberId, email: opts.email });
    }
    var mogul = isMogul(opts.member, {
      env: env,
      memberId: opts.memberId,
      email: opts.email,
      awards: opts.awards,
    });
    var style = (unlimited || mogul) ? 'natural' : 'turn';
    var baseMinutes = mogul ? MOGUL_CAP_MINUTES : capMinutesFromEnv(env);
    var baseCapSeconds = baseMinutes * 60;
    var packSeconds = Math.max(0, Math.floor(Number(opts.packSeconds) || 0));
    var capSeconds = baseCapSeconds + (unlimited ? 0 : packSeconds);
    var used = Math.max(0, Math.floor(Number(opts.usedSeconds) || 0));
    var packSupported = opts.packSupported !== false;
    var warning = unlimited ? { level: 0, message: '' } : capWarning(used, capSeconds);
    var capped = !unlimited && used >= capSeconds;
    return {
      unlimited: !!unlimited,
      mogul: !!mogul,
      style: style,
      baseMinutes: baseMinutes,
      baseCapSeconds: baseCapSeconds,
      packSeconds: packSeconds,
      capSeconds: capSeconds,
      capped: capped,
      packSupported: packSupported,
      warnLevel: capped ? 0 : warning.level,
      warnMessage: capped ? '' : warning.message,
      packOffer: (!unlimited && capped && packSupported) ? packOffer() : null,
    };
  }

  function talkTimeBlocked(status) {
    if (!status || status.unlimited) return false;
    if (status.capped) return true;
    var remaining = Number(status.remainingSeconds);
    return Number.isFinite(remaining) && remaining <= 0;
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

  function createMemoryStore(seed) {
    var options = seed || {};
    var rows = {};
    var alerts = {};
    var credited = {};
    var moguls = {};
    var mi;
    var seedMoguls = options.moguls || [];
    for (mi = 0; mi < seedMoguls.length; mi += 1) moguls[seedMoguls[mi]] = true;

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
          packSeconds: row.packSeconds || 0,
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
        if (!row) return { listenSeconds: 0, speakSeconds: 0, usedSeconds: 0, packSeconds: 0, packSupported: true };
        return {
          listenSeconds: row.listenSeconds,
          speakSeconds: row.speakSeconds,
          usedSeconds: row.listenSeconds + row.speakSeconds,
          packSeconds: row.packSeconds || 0,
          packSupported: true,
        };
      },
      async mogulAward(memberId) {
        return !!moguls[memberId];
      },
      async creditPack(input) {
        var request = input || {};
        var id = key(request.memberId, request.monthKey);
        var row = rows[id] || { listenSeconds: 0, speakSeconds: 0, packSeconds: 0, seen: {} };
        var sessionId = String(request.stripeSessionId || '').trim();
        if (sessionId && credited[sessionId]) {
          return { ok: true, credited: false, duplicate: true, packSeconds: row.packSeconds || 0 };
        }
        if (request.seconds !== PACK_SECONDS || request.amountCents !== PACK_AMOUNT_CENTS) {
          return { ok: false, error: 'bad pack' };
        }
        if (!request.monthKey || !/^[0-9]{4}-[0-9]{2}$/.test(request.monthKey)) {
          return { ok: false, error: 'bad month' };
        }
        row.packSeconds = (row.packSeconds || 0) + request.seconds;
        rows[id] = row;
        if (sessionId) credited[sessionId] = true;
        return { ok: true, credited: true, duplicate: false, packSeconds: row.packSeconds };
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
    s = s.replace(/^[ \t]*>[ \t]?/gm, '');
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

  // What the mic loop should do for one voice-activity event.
  // While ARIS is speaking, the first loud frames only arm the recorder.
  // Playback stops once that loudness holds long enough to be the member.
  // Echo is only the playing sentence (plus the one before it) coming back
  // through the speakers. A short command is the member, even when those
  // words also appear in the reply.
  var BARGE_COMMANDS = {
    stop: true,
    wait: true,
    no: true,
    pause: true,
    aris: true,
    'hold on': true,
    'hang on': true,
  };

  function interruptionIsEcho(heard, spoken, previous) {
    var h = normalizeEcho(heard);
    if (!h) return true;
    if (BARGE_COMMANDS[h]) return false;
    var heardWords = h.split(' ').filter(Boolean);
    if (heardWords.length < 4) return false;
    var s = normalizeEcho([spoken, previous].filter(Boolean).join(' '));
    if (!s) return false;
    var words = heardWords.filter(function (word) { return word.length > 2; });
    if (!words.length) return false;
    var hits = 0;
    var i;
    for (i = 0; i < words.length; i += 1) {
      if (s.indexOf(words[i]) !== -1) hits += 1;
    }
    return hits / words.length >= 0.75;
  }

  // iPhone speaker echo is loud and echo cancellation is weak, so iOS keeps
  // an unbroken half-second above a 0.10 floor and a 2.5x ratio.
  // Desktop Chrome on MacBook speakers attenuates the member to about
  // 0.04–0.08 while speaker bleed becomes the echo floor. The desktop
  // gate follows that floor: limit = max(0.035, baseline * 1.4).
  // The baseline is seeded from the quiet level before ARIS speaks, then
  // moves at about 0.05 per frame, and only on frames that still look
  // like bleed. Frames during an arm or a candidate, and frames that look
  // like the member, do not raise it. The 80ms onset still locks onto
  // steady bleed quickly (so ARIS's own voice does not count as a barge);
  // a step more than 6x the current floor is left alone. A syllable
  // dip still does not clear the 250ms / 400ms hold. Scheduling the next
  // sentence must not clear a hold already in progress.
  var BARGE_HOLD_MS = 500;
  var BARGE_GRACE_MS = 300;
  var BARGE_RATIO = 2.5;
  var BARGE_FLOOR = 0.1;
  var BARGE_FLOOR_DESKTOP = 0.035;
  var BARGE_RATIO_DESKTOP = 1.4;
  var BARGE_LEARN_DESKTOP = 0.05;
  var BARGE_GRACE_ALPHA_DESKTOP = 0.5;
  var BARGE_BLEED_BAND = 1.2;
  var BARGE_GRACE_LOCK = 6;
  var BARGE_LISTEN_CEILING = 0.04;
  var BARGE_HOLD_DESKTOP_MS = 250;
  var BARGE_WINDOW_DESKTOP_MS = 400;
  var BARGE_GRACE_DESKTOP_MS = 80;
  var BARGE_ARM_MS = 80;
  var BARGE_DUCK_GAIN = 0.15;
  var BARGE_DUCK_MS = 50;

  function isIosTalkDevice(ua, touchPoints) {
    var agent = String(ua || '');
    if (/iPad|iPhone|iPod/i.test(agent)) return true;
    // iPadOS desktop mode reports Macintosh and a touch screen. A MacBook
    // running Chrome stays on the desktop gate even if it has a touchscreen.
    if (/Macintosh/i.test(agent) && Number(touchPoints) > 1 && !/Chrome|Chromium|CriOS|Edg\/|Firefox|FxiOS/i.test(agent)) {
      return true;
    }
    return false;
  }

  function readTuneNumber(storage, key) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return null;
      var raw = storage.getItem(key);
      if (raw == null || String(raw).trim() === '') return null;
      var n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    } catch (err) {
      return null;
    }
  }

  function bargeWatchOptions(env) {
    var source = env || {};
    var nav = source.navigator || null;
    var ua = source.ua != null ? source.ua : (nav && nav.userAgent) || '';
    var touch = source.touchPoints != null ? source.touchPoints : (nav && nav.maxTouchPoints) || 0;
    var storage = null;
    if (Object.prototype.hasOwnProperty.call(source, 'storage')) storage = source.storage;
    else {
      try { storage = source.localStorage || null; } catch (err) { storage = null; }
    }
    var platform = source.talkPlatform;
    if (platform !== 'ios' && platform !== 'desktop') {
      platform = isIosTalkDevice(ua, touch) ? 'ios' : 'desktop';
    }
    var ios = platform === 'ios';
    var floor = readTuneNumber(storage, 'arisBargeFloor');
    var hold = readTuneNumber(storage, 'arisBargeHoldMs');
    return {
      platform: platform,
      floor: floor != null ? floor : (ios ? BARGE_FLOOR : BARGE_FLOOR_DESKTOP),
      holdMs: hold != null ? hold : (ios ? BARGE_HOLD_MS : BARGE_HOLD_DESKTOP_MS),
      graceMs: ios ? BARGE_GRACE_MS : BARGE_GRACE_DESKTOP_MS,
      strict: ios,
      ratio: ios ? BARGE_RATIO : BARGE_RATIO_DESKTOP,
    };
  }

  function bargeGainPlan(action) {
    if (action === 'duck') return { gain: BARGE_DUCK_GAIN, rampMs: BARGE_DUCK_MS };
    return { gain: 1, rampMs: BARGE_DUCK_MS };
  }

  // Sentences that start while a duck is already on must not fade back up
  // to full volume. rampActiveGain only reaches sources that exist already.
  function bargePlaybackPeak(ducked) {
    return ducked ? BARGE_DUCK_GAIN : 1;
  }

  function focusBlocksManualBarge(node) {
    var el = node || null;
    if (el && el.nodeType && el.nodeType !== 1) el = el.parentElement || null;
    while (el) {
      var tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      var editable = el.getAttribute && el.getAttribute('contenteditable');
      if (editable && String(editable).toLowerCase() !== 'false') return true;
      el = el.parentElement || null;
    }
    return false;
  }

  // Space interrupts playback unless the member is typing. The click
  // control uses the same phase check. Both styles, no microphone.
  function isManualBargeKey(event, phase) {
    if (!event || event.repeat) return false;
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key !== ' ' && event.code !== 'Space') return false;
    if (phase !== 'speaking') return false;
    return !focusBlocksManualBarge(event.target);
  }

  function createBargeWatch(options) {
    var opts = options || {};
    var platform = opts.platform === 'ios' || opts.platform === 'desktop' ? opts.platform : 'legacy';
    var strict = opts.strict != null ? opts.strict : platform !== 'desktop';
    var floor = opts.floor != null ? opts.floor : (platform === 'desktop' ? BARGE_FLOOR_DESKTOP : BARGE_FLOOR);
    var holdMs = opts.holdMs != null ? opts.holdMs : (platform === 'desktop' ? BARGE_HOLD_DESKTOP_MS : BARGE_HOLD_MS);
    var graceMs = opts.graceMs != null ? opts.graceMs : (platform === 'desktop' ? BARGE_GRACE_DESKTOP_MS : BARGE_GRACE_MS);
    var ratio = opts.ratio == null ? (platform === 'desktop' ? BARGE_RATIO_DESKTOP : BARGE_RATIO) : opts.ratio;
    var windowMs = opts.windowMs != null ? opts.windowMs : (strict ? 0 : Math.max(BARGE_WINDOW_DESKTOP_MS, holdMs + 150));
    var initialBaseline = opts.baseline == null ? 0.03 : opts.baseline;
    var baseline = initialBaseline;
    var listenLevel = null;
    var sentenceAt = 0;
    var hasSentence = false;
    var loudMs = 0;
    var frames = [];

    function limit() {
      return Math.max(floor, baseline * ratio);
    }

    function blend(current, rms, alpha) {
      return current * (1 - alpha) + rms * alpha;
    }

    function clearLoud() {
      loudMs = 0;
      frames.length = 0;
    }

    function prune(t) {
      var cutoff = t - windowMs;
      while (frames.length && frames[0].end <= cutoff) {
        var old = frames.shift();
        if (old.loud) loudMs -= old.dt;
      }
      if (loudMs < 0) loudMs = 0;
    }

    // Close to the echo floor. A step above that is the member, even when
    // it is still under the barge limit, and must not be averaged in.
    function bleedLike(rms) {
      return rms <= baseline * BARGE_BLEED_BAND;
    }

    return {
      platform: platform,
      strict: strict,
      floor: floor,
      ratio: ratio,
      holdMs: holdMs,
      graceMs: graceMs,
      windowMs: windowMs,
      limit: limit,
      baseline: function () { return baseline; },
      // Quiet frames before ARIS speaks. The first sample replaces the
      // fixed 0.03 seed. Later samples move slowly. Member speech and
      // anything already inside a sentence are ignored. iOS keeps the
      // fixed seed.
      observeListening: function (rms) {
        if (strict || hasSentence || loudMs > 0) return;
        var level = Number(rms);
        if (!Number.isFinite(level) || level <= 0 || level >= BARGE_LISTEN_CEILING) return;
        if (listenLevel == null) listenLevel = level;
        else listenLevel = blend(listenLevel, level, BARGE_LEARN_DESKTOP);
        baseline = listenLevel;
      },
      // Playback start. Opens the short dead zone only when no hold is
      // already building. A sentence scheduled ahead of the speakers must
      // use noteScheduled instead.
      noteSentence: function (now) {
        hasSentence = true;
        if (loudMs > 0) return;
        sentenceAt = Number(now) || 0;
      },
      noteScheduled: function () {
        hasSentence = true;
      },
      reset: function () {
        clearLoud();
      },
      release: function () {
        baseline = (!strict && listenLevel != null) ? listenLevel : initialBaseline;
        clearLoud();
        hasSentence = false;
        sentenceAt = 0;
      },
      push: function (sample) {
        var rms = Number(sample && sample.rms) || 0;
        var dt = Math.max(0, Number(sample && sample.dt) || 0);
        var t = Number(sample && sample.now) || 0;
        var ceiling = limit();
        if (hasSentence && loudMs <= 0 && t - sentenceAt < graceMs) {
          if (strict) baseline = baseline * 0.7 + rms * 0.3;
          else if (rms <= Math.max(baseline * BARGE_GRACE_LOCK, floor)) {
            baseline = blend(baseline, rms, BARGE_GRACE_ALPHA_DESKTOP);
          }
          clearLoud();
          return 'grace';
        }
        var loud = rms >= ceiling;
        if (strict) {
          if (!loud) {
            baseline = baseline * 0.8 + rms * 0.2;
            var wasLoud = loudMs > 0;
            loudMs = 0;
            return wasLoud ? 'idle' : 'quiet';
          }
          loudMs += dt;
        } else {
          var had = loudMs > 0;
          frames.push({ end: t, dt: dt, loud: loud });
          if (loud) loudMs += dt;
          else if (loudMs <= 0 && bleedLike(rms)) baseline = blend(baseline, rms, BARGE_LEARN_DESKTOP);
          prune(t);
          if (!loud && loudMs <= 0) return had ? 'idle' : 'quiet';
        }
        if (loudMs >= holdMs) return 'candidate';
        if (loudMs >= BARGE_ARM_MS) return 'arm';
        if (loudMs > 0) return 'rise';
        return 'quiet';
      },
    };
  }

  // A turn that never comes back to listening is what makes the second or
  // third exchange feel hung. These limits are wall-clock, not frame counts.
  var WATCH_THINKING_MS = 75000;
  var WATCH_SPEAKING_MS = 25000;
  var WATCH_TRANSCRIBE_MS = 20000;
  var WATCH_LISTENING_MS = 130000;

  function createTalkWatchdog() {
    var phase = 'off';
    var since = 0;
    return {
      limits: {
        thinking: WATCH_THINKING_MS,
        speaking: WATCH_SPEAKING_MS,
        transcribing: WATCH_TRANSCRIBE_MS,
        listening: WATCH_LISTENING_MS,
      },
      phase: function () { return phase; },
      enter: function (next, now) {
        var name = next || 'off';
        var changed = name !== phase;
        if (changed) {
          phase = name;
          since = now;
        }
        return { changed: changed, phase: phase };
      },
      tick: function (now, info) {
        var extra = info || {};
        var age = since ? Math.max(0, now - since) : 0;
        if (extra.transcribeSince != null && now - extra.transcribeSince >= WATCH_TRANSCRIBE_MS) {
          return { recover: true, from: 'transcribing', age: now - extra.transcribeSince };
        }
        if (phase === 'thinking') {
          var thought = extra.lastProgress == null ? since : extra.lastProgress;
          if (now - thought >= WATCH_THINKING_MS) {
            return { recover: true, from: 'thinking', age: now - thought };
          }
        }
        if (phase === 'speaking') {
          var progress = extra.lastProgress == null ? since : extra.lastProgress;
          if (now - progress >= WATCH_SPEAKING_MS) {
            return { recover: true, from: 'speaking', age: now - progress };
          }
        }
        if (phase === 'listening' && extra.silentSince != null && now - extra.silentSince >= WATCH_LISTENING_MS) {
          return { recover: true, from: 'listening', age: now - extra.silentSince };
        }
        return { recover: false, from: phase, age: age };
      },
    };
  }

  // The 10-turn call stays on listening the whole way. Pass stall:true to
  // hang the next spoken reply. Hands-free recovery lands on listening.
  // Turn-taking recovery lands on ready, which the coach shows as
  // "Your turn — tap Talk."
  function simulateTalkTurns(count, options) {
    var opts = options || {};
    var style = opts.style === 'turn' ? 'turn' : 'natural';
    var home = style === 'turn' ? 'ready' : 'listening';
    var watch = createTalkWatchdog();
    var phase = 'listening';
    var t = 0;
    var log = ['listening'];
    var n;
    var recovered = null;
    watch.enter('listening', 0);
    for (n = 0; n < count; n += 1) {
      t += 400;
      phase = 'thinking';
      watch.enter(phase, t);
      log.push(phase);
      t += 1500;
      phase = 'speaking';
      watch.enter(phase, t);
      log.push(phase);
      t += 2000;
      var stalled = watch.tick(t, { lastProgress: t });
      if (stalled.recover) phase = 'listening';
      phase = 'listening';
      watch.enter(phase, t);
      log.push(phase);
    }
    if (opts.stall) {
      t += 400;
      phase = 'speaking';
      watch.enter(phase, t);
      log.push(phase);
      t += 30000;
      var hung = watch.tick(t, { lastProgress: t - 30000 });
      if (hung.recover) {
        phase = home;
        watch.enter(phase, t);
        log.push(phase);
        recovered = { from: hung.from, phase: phase };
      }
    }
    return {
      phase: phase,
      turns: count,
      log: log,
      style: style,
      recovered: recovered,
    };
  }

  function planVadAction(state, heard) {
    var phase = state && state.phase;
    var priming = !!(state && state.priming);
    var live = !!(state && state.utteranceLive);
    var hot = phase === 'listening' || phase === 'speaking' || phase === 'thinking';
    if (heard === 'noise' && hot && !live) {
      return { prime: !priming, discard: false, barge: false, finish: false };
    }
    if (heard === 'silence' && priming && !live) {
      return { clearPrime: true, discard: true, barge: false, finish: false };
    }
    if (heard === 'speech_start' && (phase === 'speaking' || phase === 'thinking')) {
      if (state && state.allowBarge === false) {
        return { clearPrime: true, live: false, discard: true, barge: false, finish: false };
      }
      return { clearPrime: true, live: true, barge: true, ensureRecorder: true, discard: false, finish: false };
    }
    if (heard === 'speech_start' && phase === 'listening') {
      return { clearPrime: true, live: true, barge: false, note: true, ensureRecorder: true, discard: false, finish: false };
    }
    if (heard === 'speech' && phase === 'listening' && live) {
      return { note: true, barge: false, discard: false, finish: false };
    }
    if (heard === 'speech_reject') {
      return { clearPrime: true, live: false, discard: true, barge: false, finish: false };
    }
    if (heard === 'speech_end' && phase === 'listening' && live) {
      return { clearPrime: true, live: false, finish: true, barge: false, discard: false };
    }
    return { barge: false, discard: false, finish: false };
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
    // Higher than normal listening so speaker bleed does not trip it, and
    // only a short run of frames so a real interruption is not ignored.
    var bargeRms = opts.bargeRms == null ? 0.065 : opts.bargeRms;
    var speechFrames = opts.speechFrames == null ? 4 : opts.speechFrames;
    var bargeFrames = opts.bargeFrames == null ? 4 : opts.bargeFrames;
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
    if (phase === 'ready') return COPY.yourTurn;
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
    var style = opts.style === 'turn' ? 'turn' : 'natural';
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
      out.style = style;
      var handsFree = phase === 'listening' || phase === 'thinking' || phase === 'speaking';
      out.capture = style === 'turn' ? phase === 'listening' : handsFree;
      out.playback = phase === 'speaking';
      out.usageStopped = phase !== 'listening' && phase !== 'speaking';
      return out;
    }

    return {
      get phase() { return phase; },
      get style() { return style; },
      get capture() { return snapshot().capture; },
      get playback() { return phase === 'speaking'; },
      get idleMs() { return idleMs; },
      get warnLeadMs() { return warnLeadMs; },
      start: function (now) {
        if (phase === 'capped') return snapshot({ ok: false, reason: 'capped' });
        if (phase === 'ready') {
          enter('listening', now);
          return snapshot({ ok: true, unlockAudio: true });
        }
        if (phase !== 'off') return snapshot({ ok: false, reason: 'busy' });
        enter('listening', now);
        return snapshot({ ok: true, unlockAudio: true });
      },
      yieldTurn: function (now) {
        if (phase === 'off' || phase === 'capped' || phase === 'ready' || phase === 'paused') {
          return snapshot({ ok: false });
        }
        enter('ready', now);
        return snapshot({ ok: true, yielded: true, stopMic: true, stopPlayback: true });
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
        if (style === 'turn' && (phase === 'speaking' || phase === 'thinking')) {
          return snapshot({ ok: false, bargeIn: false });
        }
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
        if (phase === 'off' || phase === 'paused' || phase === 'capped' || phase === 'ready') {
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
    MOGUL_CAP_MINUTES: MOGUL_CAP_MINUTES,
    PACK_MINUTES: PACK_MINUTES,
    PACK_SECONDS: PACK_SECONDS,
    PACK_AMOUNT_CENTS: PACK_AMOUNT_CENTS,
    clampIdleMs: clampIdleMs,
    clampIdleSeconds: clampIdleSeconds,
    capMinutesFromEnv: capMinutesFromEnv,
    alertMinutesFromEnv: alertMinutesFromEnv,
    idleMsFromEnv: idleMsFromEnv,
    envFlagOn: envFlagOn,
    parseAllowlist: parseAllowlist,
    talkModeAccess: talkModeAccess,
    talkUnlimited: talkUnlimited,
    isMogul: isMogul,
    capWarning: capWarning,
    packOffer: packOffer,
    talkAllowance: talkAllowance,
    talkTimeBlocked: talkTimeBlocked,
    planVadAction: planVadAction,
    createBargeWatch: createBargeWatch,
    bargeWatchOptions: bargeWatchOptions,
    bargeGainPlan: bargeGainPlan,
    bargePlaybackPeak: bargePlaybackPeak,
    focusBlocksManualBarge: focusBlocksManualBarge,
    isManualBargeKey: isManualBargeKey,
    isIosTalkDevice: isIosTalkDevice,
    createTalkWatchdog: createTalkWatchdog,
    simulateTalkTurns: simulateTalkTurns,
    interruptionIsEcho: interruptionIsEcho,
    BARGE_HOLD_MS: BARGE_HOLD_MS,
    BARGE_GRACE_MS: BARGE_GRACE_MS,
    BARGE_FLOOR: BARGE_FLOOR,
    BARGE_FLOOR_DESKTOP: BARGE_FLOOR_DESKTOP,
    BARGE_RATIO_DESKTOP: BARGE_RATIO_DESKTOP,
    BARGE_LEARN_DESKTOP: BARGE_LEARN_DESKTOP,
    BARGE_GRACE_ALPHA_DESKTOP: BARGE_GRACE_ALPHA_DESKTOP,
    BARGE_BLEED_BAND: BARGE_BLEED_BAND,
    BARGE_LISTEN_CEILING: BARGE_LISTEN_CEILING,
    BARGE_HOLD_DESKTOP_MS: BARGE_HOLD_DESKTOP_MS,
    BARGE_WINDOW_DESKTOP_MS: BARGE_WINDOW_DESKTOP_MS,
    BARGE_DUCK_GAIN: BARGE_DUCK_GAIN,
    BARGE_DUCK_MS: BARGE_DUCK_MS,
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
