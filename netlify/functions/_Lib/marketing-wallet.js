// Prepaid Marketing credits. Amounts are integer cents.
// A Stripe session id is credited once. A debit that does not fit is refused
// and does not change the balance.
//
// Test credits stay at wallet/{member}.json. Live credits, used only when
// MARKETING_LIVE_MAIL is "true", stay at wallet/live/{member}.json. A test
// balance is never read while mail is live, and a live balance is never
// read while mail is in test.
const { memberKey, readJson } = require('./marketing-store');
const { readRuntimeEnv } = require('./runtime-env');

function walletMode(env) {
  return readRuntimeEnv(env, 'MARKETING_LIVE_MAIL') === 'true' ? 'live' : 'test';
}

function walletKey(memberId, mode) {
  const id = memberKey(memberId);
  return mode === 'live' ? 'wallet/live/' + id + '.json' : 'wallet/' + id + '.json';
}

function ledgerKey(memberId, mode) {
  const id = memberKey(memberId);
  return mode === 'live' ? 'ledger/live/' + id + '.json' : 'ledger/' + id + '.json';
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function readWallet(store, memberId, mode) {
  const row = await readJson(store, walletKey(memberId, mode));
  const balance = row && Number(row.balanceCents);
  return {
    memberId: memberId,
    balanceCents: Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0,
    updatedAt: row && row.updatedAt || null,
  };
}

async function readLedger(store, memberId, mode) {
  const rows = await readJson(store, ledgerKey(memberId, mode));
  return Array.isArray(rows) ? rows : [];
}

async function writeBoth(store, memberId, balanceCents, ledger, mode) {
  const now = new Date().toISOString();
  await store.setJSON(walletKey(memberId, mode), { balanceCents: balanceCents, updatedAt: now });
  await store.setJSON(ledgerKey(memberId, mode), ledger);
  return now;
}

async function credit(store, input) {
  const memberId = input.memberId;
  const amount = Math.floor(Number(input.amountCents) || 0);
  if (!memberId || amount <= 0) {
    const err = new Error('That top-up amount is not valid.');
    err.statusCode = 400;
    throw err;
  }
  const mode = input.mode === 'live' ? 'live' : 'test';
  const ledger = await readLedger(store, memberId, mode);
  const sessionId = input.stripeSessionId ? String(input.stripeSessionId) : '';
  if (sessionId && ledger.some(function (row) { return row.stripeSessionId === sessionId; })) {
    const wallet = await readWallet(store, memberId, mode);
    return { credited: false, duplicate: true, balanceCents: wallet.balanceCents };
  }
  const wallet = await readWallet(store, memberId, mode);
  const next = wallet.balanceCents + amount;
  const entry = {
    id: newId('led'),
    memberId: memberId,
    type: 'credit',
    amountCents: amount,
    balanceAfterCents: next,
    at: new Date().toISOString(),
    stripeSessionId: sessionId || null,
    orderId: input.orderId || null,
    note: String(input.note || 'Top-up').slice(0, 160),
  };
  ledger.push(entry);
  await writeBoth(store, memberId, next, ledger, mode);
  return { credited: true, duplicate: false, balanceCents: next, entry: entry };
}

async function debit(store, input) {
  const memberId = input.memberId;
  const amount = Math.floor(Number(input.amountCents) || 0);
  if (!memberId || amount < 0) {
    const err = new Error('That charge is not valid.');
    err.statusCode = 400;
    throw err;
  }
  const mode = input.mode === 'live' ? 'live' : 'test';
  const wallet = await readWallet(store, memberId, mode);
  if (wallet.balanceCents < amount) {
    return {
      debited: false,
      balanceCents: wallet.balanceCents,
      shortfallCents: amount - wallet.balanceCents,
    };
  }
  const ledger = await readLedger(store, memberId, mode);
  const next = wallet.balanceCents - amount;
  const entry = {
    id: newId('led'),
    memberId: memberId,
    type: 'debit',
    amountCents: amount,
    balanceAfterCents: next,
    at: new Date().toISOString(),
    stripeSessionId: null,
    orderId: input.orderId || null,
    note: String(input.note || 'Mail').slice(0, 160),
  };
  ledger.push(entry);
  await writeBoth(store, memberId, next, ledger, mode);
  return { debited: true, balanceCents: next, entry: entry };
}

module.exports = {
  walletMode: walletMode,
  readWallet: readWallet,
  readLedger: readLedger,
  credit: credit,
  debit: debit,
};
