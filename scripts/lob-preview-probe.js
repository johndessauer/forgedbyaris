#!/usr/bin/env node
// Runs once on a deploy preview, where LOB_API_KEY is available and is not
// in this repo. Prints Lob test ids only. Never prints the key. Also writes
// those lines into the published preview so the ids can be read back.
const fs = require('fs');
const path = require('path');
const lob = require('../netlify/functions/_Lib/marketing-lob');
const lines = [];

function redact(text) {
  const key = String(process.env.LOB_API_KEY || '');
  const raw = String(text || '');
  return key ? raw.split(key).join('[redacted]') : raw;
}

async function attempt(label, brand, lead) {
  try {
    const result = await lob.sendPieces({
      env: process.env,
      fetch: fetch,
      brand: brand,
      leads: [lead],
      pieces: [
        { channel: 'postcard', variantA: 'FORGE test postcard. Nothing is really printed.' },
        { channel: 'letter', variantA: 'FORGE test letter. Nothing is really printed.' },
      ],
    });
    say('lob-preview-probe ' + label + ' ids=' + result.ids.join(','));
    return true;
  } catch (err) {
    say('lob-preview-probe ' + label + ' failed ' + redact(err && (err.detail || err.message)));
    return false;
  }
}

async function main() {
  if (process.env.CONTEXT !== 'deploy-preview') {
    say('lob-preview-probe skipped context=' + (process.env.CONTEXT || 'unset'));
    return;
  }
  if (typeof fetch !== 'function') {
    say('lob-preview-probe skipped no-fetch');
    return;
  }
  const key = String(process.env.LOB_API_KEY || '');
  say('lob-preview-probe key-present=' + (key ? 'yes' : 'no') + ' test-prefix=' + (key.startsWith('test_') ? 'yes' : 'no'));
  if (!key.startsWith('test_')) return;

  const sampleBrand = {
    businessName: 'FORGE Test',
    phone: '555-0100',
    returnAddress: { line1: '123 Sample Street', city: 'Sampletown', state: 'ST', zip: '00000' },
    colors: { primary: '#1F3348', accent: '#C89B3C' },
    disclosure: 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.',
  };
  const sampleLead = { owner: 'Pat Example', address: '123 Sample Street', city: 'Sampletown', state: 'ST', zip: '00000' };
  if (await attempt('sample', sampleBrand, sampleLead)) return;

  const deliverableBrand = {
    businessName: 'FORGE Test',
    phone: '415-555-0100',
    returnAddress: { line1: '185 Berry St Ste 6100', city: 'San Francisco', state: 'CA', zip: '94107' },
    colors: { primary: '#1F3348', accent: '#C89B3C' },
    disclosure: 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.',
  };
  const deliverableLead = { owner: 'Pat Example', address: '210 King St', city: 'San Francisco', state: 'CA', zip: '94107' };
  await attempt('deliverable', deliverableBrand, deliverableLead);
}

function say(line) {
  console.log(line);
  lines.push(line);
}

function writeResult() {
  const out = path.join(__dirname, '..', 'public');
  if (!fs.existsSync(out)) return;
  fs.writeFileSync(path.join(out, 'lob-probe-result.txt'), lines.join('\n') + '\n');
}

main().catch(function (err) {
  say('lob-preview-probe failed ' + redact(err && err.message));
}).then(writeResult);
