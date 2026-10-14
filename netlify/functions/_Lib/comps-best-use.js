// netlify/functions/_Lib/comps-best-use.js
//
// ARIS "best use" for a comp report (Build Brief §6.1).
//
// Only the COMPUTED SUMMARY is sent to the model — ARV, range, rent,
// $/sqft, days on market, market trend, property type and size, and equity
// if the member's lead card knew it. Never owner names, mailing addresses,
// tax records, or the member's identity.
//
// The model must answer with strict JSON:
//   { ranked: [{ strategy, score, reasons[] }], caveats[] }
// strategy ∈ Wholesale | Flip | Rental | STR | Hold. The result is
// validated here and cached on comp_reports.best_use with a hash of the
// summary, so the same inputs never pay twice.

const crypto = require('crypto');

const STRATEGIES = ['Wholesale', 'Flip', 'Rental', 'STR', 'Hold'];
const MODEL = 'claude-sonnet-4-6';   // same model the rest of ARIS uses

// "FORGE Cast" is FORGE's name for its property-data valuation (John,
// Oct 13, 2026). Never name the underlying data vendor to members.
const SYSTEM = `You are ARIS, the AI advisor inside FORGE, a real estate investing platform.
You are ranking exit strategies for ONE property from a computed comp summary.

Rules:
- Consider exactly these strategies: Wholesale, Flip, Rental, STR, Hold.
- Rank all five from best to worst fit. Score each 0-100 (fit, not profit).
- Give 2 or 3 short, specific reasons per strategy, citing the numbers provided
  (ARV, spread to the FORGE Cast value, rent-to-value, $/sqft, days on market, trend).
- Do not invent numbers that are not in the summary. If something important is
  missing (repair costs, purchase price, STR rules, condition), say so in caveats.
- The ARV is an estimate from recorded sales, not an appraisal. Listing comps are
  not verified sales. Mention low confidence in caveats when it applies.
- "forgeCastValue" is the FORGE Cast automated valuation. Call it "the FORGE Cast value"; never name any other data provider.
- This is educational analysis, not financial, legal, or tax advice.

Respond with ONLY a JSON object, no prose and no code fences, in this shape:
{"ranked":[{"strategy":"Rental","score":82,"reasons":["...","..."]}],"caveats":["..."]}`;

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const round = (v, d = 0) => v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

// Build the summary from the stored report row plus any cached market data.
// `extra` may carry `equity` from the member's lead card.
function buildSummary({ row, market, extra }) {
  const subj = (row && row.subject) || {};
  const s = {
    propertyType: subj.propertyType || null,
    beds: num(subj.beds), baths: num(subj.baths), sqft: num(subj.sqft), yearBuilt: num(subj.yearBuilt),
    arv: num(row && row.arv), arvLow: num(row && row.arv_low), arvHigh: num(row && row.arv_high),
    forgeCastValue: num(row && row.avm),
    confidence: (row && row.confidence) || null,
    compCount: num(row && row.comp_count),
    monthlyRent: num(row && row.rent),
    lastSalePrice: num(subj.lastSalePrice), lastSaleYear: subj.lastSaleDate ? Number(String(subj.lastSaleDate).slice(0, 4)) : null,
    estimatedEquity: num(extra && extra.equity),
  };
  if (s.arv && s.sqft) s.arvPerSqft = round(s.arv / s.sqft, 0);
  if (s.monthlyRent && s.arv) s.rentToValuePct = round(s.monthlyRent / s.arv * 100, 2);
  if (market) {
    const sale = market.saleData || {};
    const rent = market.rentalData || {};
    s.zipMedianPrice = num(sale.medianPrice);
    s.zipMedianPricePerSqft = num(sale.medianPricePerSquareFoot);
    s.zipMedianDaysOnMarket = num(sale.medianDaysOnMarket);
    s.zipMedianRent = num(rent.medianRent);
    s.zipPriceTrend12moPct = trendPct(sale.history, 'medianPrice');
    s.zipRentTrend12moPct = trendPct(rent.history, 'medianRent');
  }
  Object.keys(s).forEach(k => { if (s[k] === null || s[k] === undefined) delete s[k]; });
  return s;
}

// Client-supplied summary (demo mode only, when there is no stored report):
// keep known numeric/text fields and nothing else.
const SUMMARY_KEYS = ['propertyType', 'beds', 'baths', 'sqft', 'yearBuilt', 'arv', 'arvLow', 'arvHigh', 'forgeCastValue', 'confidence', 'compCount', 'monthlyRent', 'lastSalePrice', 'lastSaleYear', 'estimatedEquity', 'arvPerSqft', 'rentToValuePct', 'zipMedianPrice', 'zipMedianPricePerSqft', 'zipMedianDaysOnMarket', 'zipMedianRent', 'zipPriceTrend12moPct', 'zipRentTrend12moPct'];
function sanitizeSummary(input) {
  const out = {};
  SUMMARY_KEYS.forEach(k => {
    const v = input && input[k];
    if (k === 'propertyType' || k === 'confidence') { if (v) out[k] = String(v).slice(0, 40); }
    else if (num(v) !== null) out[k] = num(v);
  });
  return out;
}

function trendPct(history, field) {
  const months = Object.keys(history || {}).sort();
  if (months.length < 2) return null;
  const first = num(history[months[0]] && history[months[0]][field]);
  const last = num(history[months[months.length - 1]] && history[months[months.length - 1]][field]);
  return first && last ? round((last - first) / first * 100, 1) : null;
}

function summaryHash(summary) {
  return crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 16);
}

// Pull the first {...} object out of a model reply and validate it.
function parseResult(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { return null; }
  if (!obj || !Array.isArray(obj.ranked)) return null;
  const seen = new Set();
  const ranked = obj.ranked
    .map(r => ({
      strategy: STRATEGIES.find(s => s.toLowerCase() === String(r && r.strategy || '').trim().toLowerCase()),
      score: Math.max(0, Math.min(100, Math.round(Number(r && r.score) || 0))),
      reasons: (Array.isArray(r && r.reasons) ? r.reasons : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3),
    }))
    .filter(r => r.strategy && r.reasons.length && !seen.has(r.strategy) && seen.add(r.strategy))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const caveats = (Array.isArray(obj.caveats) ? obj.caveats : []).map(x => String(x).trim()).filter(Boolean).slice(0, 5);
  return { ranked, caveats };
}

// Calls the Anthropic Messages API. `fetchImpl` is injected for tests.
async function askAris(summary, { apiKey, fetchImpl, timeoutMs = 20000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (fetchImpl || fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: 'user', content: 'Comp summary (JSON):\n' + JSON.stringify(summary) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const text = (data && Array.isArray(data.content) ? data.content : []).filter(b => b.type === 'text').map(b => b.text).join('');
    const result = parseResult(text);
    return result ? { ok: true, result } : { ok: false, status: 502, error: 'invalid_json' };
  } catch (e) {
    return { ok: false, status: e && e.name === 'AbortError' ? 504 : 502 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { STRATEGIES, MODEL, SYSTEM, buildSummary, sanitizeSummary, summaryHash, parseResult, askAris, trendPct };
