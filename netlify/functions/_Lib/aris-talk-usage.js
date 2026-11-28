// Reads Talk Mode seconds and the current month's extra-minute pack.
// education_level_awards is the only Mogul row in this repo. A missing
// awards table means "not Mogul", not a failure of Talk Mode.
// Pack credits use credit_aris_talk_pack from add-aris-talk-packs.sql.

const { PACK_SECONDS, PACK_AMOUNT_CENTS } = require('../../../assets/js/aris-talk');

let missingAwardsLogged = false;

function missingPackColumn(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || error.details || '');
  if (code === '42703' && /pack_seconds/i.test(message)) return true;
  return /pack_seconds/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

function missingAwardsTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || error.details || '');
  // This query only touches education_level_awards, so a missing-table
  // code means that badge table is not there yet. Talk Mode then treats
  // the member as not Mogul instead of hiding the control.
  if (code === '42P01' || code === 'PGRST205') return true;
  return /education_level_awards/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

function missingCreditRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || error.details || '');
  if (code === 'PGRST202' || code === '42883') return true;
  return /credit_aris_talk_pack/i.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

function usageFromRow(data, packSupported) {
  const listen = data ? Number(data.listen_seconds) || 0 : 0;
  const speak = data ? Number(data.speak_seconds) || 0 : 0;
  const pack = packSupported && data ? Number(data.pack_seconds) || 0 : 0;
  return {
    listenSeconds: listen,
    speakSeconds: speak,
    usedSeconds: listen + speak,
    packSeconds: pack,
    packSupported: packSupported,
  };
}

async function readUsage(supabase, memberId, monthKey) {
  const first = await supabase
    .from('aris_talk_usage')
    .select('listen_seconds, speak_seconds, pack_seconds')
    .eq('memberstack_id', memberId)
    .eq('month_key', monthKey)
    .maybeSingle();
  if (first.error && missingPackColumn(first.error)) {
    const second = await supabase
      .from('aris_talk_usage')
      .select('listen_seconds, speak_seconds')
      .eq('memberstack_id', memberId)
      .eq('month_key', monthKey)
      .maybeSingle();
    if (second.error) throw second.error;
    return usageFromRow(second.data, false);
  }
  if (first.error) throw first.error;
  return usageFromRow(first.data, true);
}

async function mogulAward(supabase, memberId) {
  const { data, error } = await supabase
    .from('education_level_awards')
    .select('level')
    .eq('memberstack_id', memberId)
    .eq('level', 'mogul')
    .maybeSingle();
  if (error) {
    if (missingAwardsTable(error)) {
      if (!missingAwardsLogged) {
        missingAwardsLogged = true;
        console.error('education_level_awards is missing; Talk Mode will not treat anyone as Mogul until that table exists');
      }
      return false;
    }
    throw error;
  }
  return !!(data && data.level === 'mogul');
}

function unwrapRpc(data) {
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
}

async function creditPack(supabase, input) {
  const request = input || {};
  if (request.seconds !== PACK_SECONDS || request.amountCents !== PACK_AMOUNT_CENTS) {
    return { ok: false, error: 'bad pack' };
  }
  const { data, error } = await supabase.rpc('credit_aris_talk_pack', {
    p_member: request.memberId,
    p_month: request.monthKey,
    p_seconds: request.seconds,
    p_session: request.stripeSessionId,
    p_amount: request.amountCents,
  });
  if (error) {
    if (missingCreditRpc(error)) {
      const err = new Error('Extra minutes are not ready yet.');
      err.code = 'missing';
      throw err;
    }
    throw error;
  }
  const row = unwrapRpc(data);
  if (row.ok === false) return { ok: false, error: row.error || 'bad pack' };
  return {
    ok: true,
    credited: !!row.credited,
    duplicate: !!row.duplicate,
    packSeconds: Number(row.packSeconds) || 0,
  };
}

module.exports = {
  missingPackColumn,
  missingAwardsTable,
  missingCreditRpc,
  readUsage,
  mogulAward,
  creditPack,
};
