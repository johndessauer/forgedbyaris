// Skip-trace credit ledger.
// Production uses the Supabase RPCs in sql/migrations/add-skip-trace.sql,
// which lock the wallet row. Tests use the in-memory store, which applies
// the same check-then-update without an await in between.

function createMemoryStore() {
  const wallets = new Map();
  const ledger = [];
  const cache = new Map();
  const usage = new Map();

  function wallet(id) {
    if (!wallets.has(id)) wallets.set(id, { balanceCents: 0, heldCents: 0 });
    return wallets.get(id);
  }

  return {
    async getWallet(memberId) {
      const row = wallet(memberId);
      return { balanceCents: row.balanceCents, heldCents: row.heldCents };
    },
    async credit(input) {
      const amount = Math.floor(Number(input.amountCents) || 0);
      const session = input.stripeSessionId ? String(input.stripeSessionId) : '';
      if (!input.memberId || amount <= 0) return { ok: false, error: 'invalid' };
      if (session && ledger.some(function (row) { return row.stripeSessionId === session; })) {
        return { ok: true, credited: false, duplicate: true, balanceCents: wallet(input.memberId).balanceCents };
      }
      const row = wallet(input.memberId);
      row.balanceCents += amount;
      ledger.push({
        entryType: 'credit',
        memberId: input.memberId,
        amountCents: amount,
        stripeSessionId: session || null,
        at: new Date().toISOString(),
      });
      return { ok: true, credited: true, duplicate: false, balanceCents: row.balanceCents };
    },
    async peekUsage(dayBucket, monthBucket) {
      return {
        daily: usage.get('member_day:' + dayBucket) || 0,
        monthly: usage.get('vendor_month:' + monthBucket) || 0,
      };
    },
    async beginLookup(input) {
      const row = wallet(input.memberId);
      const amount = Math.floor(Number(input.amountCents) || 0);
      if (row.balanceCents < amount) {
        return { ok: false, code: 'insufficient', balanceCents: row.balanceCents };
      }
      const dayKey = 'member_day:' + input.dayBucket;
      const monthKey = 'vendor_month:' + input.monthBucket;
      const daily = usage.get(dayKey) || 0;
      const monthly = usage.get(monthKey) || 0;
      if (daily >= input.dailyCap) return { ok: false, code: 'daily_cap', balanceCents: row.balanceCents };
      if (monthly >= input.monthlyCap) return { ok: false, code: 'monthly_cap', balanceCents: row.balanceCents };
      row.balanceCents -= amount;
      row.heldCents += amount;
      usage.set(dayKey, daily + 1);
      usage.set(monthKey, monthly + 1);
      const holdId = 'hold_' + ledger.length;
      ledger.push({
        id: holdId,
        entryType: 'hold',
        memberId: input.memberId,
        amountCents: amount,
        addressKey: input.addressKey,
        settled: false,
      });
      return { ok: true, holdId: holdId, balanceCents: row.balanceCents };
    },
    async finishLookup(input) {
      const hold = ledger.find(function (row) {
        return row.id === input.holdId && row.entryType === 'hold' && row.memberId === input.memberId;
      });
      if (!hold) return { ok: false, error: 'hold_missing' };
      const row = wallet(input.memberId);
      if (hold.settled) return { ok: true, duplicate: true, balanceCents: row.balanceCents };
      if (input.outcome === 'debit') {
        row.heldCents = Math.max(0, row.heldCents - hold.amountCents);
        ledger.push({ entryType: 'debit', memberId: input.memberId, amountCents: hold.amountCents, holdId: hold.id });
      } else {
        row.balanceCents += hold.amountCents;
        row.heldCents = Math.max(0, row.heldCents - hold.amountCents);
        const monthKey = 'vendor_month:' + input.monthBucket;
        usage.set(monthKey, Math.max(0, (usage.get(monthKey) || 0) - 1));
        if (input.releaseDaily) {
          const dayKey = 'member_day:' + input.dayBucket;
          usage.set(dayKey, Math.max(0, (usage.get(dayKey) || 0) - 1));
        }
        ledger.push({ entryType: 'release', memberId: input.memberId, amountCents: hold.amountCents, holdId: hold.id });
      }
      hold.settled = true;
      return { ok: true, balanceCents: row.balanceCents };
    },
    async getCache(memberId, addressKey) {
      const row = cache.get(memberId + '|' + addressKey);
      if (!row) return null;
      if (Date.parse(row.expires_at) <= Date.now()) return null;
      return row;
    },
    async putCache(row) {
      cache.set(row.memberstack_id + '|' + row.address_key, row);
      return row;
    },
    async listRecent(memberId, limit) {
      const rows = [];
      cache.forEach(function (row) {
        if (row.memberstack_id === memberId) rows.push(row);
      });
      rows.sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); });
      return rows.slice(0, limit || 8).map(function (row) {
        return {
          addressLabel: row.address_label,
          hit: !!row.hit,
          chargedCents: row.charged_cents || 0,
          createdAt: row.created_at,
        };
      });
    },
  };
}

function rpcData(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch (err) { return {}; }
  }
  return {};
}

function createSupabaseStore(supabase) {
  return {
    async getWallet(memberId) {
      const { data, error } = await supabase
        .from('skip_trace_wallets')
        .select('balance_cents, held_cents')
        .eq('memberstack_id', memberId)
        .maybeSingle();
      if (error) throw error;
      return {
        balanceCents: data && data.balance_cents ? data.balance_cents : 0,
        heldCents: data && data.held_cents ? data.held_cents : 0,
      };
    },
    async credit(input) {
      const { data, error } = await supabase.rpc('skip_trace_credit', {
        p_member: input.memberId,
        p_amount: input.amountCents,
        p_session: input.stripeSessionId || '',
        p_note: input.note || 'Credit pack',
      });
      if (error) throw error;
      return rpcData(data);
    },
    async peekUsage(dayBucket, monthBucket) {
      const { data, error } = await supabase
        .from('skip_trace_usage')
        .select('scope, bucket, lookups')
        .in('bucket', [dayBucket, monthBucket]);
      if (error) throw error;
      let daily = 0;
      let monthly = 0;
      (data || []).forEach(function (row) {
        if (row.scope === 'member_day' && row.bucket === dayBucket) daily = row.lookups || 0;
        if (row.scope === 'vendor_month' && row.bucket === monthBucket) monthly = row.lookups || 0;
      });
      return { daily: daily, monthly: monthly };
    },
    async beginLookup(input) {
      const { data, error } = await supabase.rpc('skip_trace_begin_lookup', {
        p_member: input.memberId,
        p_amount: input.amountCents,
        p_address_key: input.addressKey,
        p_daily_cap: input.dailyCap,
        p_monthly_cap: input.monthlyCap,
        p_day_bucket: input.dayBucket,
        p_month_bucket: input.monthBucket,
      });
      if (error) throw error;
      return rpcData(data);
    },
    async finishLookup(input) {
      const { data, error } = await supabase.rpc('skip_trace_finish_lookup', {
        p_member: input.memberId,
        p_hold_id: input.holdId,
        p_outcome: input.outcome === 'debit' ? 'debit' : 'release',
        p_month_bucket: input.monthBucket,
        p_day_bucket: input.dayBucket || '',
        p_release_daily: !!input.releaseDaily,
      });
      if (error) throw error;
      return rpcData(data);
    },
    async getCache(memberId, addressKey) {
      const { data, error } = await supabase
        .from('skip_trace_cache')
        .select('*')
        .eq('memberstack_id', memberId)
        .eq('address_key', addressKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async putCache(row) {
      const { data, error } = await supabase
        .from('skip_trace_cache')
        .upsert(row, { onConflict: 'memberstack_id,address_key' })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data || row;
    },
    async listRecent(memberId, limit) {
      const { data, error } = await supabase
        .from('skip_trace_cache')
        .select('address_label, hit, charged_cents, created_at')
        .eq('memberstack_id', memberId)
        .order('created_at', { ascending: false })
        .limit(limit || 8);
      if (error) throw error;
      return (data || []).map(function (row) {
        return {
          addressLabel: row.address_label,
          hit: !!row.hit,
          chargedCents: row.charged_cents || 0,
          createdAt: row.created_at,
        };
      });
    },
  };
}

module.exports = {
  createMemoryStore,
  createSupabaseStore,
};
