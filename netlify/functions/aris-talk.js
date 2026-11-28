// Talk Mode usage for the ARIS coach page.
//
// GET  /api/aris-talk
//   { enabled:false } when the flag is off and this member is not allowlisted.
//   When enabled: cap, used seconds, idle window. No audio. No vendor names.
//
// POST /api/aris-talk  { action:'add', listenSeconds, speakSeconds, requestId }
//   Adds listening and speaking seconds for the signed-in member's UTC month.
//   The same requestId is a no-op, so a retry cannot double-count.
//   Paused time is not sent by the client and is not stored here.
//
// Env (all optional; defaults keep Talk Mode off and the cap at 30 minutes):
//   TALK_MODE_ENABLED       "true" / "1" / "on" / "yes" shows Talk Mode to every member.
//                           Unset or anything else is off.
//   TALK_MODE_ALLOWLIST     Comma-separated Memberstack ids or emails. Those
//                           members see Talk Mode even when the global flag is off.
//   TALK_MODE_UNLIMITED     Same comma list. Those members skip the monthly cap.
//                           Usage is still recorded. Nothing is hardcoded.
//   ARIS_TALK_CAP_MINUTES   Per-member monthly cap. Default 30. 0 blocks Talk Mode.
//   ARIS_TALK_IDLE_SECONDS  Client idle pause. Default 120. Clamped to 120–180.
//   ARIS_TALK_ALERT_MINUTES Total Talk Mode minutes across all members in the UTC
//                           month that write one aris_talk_alert_log row and one
//                           ARIS_TALK_ALERT log line. Default 300. 0 disables the flag.
//                           This function does not send email. See docs/ARIS-TALK-MODE.md.
//
// Requires sql/migrations/add-aris-talk-usage.sql before an allowlisted member
// can start. Until that migration is applied, an enabled member gets a generic
// unavailable response and the coach page keeps the control hidden.
//
// Bundled as CommonJS. Do not build a require() from an import meta URL.

const { enforceMembership } = require('./_Lib/membership');
const { json, preflight } = require('./_Lib/http');
const {
  COPY,
  WARN_LEAD_MS,
  MAX_CHUNK_SECONDS,
  capMinutesFromEnv,
  alertMinutesFromEnv,
  idleMsFromEnv,
  envFlagOn,
  parseAllowlist,
  talkModeAccess,
  talkUnlimited,
  monthKeyFromDate,
  cleanSeconds,
  evaluateMonthAlert,
  createMemoryStore,
} = require('../../assets/js/aris-talk');

const MEMBER_UNAVAILABLE = 'Talk Mode is unavailable right now.';

function unwrapRpc(data) {
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
}

function createSupabaseStore() {
  const { supabase } = require('./_Lib/supabase-client');
  return {
    async add(input) {
      const { data, error } = await supabase.rpc('add_aris_talk_seconds', {
        p_member: input.memberId,
        p_month: input.monthKey,
        p_listen: input.listenSeconds,
        p_speak: input.speakSeconds,
        p_cap: input.capSeconds,
        p_request: input.requestId,
        p_max_chunk: input.maxChunkSeconds,
      });
      if (error) throw error;
      const row = unwrapRpc(data);
      return {
        usedSeconds: Number(row.usedSeconds) || 0,
        listenSeconds: Number(row.listenSeconds) || 0,
        speakSeconds: Number(row.speakSeconds) || 0,
        acceptedListen: Number(row.acceptedListen) || 0,
        acceptedSpeak: Number(row.acceptedSpeak) || 0,
        capped: !!row.capped,
        replayed: !!row.replayed,
      };
    },
    async read(memberId, monthKey) {
      const { data, error } = await supabase
        .from('aris_talk_usage')
        .select('listen_seconds, speak_seconds')
        .eq('memberstack_id', memberId)
        .eq('month_key', monthKey)
        .maybeSingle();
      if (error) throw error;
      const listen = data ? Number(data.listen_seconds) || 0 : 0;
      const speak = data ? Number(data.speak_seconds) || 0 : 0;
      return { listenSeconds: listen, speakSeconds: speak, usedSeconds: listen + speak };
    },
    async monthTotal(monthKey) {
      const { data, error } = await supabase
        .from('aris_talk_usage')
        .select('listen_seconds, speak_seconds')
        .eq('month_key', monthKey);
      if (error) throw error;
      let total = 0;
      for (const row of data || []) {
        total += (Number(row.listen_seconds) || 0) + (Number(row.speak_seconds) || 0);
      }
      return total;
    },
    async hasAlert(monthKey, thresholdMinutes) {
      const { data, error } = await supabase
        .from('aris_talk_alert_log')
        .select('month_key')
        .eq('month_key', monthKey)
        .eq('threshold_minutes', thresholdMinutes)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    async insertAlert(row) {
      const { error } = await supabase.from('aris_talk_alert_log').insert({
        month_key: row.monthKey,
        threshold_minutes: row.thresholdMinutes,
        total_seconds: row.totalSeconds,
      });
      if (error && error.code === '23505') return false;
      if (error) throw error;
      return true;
    },
  };
}

function defaultGetMember(env) {
  return async function getMember(id) {
    const key = (env || process.env).MEMBERSTACK_SECRET_KEY;
    if (!key) throw new Error('membership lookup is not configured');
    const admin = require('@memberstack/admin').init(key);
    const res = await admin.members.retrieve({ id });
    return (res && res.data) || null;
  };
}

function emailOf(member) {
  if (!member) return '';
  if (member.auth && member.auth.email) return String(member.auth.email);
  if (member.email) return String(member.email);
  return '';
}

async function flagMonth(store, env, monthKey, log) {
  const threshold = alertMinutesFromEnv(env);
  try {
    const total = await store.monthTotal(monthKey);
    const already = threshold > 0 ? await store.hasAlert(monthKey, threshold) : false;
    const decision = evaluateMonthAlert({
      totalSeconds: total,
      thresholdMinutes: threshold,
      alreadyFlagged: already,
    });
    if (!decision.flag) return decision;
    const inserted = await store.insertAlert({
      monthKey: monthKey,
      thresholdMinutes: threshold,
      totalSeconds: total,
    });
    if (inserted) {
      log.log(
        'ARIS_TALK_ALERT month=' + monthKey +
        ' totalSeconds=' + total +
        ' totalMinutes=' + Math.floor(total / 60) +
        ' thresholdMinutes=' + threshold +
        ' note=log-only-no-email'
      );
    }
    return decision;
  } catch (err) {
    log.error('aris-talk: alert check failed');
    return { flag: false, reason: 'error' };
  }
}

// Large enough that the SQL cap check never trips, and small enough for
// a Postgres integer. Unlimited members still store their seconds.
const UNLIMITED_CAP_SECONDS = 100000000;

function statusBody(usedSeconds, capSeconds, idleMs, monthKey, unlimited) {
  const used = Math.max(0, usedSeconds);
  if (unlimited) {
    return {
      enabled: true,
      unlimited: true,
      capSeconds: capSeconds,
      usedSeconds: used,
      remainingSeconds: UNLIMITED_CAP_SECONDS,
      capped: false,
      idleMs: idleMs,
      warnLeadMs: WARN_LEAD_MS,
      monthKey: monthKey,
      capMessage: '',
    };
  }
  const remaining = Math.max(0, capSeconds - used);
  return {
    enabled: true,
    unlimited: false,
    capSeconds: capSeconds,
    usedSeconds: used,
    remainingSeconds: remaining,
    capped: used >= capSeconds,
    idleMs: idleMs,
    warnLeadMs: WARN_LEAD_MS,
    monthKey: monthKey,
    capMessage: used >= capSeconds ? COPY.cap : '',
  };
}

function createHandler(deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const now = d.now || (() => new Date());
  const enforce = d.enforce || ((event) => enforceMembership(event));
  const store = d.store || createSupabaseStore();
  const getMember = d.getMember || defaultGetMember(env);
  const log = d.log || console;

  async function allow(memberId) {
    const id = String(memberId || '').trim().toLowerCase();
    const allowList = parseAllowlist(env.TALK_MODE_ALLOWLIST);
    const unlimitedList = parseAllowlist(env.TALK_MODE_UNLIMITED);
    const idAllow = !!(id && allowList.indexOf(id) !== -1);
    const idUnlimited = !!(id && unlimitedList.indexOf(id) !== -1);
    let email = '';
    const needEmail = (!idAllow && !envFlagOn(env.TALK_MODE_ENABLED) && allowList.length)
      || (!idUnlimited && unlimitedList.length);
    if (needEmail) {
      try {
        email = emailOf(await getMember(memberId));
      } catch (err) {
        log.error('aris-talk: member lookup failed');
        email = '';
      }
    }
    const access = talkModeAccess({ env: env, memberId: memberId, email: email });
    access.unlimited = talkUnlimited({ env: env, memberId: memberId, email: email });
    return access;
  }

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const gate = await enforce(event);
    if (gate.response) return gate.response;
    const memberId = gate.access && gate.access.memberId;
    if (!memberId) return json(401, { error: 'Active membership required' });

    const access = await allow(memberId);
    if (!access.enabled) return json(200, { enabled: false });

    const monthKey = monthKeyFromDate(now());
    const capSeconds = capMinutesFromEnv(env) * 60;
    const idleMs = idleMsFromEnv(env);
    const storeCap = access.unlimited ? UNLIMITED_CAP_SECONDS : capSeconds;

    if (event.httpMethod === 'GET') {
      try {
        const row = await store.read(memberId, monthKey);
        await flagMonth(store, env, monthKey, log);
        return json(200, statusBody(row.usedSeconds, capSeconds, idleMs, monthKey, access.unlimited));
      } catch (err) {
        log.error('aris-talk: status failed');
        return json(503, { enabled: false, error: MEMBER_UNAVAILABLE });
      }
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: MEMBER_UNAVAILABLE }); }

    if (body.action !== 'add') return json(400, { error: 'Unknown action' });

    const listenSeconds = cleanSeconds(body.listenSeconds);
    const speakSeconds = cleanSeconds(body.speakSeconds);
    const requestId = String(body.requestId || '').trim();
    if (listenSeconds == null || speakSeconds == null || !requestId || requestId.length > 80) {
      return json(400, { error: MEMBER_UNAVAILABLE });
    }

    try {
      const saved = await store.add({
        memberId: memberId,
        monthKey: monthKey,
        listenSeconds: listenSeconds,
        speakSeconds: speakSeconds,
        capSeconds: storeCap,
        requestId: requestId,
        maxChunkSeconds: MAX_CHUNK_SECONDS,
      });
      await flagMonth(store, env, monthKey, log);
      const payload = statusBody(saved.usedSeconds, capSeconds, idleMs, monthKey, access.unlimited);
      payload.acceptedListen = saved.acceptedListen;
      payload.acceptedSpeak = saved.acceptedSpeak;
      payload.replayed = !!saved.replayed;
      return json(200, payload);
    } catch (err) {
      log.error('aris-talk: usage update failed');
      return json(503, { enabled: true, error: MEMBER_UNAVAILABLE });
    }
  };
}

exports.handler = function handler(event, context) {
  return createHandler()(event, context);
};
exports.createHandler = createHandler;
exports.createMemoryStore = createMemoryStore;
exports.MEMBER_UNAVAILABLE = MEMBER_UNAVAILABLE;
