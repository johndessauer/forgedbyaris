// Prepaid Marketing credits. Amounts are integer cents.
// A Stripe session id is credited once. A debit that does not fit is refused
// and does not change the balance.
const { memberKey, readJson } = require('./marketing-store');

function walletKey(memberId) {
  return 'wallet/' + memberKey(memberId) + '.json';
}

function ledgerKey(memberId) {
  return 'ledger/' + memberKey(memberId) + '.json';
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function readWallet(store, memberId) {
  const row = await readJson(store, walletKey(memberId));
  const balance = row && Number(row.balanceCents);
  return {
    memberId: memberId,
    balanceCents: Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0,
    updatedAt: row && row.updatedAt || null,
  };
}

async function readLedger(store, memberId) {
  const rows = await readJson(store, ledgerKey(memberId));
  return Array.isArray(rows) ? rows : [];
}

async function writeBoth(store, memberId, balanceCents, ledger) {
  const now = new Date().toISOString();
  await store.setJSON(walletKey(memberId), { balanceCents: balanceCents, updatedAt: now });
  await store.setJSON(ledgerKey(memberId), ledger);
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
  const ledger = await readLedger(store, memberId);
  const sessionId = input.stripeSessionId ? String(input.stripeSessionId) : '';
  if (sessionId && ledger.some(function (row) { return row.stripeSessionId === sessionId; })) {
    const wallet = await readWallet(store, memberId);
    return { credited: false, duplicate: true, balanceCents: wallet.balanceCents };
  }
  const wallet = await readWallet(store, memberId);
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
  await writeBoth(store, memberId, next, ledger);
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
  const wallet = await readWallet(store, memberId);
  if (wallet.balanceCents < amount) {
    return {
      debited: false,
      balanceCents: wallet.balanceCents,
      shortfallCents: amount - wallet.balanceCents,
    };
  }
  const ledger = await readLedger(store, memberId);
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
  await writeBoth(store, memberId, next, ledger);
  return { debited: true, balanceCents: next, entry: entry };
}

module.exports = {
  readWallet: readWallet,
  readLedger: readLedger,
  credit: credit,
  debit: debit,
};
