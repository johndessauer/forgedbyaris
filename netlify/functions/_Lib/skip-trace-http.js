// Owner contact lookup. Empire members only. A hit debits 20 cents that
// was held before the upstream call. A miss, a cache hit, and an upstream
// failure release the hold. The 90-day cache is per member and address.
const { json, preflight } = require('./http');
const { readRuntimeEnv } = require('./runtime-env');
const shared = require('../../../assets/js/skip-trace-shared');
const vendor = require('./skip-trace-vendor');
const present = require('./skip-trace-present');
const contacts = require('./contact-fields');

const DEFAULT_DAILY_CAP = 25;
const DEFAULT_MONTHLY_CAP = 2000;

function parseCap(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function capsFromEnv(env) {
  return {
    daily: parseCap(readRuntimeEnv(env, 'SKIP_TRACE_MEMBER_DAILY_CAP'), DEFAULT_DAILY_CAP),
    monthly: parseCap(readRuntimeEnv(env, 'SKIP_TRACE_MONTHLY_VENDOR_CAP'), DEFAULT_MONTHLY_CAP),
  };
}

function buckets(now, memberId) {
  const iso = now.toISOString();
  return {
    day: memberId + ':' + iso.slice(0, 10),
    month: iso.slice(0, 7),
  };
}

function capMessage(code, caps) {
  if (code === 'daily_cap') {
    return 'You\'ve reached today\'s limit of ' + caps.daily + ' owner-contact lookups. It resets tomorrow. No credits were charged.';
  }
  if (code === 'monthly_cap') {
    return 'Owner contact lookups have reached this month\'s limit. Try again next month, or email support@forgedbyaris.com. No credits were charged.';
  }
  return 'Not enough skip-trace credits for this lookup. Add a pack on your profile. No lookup was run.';
}

function storageDown(err) {
  const msg = String((err && (err.message || err.details || err.code)) || err || '');
  return /skip_trace_|does not exist|schema cache|PGRST202|42883|42P01/i.test(msg);
}

function cacheRow(memberId, key, label, result, chargedCents, now) {
  const expires = new Date(now.getTime() + shared.CACHE_DAYS * 24 * 60 * 60 * 1000);
  return {
    memberstack_id: memberId,
    address_key: key,
    address_label: label,
    hit: !!result.hit,
    charged_cents: chargedCents,
    result: result,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
}

function viewFromCache(row, balanceCents) {
  const result = row.result || {};
  return Object.assign({}, result, {
    cached: true,
    chargedCents: 0,
    balanceCents: balanceCents,
    lookedUpAt: row.created_at,
  });
}

function subjectFrom(body) {
  const parsed = shared.parseAddress(body || {});
  if (parsed.error) return parsed;
  const names = shared.ownerNames(body || {});
  return {
    street: parsed.street,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    firstName: names.first,
    lastName: names.last,
    ownerName: names.full,
  };
}

function quoteBody(subject, wallet, usage, caps, cached) {
  const cost = cached ? 0 : shared.LOOKUP_CENTS;
  let code = '';
  if (!cached && wallet.balanceCents < shared.LOOKUP_CENTS) code = 'insufficient';
  else if (!cached && usage.daily >= caps.daily) code = 'daily_cap';
  else if (!cached && usage.monthly >= caps.monthly) code = 'monthly_cap';
  return {
    quote: true,
    costCents: cost,
    balanceCents: wallet.balanceCents,
    cached: !!cached,
    sufficient: !code,
    code: code,
    message: code ? capMessage(code, caps) : '',
    dailyLimit: caps.daily,
    dailyUsed: usage.daily,
    entityNote: shared.entityNote(subject.ownerName),
    addressLabel: shared.addressLabel(subject),
  };
}

async function runLookup(options) {
  const env = options.env;
  const store = options.store;
  const memberId = options.memberId;
  const body = options.body || {};
  const now = options.now || new Date();
  const caps = capsFromEnv(env);
  const subject = subjectFrom(body);
  if (subject.error) return json(400, { error: subject.error });

  const key = shared.addressKey(subject);
  const label = shared.addressLabel(subject);
  const wallet = await store.getWallet(memberId);
  const slot = buckets(now, memberId);
  const cached = await store.getCache(memberId, key);
  if (cached && cached.result && body.confirm === true) {
    return json(200, viewFromCache(cached, wallet.balanceCents));
  }

  let usage = { daily: 0, monthly: 0 };
  try { usage = await store.peekUsage(slot.day, slot.month); }
  catch (err) { usage = { daily: 0, monthly: 0 }; }

  if (body.confirm !== true) {
    return json(200, quoteBody(subject, wallet, usage, caps, !!(cached && cached.result)));
  }

  const preview = quoteBody(subject, wallet, usage, caps, false);
  if (!preview.sufficient) {
    const status = preview.code === 'insufficient' ? 402 : 429;
    return json(status, {
      error: preview.message,
      code: preview.code,
      balanceCents: wallet.balanceCents,
      costCents: shared.LOOKUP_CENTS,
    });
  }

  const begun = await store.beginLookup({
    memberId: memberId,
    amountCents: shared.LOOKUP_CENTS,
    addressKey: key,
    dailyCap: caps.daily,
    monthlyCap: caps.monthly,
    dayBucket: slot.day,
    monthBucket: slot.month,
  });
  if (!begun || begun.ok === false) {
    const code = begun && begun.code || 'insufficient';
    const status = code === 'insufficient' ? 402 : 429;
    return json(status, {
      error: capMessage(code, caps),
      code: code,
      balanceCents: begun && begun.balanceCents != null ? begun.balanceCents : wallet.balanceCents,
      costCents: shared.LOOKUP_CENTS,
    });
  }

  let outcome = 'release';
  let releaseDaily = true;
  try {
    const upstream = await vendor.lookupOwner({
      env: env,
      fetch: options.fetch,
      street: subject.street,
      city: subject.city,
      state: subject.state,
      zip: subject.zip,
      firstName: subject.firstName,
      lastName: subject.lastName,
    });
    if (!upstream.ok) {
      const finished = await store.finishLookup({
        memberId: memberId,
        holdId: begun.holdId,
        outcome: 'release',
        monthBucket: slot.month,
        dayBucket: slot.day,
        releaseDaily: true,
      });
      outcome = '';
      const pub = upstream.publicError || vendor.publicError(503);
      return json(pub.statusCode, {
        error: pub.error,
        code: pub.code,
        balanceCents: finished && finished.balanceCents != null ? finished.balanceCents : wallet.balanceCents,
      });
    }

    const result = present.presentLookup(upstream.data, subject, subject.ownerName);
    if (present.containsVendorName(result)) {
      throw new Error('scrub');
    }
    const hit = result.hit === true;
    outcome = hit ? 'debit' : 'release';
    releaseDaily = false;
    const finished = await store.finishLookup({
      memberId: memberId,
      holdId: begun.holdId,
      outcome: outcome,
      monthBucket: slot.month,
      dayBucket: slot.day,
      releaseDaily: false,
    });
    outcome = '';
    const charged = hit ? shared.LOOKUP_CENTS : 0;
    const payload = Object.assign({}, result, {
      cached: false,
      chargedCents: charged,
      balanceCents: finished && finished.balanceCents != null ? finished.balanceCents : wallet.balanceCents,
    });
    try {
      await store.putCache(cacheRow(memberId, key, label, payload, charged, now));
    } catch (err) {
      console.error('skip-trace cache write failed:', err && err.message);
    }
    return json(200, payload);
  } catch (err) {
    if (outcome) {
      try {
        await store.finishLookup({
          memberId: memberId,
          holdId: begun.holdId,
          outcome: 'release',
          monthBucket: slot.month,
          dayBucket: slot.day,
          releaseDaily: releaseDaily,
        });
      } catch (releaseErr) {
        console.error('skip-trace hold release failed:', releaseErr && releaseErr.message);
      }
    }
    console.error('skip-trace lookup failed:', err && err.message);
    return json(502, { error: 'Owner contact lookup could not be completed. No credits were charged.' });
  }
}

function primaryPhone(phones) {
  const list = phones || [];
  const clean = list.find(function (item) { return item && !item.dnc && !item.tcpa && !item.litigator; });
  return (clean || list[0] || {}).number || null;
}

function saveFields(body) {
  const person = body.person || {};
  const mailing = person.mailingAddress || body.mailingAddress || {};
  const property = shared.parseAddress(body.property || body);
  const mailingLine = [mailing.street, mailing.city, [mailing.state, mailing.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const extras = contacts.normalizeExtras({
    address: mailingLine || (property.error ? '' : shared.addressLabel(property)),
    phones: person.phones || body.phones || [],
    emails: person.emails || body.emails || [],
    flags: {
      litigator: !!(person.litigator || (body.flags && body.flags.litigator)),
      deceased: !!(person.deceased || (body.flags && body.flags.deceased)),
      dnc: !!(body.flags && body.flags.dnc) || (person.phones || []).some(function (item) { return item && item.dnc; }),
      tcpa: !!(body.flags && body.flags.tcpa) || (person.phones || []).some(function (item) { return item && item.tcpa; }),
      entityLimited: !!(body.flags && body.flags.entityLimited) || !!shared.entityNote(body.owner || body.ownerName || ''),
    },
    outreach_status: 'new',
  });
  if (extras.error) return extras;
  const name = shared.text(person.fullName || body.name || body.owner);
  if (!name) return { error: 'A contact name is required.' };
  const emails = extras.fields.emails || [];
  return {
    fields: Object.assign({
      name: name.slice(0, 160),
      phone: primaryPhone(extras.fields.phones),
      email: emails[0] || null,
    }, extras.fields),
  };
}

function createHandler(deps) {
  const options = deps || {};
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const env = options.env || process.env;
    const enforce = options.enforceMembership || function (ev, opts) {
      return require('./membership').enforceMembership(ev, opts);
    };
    const gate = await enforce(event, { need: 'empire' });
    if (gate.response) return gate.response;
    const memberId = gate.access.memberId;

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }

    const store = options.store || options.getStore();
    try {
      if (body.action === 'save_contact') {
        const prepared = saveFields(body);
        if (prepared.error) return json(400, { error: prepared.error });
        const save = options.saveContact || defaultSaveContact;
        const contact = await save(memberId, prepared.fields);
        return json(201, { contact: contact });
      }
      if (body.action === 'quote' || body.action === 'lookup' || !body.action) {
        const lookupBody = Object.assign({}, body, { confirm: body.action === 'quote' ? false : body.confirm === true });
        return await runLookup({
          env: env,
          store: store,
          memberId: memberId,
          body: lookupBody,
          fetch: options.fetch,
          now: options.now ? options.now() : new Date(),
        });
      }
      return json(400, { error: 'Unknown action' });
    } catch (err) {
      if (storageDown(err)) return json(503, { error: 'Owner contact credits are not ready yet.' });
      console.error('skip-trace error:', err && err.message);
      return json(500, { error: 'Owner contact lookup could not be completed.' });
    }
  };
}

async function defaultSaveContact(memberId, fields) {
  const { supabase } = require('./supabase-client');
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      memberstack_id: memberId,
      name: fields.name,
      type: 'seller',
      phone: fields.phone || null,
      email: fields.email || null,
      address: fields.address || null,
      phones: fields.phones || [],
      emails: fields.emails || [],
      flags: fields.flags || {},
      outreach_status: fields.outreach_status || 'new',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  DEFAULT_DAILY_CAP,
  DEFAULT_MONTHLY_CAP,
  capsFromEnv,
  capMessage,
  createHandler,
  runLookup,
  saveFields,
  storageDown,
};
