// Test-mode mail order. Quotes from the price config, debits the wallet,
// then hands postcards and letters to the mail service. Printed goods are
// shown and not charged. Email and text are never sent.
const { json, preflight } = require('./_Lib/http');
const { loadMarketingGate } = require('./_Lib/marketing-access');
const { openBlobStore, readJson, memberKey } = require('./_Lib/marketing-store');
const { mailReadiness } = require('./marketing-brand');
const pricing = require('./_Lib/marketing-pricing');
const wallet = require('./_Lib/marketing-wallet');
const lob = require('./_Lib/marketing-lob');

function orderId() {
  return 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function idempotencyKey(memberId, raw) {
  const clean = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!clean) return '';
  return 'orders/idem/' + memberKey(memberId) + '/' + clean + '.json';
}

function approvedMail(body) {
  const wanted = {};
  (body.channels || []).forEach(function (id) { wanted[String(id)] = true; });
  return (body.pieces || []).filter(function (piece) {
    return piece && piece.approved === true && wanted[piece.channel] && !!pricing.mailFormat(piece.channel);
  }).map(function (piece) {
    return { channel: piece.channel, variantA: String(piece.variantA || '').slice(0, 4000) };
  });
}

function dollars(cents) {
  return (Math.round(Number(cents) || 0) / 100).toFixed(2);
}

async function saveOrder(store, order) {
  await store.setJSON('orders/' + order.id + '.json', order);
  const index = (await readJson(store, 'orders/index.json')) || [];
  index.push(order.id);
  await store.setJSON('orders/index.json', index);
}

async function listOrders(store) {
  const index = (await readJson(store, 'orders/index.json')) || [];
  const rows = [];
  for (const id of index) {
    const row = await readJson(store, 'orders/' + id + '.json');
    if (row && row.status === 'sent') rows.push(row);
  }
  return rows;
}

function csv(orders) {
  const header = 'member,date,pieces,lob_cost,price_charged,markup';
  const lines = orders.map(function (order) {
    const pieces = (order.pieces || []).map(function (piece) {
      return (piece.channelId || piece.channel) + ' x' + piece.quantity;
    }).join('; ');
    return [
      order.memberEmail || order.memberId,
      order.at,
      '"' + pieces.replace(/"/g, '""') + '"',
      dollars(order.vendorCostCents),
      dollars(order.chargedCents),
      dollars(order.markupCents),
    ].join(',');
  });
  return [header].concat(lines).join('\n');
}

function createHandler(deps) {
  const options = deps || {};
  const env = options.env || process.env;
  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return preflight();
    const gate = await loadMarketingGate(event, {
      requireMembership: options.requireMembership,
      getMember: options.getMember,
      env: env,
    });
    if (gate.response) return gate.response;
    if (!gate.flag.allowed) return json(403, { error: 'Marketing is not available on this account yet.' });

    let store;
    try { store = options.getStore ? options.getStore() : openBlobStore(event); }
    catch (err) { return json(503, { error: 'Marketing credits are not available.' }); }

    if (event.httpMethod === 'GET') {
      if (!gate.flag.reviewer) return json(403, { error: 'Only an allowlisted admin can read the markup report.' });
      const orders = await listOrders(store);
      const format = (event.queryStringParameters || {}).format;
      if (format === 'csv') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'private, no-store' },
          body: csv(orders),
        };
      }
      return json(200, { orders: orders });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (err) { return json(400, { error: 'Invalid JSON body' }); }

    const leads = Array.isArray(body.leads) ? body.leads.filter(lob.mailable) : [];
    const channels = Array.isArray(body.channels) ? body.channels : [];
    const quote = pricing.quoteOrder(channels, leads.length, env);
    const balance = await wallet.readWallet(store, gate.access.memberId);

    if (body.action === 'quote') {
      return json(200, {
        lines: quote.lines.map(function (row) {
          return {
            channelId: row.channelId,
            mailed: row.mailed,
            quantity: row.quantity,
            unitStudentPriceCents: row.unitStudentPriceCents,
            studentPriceCents: row.studentPriceCents,
          };
        }),
        leadCount: quote.leadCount,
        chargedCents: quote.chargedCents,
        balanceCents: balance.balanceCents,
        shortfallCents: Math.max(0, quote.chargedCents - balance.balanceCents),
        testMode: quote.testMode,
        topUpsCents: pricing.TOP_UPS_CENTS,
      });
    }
    if (body.action !== 'confirm') return json(400, { error: 'Unknown order action.' });

    const brandDoc = await readJson(store, 'brands/' + memberKey(gate.access.memberId) + '.json');
    const brands = brandDoc && Array.isArray(brandDoc.brands) ? brandDoc.brands : [];
    const brand = brands.find(function (row) { return row.id === body.brandId; }) || null;
    const ready = mailReadiness(brand);
    if (!ready.ready) {
      return json(400, { error: 'Add your name, return address, and phone to the Brand Kit before mail. Missing: ' + ready.missing.join(', ') + '.' });
    }
    const pieces = approvedMail(body);
    if (!pieces.length) return json(400, { error: 'Approve a postcard or a letter before you confirm.' });
    if (!leads.length) return json(400, { error: 'Add a street, city, state, and ZIP for each property you want mailed.' });
    if (quote.chargedCents <= 0) return json(400, { error: 'There is nothing to mail.' });

    try { lob.assertMailKey(env); }
    catch (err) { return json(err.statusCode || 403, { error: err.message }); }

    if (balance.balanceCents < quote.chargedCents) {
      return json(402, {
        error: 'Add credits before this test mailing.',
        balanceCents: balance.balanceCents,
        shortfallCents: quote.chargedCents - balance.balanceCents,
        chargedCents: quote.chargedCents,
        topUpsCents: pricing.TOP_UPS_CENTS,
      });
    }

    const idem = idempotencyKey(gate.access.memberId, body.idempotencyKey);
    if (idem) {
      const prior = await readJson(store, idem);
      if (prior && prior.status === 'sent') {
        const again = await wallet.readWallet(store, gate.access.memberId);
        return json(200, {
          orderId: prior.orderId,
          testMode: prior.testMode,
          chargedCents: prior.chargedCents,
          balanceCents: again.balanceCents,
          mailed: prior.mailed,
          duplicate: true,
        });
      }
      if (prior && prior.status === 'pending') {
        return json(409, { error: 'This confirmation is already in progress.' });
      }
    }

    const id = orderId();
    if (idem) await store.setJSON(idem, { status: 'pending', orderId: id });
    const debit = await wallet.debit(store, {
      memberId: gate.access.memberId,
      amountCents: quote.chargedCents,
      orderId: id,
      note: 'Test mail',
    });
    if (!debit.debited) {
      if (idem) await store.delete(idem);
      return json(402, {
        error: 'Add credits before this test mailing.',
        balanceCents: debit.balanceCents,
        shortfallCents: debit.shortfallCents,
        topUpsCents: pricing.TOP_UPS_CENTS,
      });
    }

    let sent;
    try {
      sent = await lob.sendPieces({
        env: env,
        fetch: options.fetch,
        brand: brand,
        leads: leads,
        pieces: pieces,
      });
    } catch (err) {
      await wallet.credit(store, {
        memberId: gate.access.memberId,
        amountCents: quote.chargedCents,
        orderId: id,
        note: 'Test mail returned',
      });
      if (idem) await store.delete(idem);
      return json(err.statusCode || 502, { error: 'The test mailing was not accepted. The credits were returned.' });
    }

    const order = {
      id: id,
      memberId: gate.access.memberId,
      memberEmail: gate.email || '',
      at: new Date().toISOString(),
      status: 'sent',
      testMode: sent.testMode,
      pieces: quote.lines.filter(function (row) { return row.mailed; }).map(pricing.publicQuote),
      vendorCostCents: quote.vendorCostCents,
      chargedCents: quote.chargedCents,
      markupCents: quote.markupCents,
      mailIds: sent.ids,
      leadCount: sent.leadCount,
    };
    await saveOrder(store, order);
    if (idem) {
      await store.setJSON(idem, {
        status: 'sent',
        orderId: id,
        testMode: sent.testMode,
        chargedCents: quote.chargedCents,
        mailed: sent.ids.length,
      });
    }
    return json(200, {
      orderId: id,
      testMode: sent.testMode,
      chargedCents: quote.chargedCents,
      balanceCents: debit.balanceCents,
      mailed: sent.ids.length,
    });
  };
}

exports.createHandler = createHandler;
exports.csv = csv;
let prod = null;
exports.handler = function (event, context) {
  if (!prod) prod = createHandler({ fetch: function () { return fetch.apply(null, arguments); } });
  return prod(event, context);
};
