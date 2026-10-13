// netlify/functions/_Lib/comps-store.js
//
// Storage for the comping engine, behind a small interface so
// rentcast-comps.js can be tested with an in-memory store
// (tests/helpers/memory-store.js) instead of a live Supabase project.
//
// Every method throws on a Supabase error. Callers decide whether that
// means "fail closed" (the budget check) or "keep going" (logging).

function createSupabaseStore(supabase) {
  return {
    async getCache(key, now) {
      const { data, error } = await supabase
        .from('rentcast_cache')
        .select('response, fetched_at, expires_at')
        .eq('key', key)
        .gt('expires_at', (now || new Date()).toISOString())
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async putCache(row) {
      const { error } = await supabase.from('rentcast_cache').upsert(row, { onConflict: 'key' });
      if (error) throw error;
    },

    async reserveCall({ month, cap, baseFee, included, overage }) {
      const { data, error } = await supabase.rpc('reserve_rentcast_call', {
        p_month: month, p_cap: cap, p_base_fee: baseFee, p_included: included, p_overage: overage,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('reserve_rentcast_call returned no row');
      return {
        allowed: !!row.allowed,
        cost: Number(row.cost) || 0,
        calls: Number(row.calls) || 0,
        spend: Number(row.spend) || 0,
        cap: Number(row.cap) || 0,
        alert80: !!row.alert_80,
        alert100: !!row.alert_100,
        alert1000: !!row.alert_1000,
      };
    },

    async releaseCall({ month, cost }) {
      const { error } = await supabase.rpc('release_rentcast_call', { p_month: month, p_cost: cost });
      if (error) throw error;
    },

    async logCall(row) {
      const { error } = await supabase.from('rentcast_calls').insert(row);
      if (error) throw error;
    },

    async countMemberLiveCalls(memberId, sinceIso) {
      const { count, error } = await supabase
        .from('rentcast_calls')
        .select('id', { count: 'exact', head: true })
        .eq('memberstack_id', memberId)
        .eq('cache_hit', false)
        .lt('http_status', 400)          // refused / failed calls don't count against the member
        .gte('created_at', sinceIso);
      if (error) throw error;
      return count || 0;
    },

    async getBudget(month) {
      const { data, error } = await supabase.from('rentcast_budget').select('*').eq('month', month).maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async listCallsSince(sinceIso) {
      const { data, error } = await supabase
        .from('rentcast_calls')
        .select('memberstack_id, endpoint, cache_hit, cost_usd, http_status, created_at')
        .gte('created_at', sinceIso)
        .limit(10000);
      if (error) throw error;
      return data || [];
    },

    async insertReport(row) {
      const { data, error } = await supabase.from('comp_reports').insert(row).select().single();
      if (error) throw error;
      return data;
    },

    async updateReport(id, memberId, patch) {
      const { data, error } = await supabase
        .from('comp_reports').update(patch).eq('id', id).eq('memberstack_id', memberId).select().maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async getReport(id, memberId) {
      const { data, error } = await supabase
        .from('comp_reports').select('*').eq('id', id).eq('memberstack_id', memberId).maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async getReportByToken(token) {
      const { data, error } = await supabase
        .from('comp_reports').select('*').eq('share_token', token).maybeSingle();
      if (error) throw error;
      return data || null;
    },
  };
}

module.exports = { createSupabaseStore };
