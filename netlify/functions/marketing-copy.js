// ARIS marketing copy. Uses the same Anthropic account as aris-quote.js,
// with a server-owned prompt. The client cannot replace the system prompt.
// FORGE does not send the copy. Export attaches the compliance reminder.
const { json, preflight } = require('./_Lib/http');
const { loadMarketingGate } = require('./_Lib/marketing-access');
const { memberKey, openBlobStore, readJson } = require('./_Lib/marketing-store');
const { mailReadiness } = require('./marketing-brand');
const catalog = require('../../assets/js/marketing-catalog.js');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 3500;
const MAX_CHANNELS = 8;
const MAX_LEADS_IN_PROMPT = 8;

const SOFT_PLAYS = { prefore: true, foreactivity: true, foreclosure: true, inherited: true, probate: true };

function systemPrompt(propertyClass, angleId) {
  const tone = propertyClass === 'commercial'
    ? 'Write to a company, an LLC, or a trust. Help the student find the decision maker. Use investor language: NOI, cap rate, vacancy, deferred maintenance, and 1031 exchange. Any value talk is a rough income-based range, not an appraisal. Offer seller financing and creative terms as a conversation, not a promise. Never recommend yard signs or door hangers.'
    : 'Write to an individual homeowner or small landlord. Sound personal. Talk about the hassle of ownership and a simple as-is close. Do not use commercial jargon.';
  return [
    'You are ARIS inside FORGE. You draft marketing copy the student will edit and approve. You never send mail, email, or text. You never place an order and you never quote a charge.',
    tone,
    'Guardrails:',
    '- No facts about the owner beyond the property address the student supplied and the list type they already chose. Never say you saw their taxes, their foreclosure, their divorce, or any other private fact.',
    '- No promise of a price. No "save your home." No legal or financial advice. Do not claim to be a lender, an agent, a broker, a court, or a government office.',
    '- If the list is pre-foreclosure or inherited, use a softer options-first tone.',
    '- Text messages are only for contacts who opted in or already responded. Do not write a cold text.',
    '- Emails include the student postal address and an unsubscribe line.',
    '- When you mention a deal, say real estate deal.',
    '- Never name a data vendor, a mail vendor, a print vendor, or a software vendor. Say "FORGE\'s lead data" and "FORGE\'s mail service" if you must refer to them.',
    '- Do not put FORGE branding on the piece. Use only the student name, phone, and Brand Kit fields you are given.',
    '- The default disclosure, when a disclosure is provided, stays in the piece.',
    'Return only JSON with this shape: {"recommendation":"two sentences","copies":[{"channel":"postcard","variantA":"...","variantB":"..."}]}',
    'Write two variants for each requested channel. Keep postcards and signs short. Keep letters to one page of plain language.',
    'An offer letter names the property address, invites a conversation about a non-binding offer, includes the words "not a binding offer", and closes with the student name and phone. Follow the selected angle. Do not promise a price.',
    'A jumbo postcard is a 6 by 11 postcard. Keep it short, with one headline and the student phone.',
    angleInstruction(propertyClass, angleId),
  ].filter(Boolean).join('\n');
}

function angleInstruction(propertyClass, angleId) {
  const angle = catalog.angleById(angleId, propertyClass);
  if (!angle) return '';
  return 'The student chose this message angle: ' + angle.label + '. Write every variant from that angle. ' + angle.guard;
}

function publicLead(lead) {
  const row = lead || {};
  return {
    address: String(row.address || '').slice(0, 160),
    city: String(row.city || '').slice(0, 80),
    state: String(row.state || '').slice(0, 40),
    zip: String(row.zip || '').slice(0, 20),
    owner: String(row.owner || '').slice(0, 120),
    propertyType: String(row.propertyType || '').slice(0, 60),
    leadTypes: Array.isArray(row.playIds) ? row.playIds.map(function (id) { return String(id).slice(0, 40); }).slice(0, 8) : [],
  };
}

function softTone(leads) {
  return (leads || []).some(function (lead) {
    return (lead.leadTypes || lead.playIds || []).some(function (id) { return SOFT_PLAYS[id]; });
  });
}

function brandBlock(brand, sender) {
  const row = brand || {};
  const from = sender || {};
  const addr = row.returnAddress || {};
  return {
    businessName: row.businessName || from.name || '',
    phone: row.phone || from.phone || '',
    website: row.website || '',
    email: row.email || '',
    signOff: row.signOff || '',
    tagline: row.tagline || '',
    disclosure: row.disclosure || catalog.DISCLOSURE_DEFAULT,
    returnAddress: [addr.line1, addr.line2, addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
  };
}

function userPrompt(input) {
  const leads = (input.leads || []).slice(0, MAX_LEADS_IN_PROMPT).map(publicLead);
  return JSON.stringify({
    goal: input.goal,
    propertyClass: input.propertyClass,
    channels: input.channels,
    brand: brandBlock(input.brand, input.sender),
    leads: leads,
    softTone: softTone(leads),
    angle: catalog.angleById(input.angle, input.propertyClass),
    note: 'Merge the brand and the first property into the copy. Do not invent other owners or addresses. Follow the message angle when one is present.',
  });
}

function parseModelJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); }
  catch (err) { return null; }
}

function sanitizePiece(piece) {
  if (!piece || !catalog.channelById(piece.channel)) return null;
  return {
    channel: piece.channel,
    variantA: catalog.filterVendorNames(piece.variantA).slice(0, 4000),
    variantB: catalog.filterVendorNames(piece.variantB).slice(0, 4000),
    source: 'aris',
  };
}

function allowedChannels(propertyClass, requested, empire) {
  if (propertyClass === 'commercial' && !empire) {
    const err = new Error('Commercial marketing is part of Empire.');
    err.statusCode = 403;
    throw err;
  }
  if (propertyClass !== 'residential' && propertyClass !== 'commercial') {
    const err = new Error('Assign this list as residential or commercial before ARIS writes.');
    err.statusCode = 400;
    throw err;
  }
  const allowed = {};
  catalog.channelsForClass(propertyClass).forEach(function (channel) {
    if (channel.copy !== false) allowed[channel.id] = channel;
  });
  const ids = [];
  (requested || []).forEach(function (id) {
    const key = String(id || '');
    if (!allowed[key] || ids.indexOf(key) !== -1) return;
    ids.push(key);
  });
  if (!ids.length) {
    const err = new Error('Pick at least one marketing type that ARIS can write.');
    err.statusCode = 400;
    throw err;
  }
  if (ids.length > MAX_CHANNELS) {
    const err = new Error('Pick up to 8 marketing types at a time.');
    err.statusCode = 400;
    throw err;
  }
  return ids;
}

function needsAttestation(channels) {
  return (channels || []).some(function (id) {
    const channel = catalog.channelById(id);
    return channel && channel.attest;
  });
}

function needsMailIdentity(channels) {
  return (channels || []).some(function (id) {
    const channel = catalog.channelById(id);
    return channel && channel.medium === 'mail';
  });
}

function needsNamePhone(channels) {
  return (channels || []).some(function (id) {
    const channel = catalog.channelById(id);
    return channel && channel.medium === 'print';
  });
}

function exportText(pieces, channels) {
  const lines = [
    catalog.STUDENT_NOTICE,
    '',
    catalog.COMPLIANCE_REMINDER,
    '',
    'FORGE does not send this copy. Nothing was mailed and nothing was charged.',
    '',
  ];
  (pieces || []).forEach(function (piece) {
    if (channels.indexOf(piece.channel) === -1) return;
    const channel = catalog.channelById(piece.channel);
    lines.push('--- ' + (channel ? channel.name : piece.channel) + ' ---');
    if (channel && channel.id === 'text') lines.push('Opt-in only. Do not send this as a cold text.');
    if (channel && channel.id === 'email') lines.push('Send this from your own platform. Keep your postal address and the unsubscribe line.');
    if (channel && channel.attest) lines.push(catalog.INFO_ONLY_LABEL);
    lines.push('Variant A');
    lines.push(piece.variantA || '');
    lines.push('');
    lines.push('Variant B');
    lines.push(piece.variantB || '');
    lines.push('');
  });
  return catalog.filterVendorNames(lines.join('\n'));
}

function attestKey(memberId) {
  return 'attestations/' + memberKey(memberId) + '.json';
}

function usageKey(memberId) {
  return 'copy-usage/' + memberKey(memberId) + '.json';
}

async function assertUsage(store, memberId) {
  const day = new Date().toISOString().slice(0, 10);
  const usage = await readJson(store, usageKey(memberId)) || { day: day, count: 0 };
  if (usage.day !== day) return { day: day, count: 0 };
  if (usage.count >= 40) {
    const err = new Error('ARIS has written a lot of copy today. Try again tomorrow.');
    err.statusCode = 429;
    throw err;
  }
  return usage;
}

async function commitUsage(store, memberId, usage) {
  usage.count += 1;
  await store.setJSON(usageKey(memberId), usage);
}

function createHandler(deps) {
  const options = deps || {};
  const env = options.env || process.env;

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    const gate = await loadMarketingGate(event, {
      requireMembership: options.requireMembership,
      getMember: options.getMember,
      env: env,
      context: options.context,
    });
    if (gate.response) return gate.response;
    if (!gate.flag.allowed) return json(403, { error: 'Marketing is not available on this account yet.' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }

    let store;
    try { store = options.getStore ? options.getStore() : openBlobStore(event); }
    catch (err) { return json(503, { error: 'Marketing storage is not available.' }); }

    try {
      if (body.action === 'export') return await exportCopy(store, gate, body);
      if (body.action === 'attest') return await recordAttestation(store, gate, body);
      return await generateCopy(store, gate, body, options.fetch || fetch, env);
    } catch (err) {
      const status = err && err.statusCode ? err.statusCode : 500;
      if (status >= 500) console.error('marketing-copy failed:', err);
      return json(status, { error: status >= 500 ? 'ARIS could not write that copy.' : err.message });
    }
  };
}

async function loadBrand(store, memberId, brandId) {
  if (!brandId) return null;
  const doc = await readJson(store, 'brands/' + memberKey(memberId) + '.json');
  const brands = doc && Array.isArray(doc.brands) ? doc.brands : [];
  return brands.find(function (row) { return row.id === brandId; }) || null;
}

async function generateCopy(store, gate, body, fetchImpl, env) {
  const propertyClass = body.propertyClass === 'commercial' ? 'commercial' : body.propertyClass;
  const channels = allowedChannels(propertyClass, body.channels, gate.flag.empire);
  const goal = ['sellers', 'followup', 'buyers'].indexOf(body.goal) === -1 ? 'sellers' : body.goal;
  const brand = await loadBrand(store, gate.access.memberId, body.brandId);
  const leads = Array.isArray(body.leads) ? body.leads.map(publicLead) : [];
  const sender = {
    name: String(body.sender && body.sender.name || '').slice(0, 120),
    phone: String(body.sender && body.sender.phone || '').slice(0, 40),
  };
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ARIS copy is not configured.');
    err.statusCode = 503;
    throw err;
  }
  const usage = await assertUsage(store, gate.access.memberId);

  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(propertyClass, body.angle),
    messages: [{ role: 'user', content: userPrompt({ goal: goal, propertyClass: propertyClass, channels: channels, brand: brand, sender: sender, leads: leads, angle: body.angle }) }],
  };
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  const text = data && data.content && data.content[0] && data.content[0].text;
  const parsed = parseModelJson(text);
  const copies = [];
  const returned = parsed && Array.isArray(parsed.copies) ? parsed.copies : [];
  channels.forEach(function (id) {
    const match = returned.find(function (piece) { return piece && piece.channel === id; });
    const clean = match ? sanitizePiece(Object.assign({}, match, { channel: id })) : null;
    if (clean && clean.variantA) copies.push(clean);
    else {
      const starter = catalog.starterPiece(id, {
        propertyClass: propertyClass,
        brand: brand,
        sender: sender,
        leads: leads,
        angle: body.angle,
        softTone: softTone(leads),
      });
      if (starter) copies.push(starter);
    }
  });
  const recommendation = catalog.filterVendorNames(
    (parsed && parsed.recommendation) || catalog.recommendationText(propertyClass)
  );
  await commitUsage(store, gate.access.memberId, usage);
  return json(200, {
    source: parsed ? 'aris' : 'template',
    propertyClass: propertyClass,
    recommendation: recommendation,
    copies: copies,
    reminder: catalog.COMPLIANCE_REMINDER,
    studentNotice: catalog.STUDENT_NOTICE,
  });
}

async function recordAttestation(store, gate, body) {
  const channels = Array.isArray(body.channels) ? body.channels.map(function (id) { return String(id); }) : [];
  if (!needsAttestation(channels)) return json(200, { recorded: false });
  if (body.accepted !== true) {
    const err = new Error('Export stays off until you confirm the calling and texting statement.');
    err.statusCode = 400;
    throw err;
  }
  const log = await readJson(store, attestKey(gate.access.memberId)) || [];
  const row = {
    memberId: gate.access.memberId,
    channels: channels,
    wordingVersion: catalog.ATTESTATION_VERSION,
    text: catalog.ATTESTATION_TEXT,
    at: new Date().toISOString(),
  };
  log.push(row);
  await store.setJSON(attestKey(gate.access.memberId), log);
  return json(200, { recorded: true, at: row.at });
}

async function exportCopy(store, gate, body) {
  const propertyClass = body.propertyClass === 'commercial' ? 'commercial' : 'residential';
  const channels = allowedChannels(propertyClass, body.channels, gate.flag.empire);
  const pieces = [];
  (body.pieces || []).forEach(function (piece) {
    const clean = sanitizePiece(piece);
    if (clean && channels.indexOf(clean.channel) !== -1) pieces.push(clean);
  });
  if (pieces.length !== channels.length) {
    const err = new Error('Every selected type needs both variants before it can be exported.');
    err.statusCode = 400;
    throw err;
  }
  const unapproved = (body.pieces || []).filter(function (piece) {
    return channels.indexOf(piece.channel) !== -1 && piece.approved !== true;
  });
  if (unapproved.length) {
    const err = new Error('Approve each piece before you export it.');
    err.statusCode = 400;
    throw err;
  }
  const brand = await loadBrand(store, gate.access.memberId, body.brandId);
  if (needsMailIdentity(channels)) {
    const mail = mailReadiness(brand);
    if (!mail.ready) {
      const err = new Error('Add your name, return address, and phone to the Brand Kit before you export mail copy. Missing: ' + mail.missing.join(', ') + '.');
      err.statusCode = 400;
      throw err;
    }
  }
  if (needsNamePhone(channels)) {
    const name = brand && String(brand.businessName || '').trim();
    const phone = brand && String(brand.phone || '').replace(/\D/g, '');
    if (!name || phone.length < 7) {
      const err = new Error('Add your business name and phone to the Brand Kit before you export print copy.');
      err.statusCode = 400;
      throw err;
    }
  }
  if (needsAttestation(channels)) {
    if (body.accepted !== true) {
      const err = new Error('Export stays off until you confirm the calling and texting statement.');
      err.statusCode = 400;
      throw err;
    }
    await recordAttestation(store, gate, { channels: channels, accepted: true });
  }
  const text = exportText(pieces, channels);
  return json(200, {
    filename: 'forge-marketing-copy.txt',
    text: text,
    reminder: catalog.COMPLIANCE_REMINDER,
    studentNotice: catalog.STUDENT_NOTICE,
  });
}

exports.createHandler = createHandler;
exports.systemPrompt = systemPrompt;
exports.userPrompt = userPrompt;
exports.parseModelJson = parseModelJson;
exports.exportText = exportText;
exports.allowedChannels = allowedChannels;
exports.MODEL = MODEL;
exports.MAX_TOKENS = MAX_TOKENS;

let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({});
  return prod(event, context);
};
