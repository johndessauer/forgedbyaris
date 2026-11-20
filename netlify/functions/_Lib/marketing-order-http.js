// Test-mode orders. Mail is one piece per property and goes to the test
// mail service. Printed goods are a separate bulk "ship to me" order.
// TODO: no print vendor is integrated. confirm-print records the order and
// debits test credits. It must not call a print API.
const { json, preflight } = require('./http');
const { loadMarketingGate } = require('./marketing-access');
const { openBlobStore, readJson, memberKey } = require('./marketing-store');
const { mailReadiness } = require('../marketing-brand');
const pricing = require('./marketing-pricing');
const wallet = require('./marketing-wallet');
const lob = require('./marketing-lob');
const thanks = require('./marketing-thanks');

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
    if (row && (row.status === 'sent' || row.status === 'recorded')) rows.push(row);
  }
  return rows;
}

function csv(orders) {
  const header = 'member,date,pieces,lob_cost,price_charged,markup,kind,vendor_cost,markup_rate,vendor';
  const lines = orders.map(function (order) {
    const kind = order.kind || 'mail';
    const pieces = (order.pieces || []).map(function (piece) {
      const option = piece.option ? ' ' + piece.option : '';
      return (piece.channelId || piece.channel) + ' x' + piece.quantity + option;
    }).join('; ');
    const rate = kind === 'print' && order.printMarkupRate != null
      ? Number(order.printMarkupRate).toFixed(2)
      : (kind === 'mail' ? '0.20' : '');
    return [
      order.memberEmail || order.memberId,
      order.at,
      '"' + pieces.replace(/"/g, '""') + '"',
      dollars(kind === 'print' ? 0 : order.vendorCostCents),
      dollars(order.chargedCents),
      dollars(order.markupCents),
      kind,
      dollars(order.vendorCostCents),
      rate,
      order.provider || (kind === 'print' ? pricing.PRINT_VENDOR : pricing.MAIL_PROVIDER),
    ].join(',');
  });
  return [header].concat(lines).join('\n');
}

function cleanShip(src) {
  const row = src || {};
  const line1 = String(row.line1 || '').trim().slice(0, 120);
  const line2 = String(row.line2 || '').trim().slice(0, 120);
  const city = String(row.city || '').trim().slice(0, 80);
  const state = String(row.state || '').trim().toUpperCase().slice(0, 2);
  const zip = String(row.zip || '').trim().slice(0, 10);
  if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(-\d{4})?$/.test(zip)) return null;
  return { line1: line1, line2: line2, city: city, state: state, zip: zip };
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

    const rawLeads = Array.isArray(body.leads) ? body.leads : [];
    const leads = rawLeads.filter(lob.mailable);
    const channels = Array.isArray(body.channels) ? body.channels : [];
    const quote = pricing.quoteOrder(channels, leads.length, env, body.prints, body.styles);
    const balance = await wallet.readWallet(store, gate.access.memberId);

    if (body.action === 'quote') {
      return json(200, {
        lines: quote.lines.map(function (row) {
          return {
            channelId: row.channelId,
            kind: row.kind,
            mailed: row.mailed,
            quantity: row.quantity,
            option: row.option || '',
            styleId: row.styleId || '',
            styleLabel: row.styleLabel || '',
            orderable: !!row.orderable,
            comingSoon: !!row.comingSoon,
            unitStudentPriceCents: row.unitStudentPriceCents,
            studentPriceCents: row.studentPriceCents,
          };
        }),
        leadCount: quote.leadCount,
        selectedLeadCount: rawLeads.length,
        mailableLeadCount: leads.length,
        chargedCents: quote.chargedCents,
        mailChargedCents: quote.mailChargedCents,
        printChargedCents: quote.printChargedCents,
        printMarkupRate: quote.printMarkupRate,
        balanceCents: balance.balanceCents,
        shortfallCents: Math.max(0, quote.chargedCents - balance.balanceCents),
        testMode: quote.testMode,
        topUpsCents: pricing.TOP_UPS_CENTS,
      });
    }
    if (body.action === 'confirm-print') {
      // Property count is ignored on purpose. Quantity comes only from packs.
      const printQuote = pricing.quoteOrder([], 0, env, body.prints);
      if (printQuote.printChargedCents <= 0) {
        return json(400, { error: 'Choose a pack size before you ship printed goods.' });
      }
      const brandDoc = await readJson(store, 'brands/' + memberKey(gate.access.memberId) + '.json');
      const brands = brandDoc && Array.isArray(brandDoc.brands) ? brandDoc.brands : [];
      const brand = brands.find(function (row) { return row.id === body.brandId; }) || null;
      const shipTo = cleanShip(body.shipTo) || cleanShip(brand && brand.returnAddress);
      if (!shipTo) return json(400, { error: 'Add the address where printed goods should ship.' });
      const idem = idempotencyKey(gate.access.memberId, body.idempotencyKey ? 'print-' + body.idempotencyKey : '');
      if (idem) {
        const prior = await readJson(store, idem);
        if (prior && prior.status === 'recorded') {
          const again = await wallet.readWallet(store, gate.access.memberId);
          return json(200, {
            orderId: prior.orderId,
            testMode: true,
            kind: 'print',
            vendorStatus: 'stub',
            chargedCents: prior.chargedCents,
            balanceCents: again.balanceCents,
            duplicate: true,
          });
        }
        if (prior && prior.status === 'pending') {
          return json(409, { error: 'This print order is already in progress.' });
        }
      }
      const balanceNow = await wallet.readWallet(store, gate.access.memberId);
      if (balanceNow.balanceCents < printQuote.printChargedCents) {
        return json(402, {
          error: 'Add credits before this test print order.',
          balanceCents: balanceNow.balanceCents,
          shortfallCents: printQuote.printChargedCents - balanceNow.balanceCents,
          chargedCents: printQuote.printChargedCents,
          topUpsCents: pricing.TOP_UPS_CENTS,
        });
      }
      const id = orderId();
      if (idem) await store.setJSON(idem, { status: 'pending', orderId: id });
      const debit = await wallet.debit(store, {
        memberId: gate.access.memberId,
        amountCents: printQuote.printChargedCents,
        orderId: id,
        note: 'Test print order',
      });
      if (!debit.debited) {
        if (idem) await store.delete(idem);
        return json(402, {
          error: 'Add credits before this test print order.',
          balanceCents: debit.balanceCents,
          shortfallCents: debit.shortfallCents,
          topUpsCents: pricing.TOP_UPS_CENTS,
        });
      }
      const order = {
        id: id,
        memberId: gate.access.memberId,
        memberEmail: gate.email || '',
        at: new Date().toISOString(),
        status: 'recorded',
        kind: 'print',
        testMode: true,
        // TODO: replace vendorStatus stub when a print vendor API exists.
        // Nothing in this handler may call that API in test mode.
        vendorStatus: 'stub',
        provider: pricing.PRINT_VENDOR,
        printMarkupRate: printQuote.printMarkupRate,
        pieces: printQuote.lines.filter(function (row) { return row.kind === 'print' && row.quantity > 0; }).map(function (row) {
          return {
            channelId: row.channelId,
            quantity: row.quantity,
            option: row.option,
            vendorCostCents: row.vendorCostCents,
            markupRate: row.markupRate,
            markupCents: row.markupCents,
            studentPriceCents: row.studentPriceCents,
          };
        }),
        vendorCostCents: printQuote.lines.filter(function (row) { return row.kind === 'print'; }).reduce(function (sum, row) { return sum + row.vendorCostCents; }, 0),
        chargedCents: printQuote.printChargedCents,
        markupCents: printQuote.lines.filter(function (row) { return row.kind === 'print'; }).reduce(function (sum, row) { return sum + row.markupCents; }, 0),
        shipTo: shipTo,
        leadCount: 0,
      };
      try {
        await saveOrder(store, order);
      } catch (err) {
        await wallet.credit(store, {
          memberId: gate.access.memberId,
          amountCents: printQuote.printChargedCents,
          orderId: id,
          note: 'Test print order returned',
        });
        if (idem) await store.delete(idem);
        return json(502, { error: 'The test print order was not recorded. The credits were returned.' });
      }
      if (idem) {
        await store.setJSON(idem, {
          status: 'recorded',
          orderId: id,
          chargedCents: printQuote.printChargedCents,
        });
      }
      return json(200, {
        orderId: id,
        testMode: true,
        kind: 'print',
        vendorStatus: 'stub',
        chargedCents: printQuote.printChargedCents,
        balanceCents: debit.balanceCents,
      });
    }
    if (body.action !== 'confirm') return json(400, { error: 'Unknown order action.' });

    const noteWanted = (body.pieces || []).some(function (piece) {
      return piece && piece.approved === true && piece.channel === 'handwritten';
    }) && (channels.indexOf('handwritten') !== -1);
    if (noteWanted && !pricing.handwrittenReady(env)) {
      return json(400, { error: thanks.COMING_SOON });
    }
    const mailQuote = pricing.quoteOrder(channels, leads.length, env, null, body.styles);
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
    if (mailQuote.chargedCents <= 0) return json(400, { error: 'There is nothing to mail.' });

    try { lob.assertMailKey(env); }
    catch (err) { return json(err.statusCode || 403, { error: err.message }); }

    if (balance.balanceCents < mailQuote.chargedCents) {
      return json(402, {
        error: 'Add credits before this test mailing.',
        balanceCents: balance.balanceCents,
        shortfallCents: mailQuote.chargedCents - balance.balanceCents,
        chargedCents: mailQuote.chargedCents,
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
      amountCents: mailQuote.chargedCents,
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
        styles: body.styles || {},
      });
    } catch (err) {
      await wallet.credit(store, {
        memberId: gate.access.memberId,
        amountCents: mailQuote.chargedCents,
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
      kind: 'mail',
      testMode: sent.testMode,
      provider: pricing.MAIL_PROVIDER,
      pieces: mailQuote.lines.filter(function (row) { return row.mailed; }).map(pricing.publicQuote),
      vendorCostCents: mailQuote.vendorCostCents,
      chargedCents: mailQuote.chargedCents,
      markupCents: mailQuote.markupCents,
      mailIds: sent.ids,
      leadCount: sent.leadCount,
    };
    await saveOrder(store, order);
    if (idem) {
      await store.setJSON(idem, {
        status: 'sent',
        orderId: id,
        testMode: sent.testMode,
        chargedCents: mailQuote.chargedCents,
        mailed: sent.ids.length,
      });
    }
    return json(200, {
      orderId: id,
      testMode: sent.testMode,
      chargedCents: mailQuote.chargedCents,
      balanceCents: debit.balanceCents,
      mailed: sent.ids.length,
    });
  };
}

exports.createHandler = createHandler;
exports.csv = csv;
