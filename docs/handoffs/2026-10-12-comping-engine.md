# Comping Engine — Handoff, Phase 1 (backend foundation)

**Date:** Oct 12, 2026 · **Branch:** `feature/comping-engine` (from `main` @ `6e9b766`)
**PR:** PR 1 — Comping engine backend (opened by John from the pushed branch)
**Live RentCast calls spent this session:** 0 (fixtures only)

## What was built

| File | Purpose |
|---|---|
| `add-comping-engine-tables.sql` | `rentcast_cache`, `rentcast_calls`, `rentcast_budget`, `comp_reports`; `reserve_rentcast_call()` and `release_rentcast_call()`. RLS on, no policies. Re-runnable. |
| `netlify/functions/rentcast-comps.js` | The function: tier gate, cache → member limit → budget → RentCast → log, alerts, all routes. |
| `netlify/functions/_Lib/plans.js` | One server-side plan list. `hasCompsAccess()` = Empire access minus FORGE Zero. |
| `netlify/functions/_Lib/comps-core.js` | Address normalization, cache keys, plan pricing, month keys. |
| `netlify/functions/_Lib/comps-store.js` | Supabase storage behind a small interface. |
| `netlify/functions/_Lib/rentcast-client.js` | RentCast GET with 8s timeout; fixture loader (with date shifting). |
| `netlify/functions/_Lib/comps-alerts.js` | 80% / 100% / 1,000-call alerts via GHL tags (add-only). |
| `netlify/functions/__fixtures__/rentcast/*` | Crown Point, IN fixtures for every endpoint (see its README). |
| `assets/js/comp-engine.js` | Pure ARV math (selection, adjustments, median/mean, ladder, confidence). Browser + Node. |
| `tests/*.test.js`, `tests/helpers/memory-store.js` | 51 `node --test` tests. |
| `scripts/check-syntax.js` (+ `.sh`) | Syntax check. `npm run check`. |
| `scripts/test-sql.sh`, `scripts/test-sql.sql` | Runs the migration twice plus budget, RLS and concurrency checks on a scratch Postgres. |
| `netlify.toml` | Ships fixtures with the function; `rentcast-comps` timeout 26s; blocks `/docs/handoffs/*` from the public site. |
| `package.json` | `check`, `test`, `test:sql` scripts. No new dependencies. |

## Routes

`POST comp` (subject + sold comps + AVM, in parallel, up to 3 lookups) · `POST rent` / `POST market` (lazy, 1 each) · `POST expand` (1, only beyond 2 mi / 365 days) · `POST update` (0 — recomputes from cache) · `POST share` / `POST revoke` · `GET report&token=` (public, never calls RentCast, owner/tax stripped) · `GET listings` (1) · `GET budget` · `GET usage` (admin only) · `POST save-crm` (501 until Phase 4).

## Env vars (Netlify → Site configuration → Environment variables)

| Name | Value | Notes |
|---|---|---|
| `RENTCAST_API_KEY` | *(leave unset until Phase 5)* | Unset = demo mode: fixtures, no Supabase use, "Demo data". |
| `RENTCAST_MOCK` | `1` on a deploy preview only | Fixtures through the full cache/budget/log pipeline. Never on production. |
| `COMPS_MONTHLY_CAP_USD` | `100` | All-in, plan base fee included. Default 100. |
| `COMPS_PLAN` | `developer` | `developer` / `foundation` / `growth` / `scale`. Drives cost per call. |
| `COMPS_CACHE_DAYS` | `30` | Default 30. |
| `COMPS_MEMBER_MONTHLY_LIMIT` | *(blank)* | Blank = no per-member limit (John, Oct 12). Set a number later to turn it on. |
| `COMPS_ALERT_EMAILS` | John's and Simon's emails, comma-separated | Must match (or will create) their GHL contacts. |
| `COMPS_ADMIN_EMAILS` | *(optional)* Simon's email | Adds to the usage-view admin list. |

Existing vars used: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MEMBERSTACK_SECRET_KEY`, `MEMBERSTACK_APP_ID`, `GHL_API_KEY`, `GHL_LOCATION_ID`.

## SQL John must run

Supabase → SQL editor → paste all of `add-comping-engine-tables.sql` → Run. Safe to run twice. It relies on `set_updated_at()` from `schema.sql`, which is already in the database.

## GHL setup for alerts

One workflow, trigger **Contact Tag added**, any of: `forge-comps-budget-80`, `forge-comps-budget-100`, `forge-comps-1000-calls`. Actions: send an internal email to John and Simon (include the tag name), and an internal notification. The function removes and re-adds only its own alert tag, so the trigger fires again next month. No other tag is touched.

## GHL custom fields still needed (Phase 4)

The 11 fields in Build Brief §7.3. Not needed for Phases 1–3.

## Unverified (confirm on the first live calls, Phase 5)

1. RentCast field names — taken from the documented examples (property-data, property-valuation, market-data pages, read Oct 12, 2026).
2. `/properties` with `address` + `radius` + `saleDateRange` returning sold parcels with `lastSalePrice`.
3. **Indiana sale prices.** RentCast warns sale prices may be missing in non-disclosure states. Check that Crown Point / Lake County records carry `lastSalePrice`. If not, ARV falls back to listing comps (ladder step 4, Low confidence).
4. `@memberstack/admin` `members.retrieve()` returning `planConnections[].status` as `ACTIVE` / `TRIALING`.
5. `comps-store.js` against live Supabase (logic is covered by the in-memory store; SQL by `test-sql.sh`).

## Decisions made and flags (also in the PR)

- **Tier gate:** Empire only, FORGE Zero excluded (John, Oct 12). **Beta $97** (`prc_-97-direct`) counts as Empire and gets comps — confirmed by John, Oct 12.
- **Per-member limit:** off; env var ready.
- **Alerts:** "both" delivered as GHL tag → workflow that emails + notifies.
- **One wide pull:** sold comps are fetched once at 2 mi / 365 days (limit 500). RentCast bills per request, not per record, so ladder steps up to 2 mi and 365 days cost nothing. Only `expand` past that costs a lookup.
- **Budget function:** the brief sketched `reserve_rentcast_call(month, est_cost, cap)`. The cost is computed inside the row lock instead (it depends on calls already made), so concurrent requests can't race. Proven by a 200-way parallel test.
- **RLS enabled** on the new tables, stricter than the existing ones; service-role access is unchanged.
- **Function timeout 26s** (as `aris-quote` already uses) so the one retry has room.
- **Correction (Phase 2):** `property-search.html` defines `--grey-light` but *uses* `--light-grey` and `--navy-card`, neither of which is defined — so cards there render with a transparent background. Left as-is by John's choice (Oct 12); the comps panel supplies its own fallbacks.

## Known issues / risks outside this PR

- The site publishes the repo root, so `netlify/functions/*.js`, `*.sql`, `tests/` and `scripts/` are downloadable from the web today (no secrets in them). Only `/docs/handoffs/*` is blocked here. Recommend a separate PR to block `/netlify/*`, `/scripts/*`, `/tests/*`, `/*.sql`.
- `schema.sql` limits `deals.deal_type` to `residential`/`commercial`, but `property-search.js` inserts `wholesale`. Check the live constraint before Phase 4's CRM save.
- `memberstack-webhook.js` still sends `tags` in its GHL upsert (tag-wipe). Separate fix, already queued.

## How to verify

```
npm run check     # syntax: 39 files/blocks, 0 failed
npm test          # 51 tests pass
npm run test:sql  # needs a local Postgres; migration + budget + RLS + concurrency
```

## Next steps

1. John runs the SQL, sets the env vars (no `RENTCAST_API_KEY` yet), merges PR 1.
2. Optional: on a deploy preview, set `RENTCAST_MOCK=1` and run one comp to see the cache, budget and log rows appear in Supabase.
3. Phase 2: comps panel UI in `property-search.html`.


---

# Phase 2 — Comps panel UI (Oct 12, 2026)

**Branch:** `feature/comping-engine-phase2` (from `main` @ `06f6521`) · **PR:** #3
**Live RentCast calls spent:** 0

## Decisions (John, Oct 12)
- **Visibility:** the panel is **admin-only** until RentCast goes live (Phase 5) — demo mode shows Crown Point sample comps for any address, which members could mistake for real comps. Flag: `COMPS_PUBLIC` in `assets/js/comp-panel.js`. Non-admins see the page exactly as before (both teaser cards stay).
- **Beta $97 gets comps:** yes. No code change needed.
- **Save to CRM (Phase 4):** native FORGE CRM by default; GHL push admin-only.
- **Missing page colors:** leave as-is.

## What was built
| File | Purpose |
|---|---|
| `assets/js/comp-panel.js` | The panel: lookup card, slide-over, gauge, filters, ladder, map, table, "How we got this", all states. Uses `comp-engine.js` for every number. |
| `assets/css/comp-panel.css` | Styles, all `.ps-comp-`, page tokens with fallbacks. Desktop 640px slide-over; ≤768px full screen, stacked comp cards, filter bottom sheet. |
| `property-search.html` | 12 lines: load the 3 files, ids on the two teasers, `ForgeComps.init()` after auth, a "Comp This Property" button on result cards, map popups and saved leads. |
| `netlify/functions/rentcast-comps.js` | Admins pass the tier gate (John's account may be on FORGE Zero). |
| `netlify.toml` | `/api/rentcast-comps` → function. |
| `tests/ui/comp-panel.ui.py` | 52 browser checks at 1440 / 768 / 375 px (Playwright). `npm run test:ui`. |
| `tests/rentcast-comps.test.js` | +2 tests: admin on FORGE Zero passes; Beta $97 passes. |

## How the money rules show up in the UI
- Opening a property = one `comp` call (3 lookups, or $0 when cached).
- Toggling comps, every filter inside 2 mi / 365 days, the $30–$50 slider, line items, sorting, ladder steps 1–6: **no lookup**, recomputed in the browser in ~7 ms.
- Only two buttons cost a lookup, and both say so: **Expand search (uses 1 lookup)** (radius > 2 mi or > 365 days) and **Refresh sales data (uses 1 lookup)** (shown only when the data came from cache).
- The member's selection is saved with the free `update` action, 0.9 s after the last change.

## Deviations / notes
- **Similarity colors:** the brief's 0.95 / 0.90 thresholds fit RentCast's correlation scale; FORGE's own similarity score runs lower (typical good comps score 75–90%), so pins and badges use **≥85% green, 70–85% yellow, below grey**. Revisit after Phase 5 with real data.
- **Pin numbers** follow the order included → eligible → excluded, so the comps in the ARV are always #1–#N on both map and table.
- Rent / Market / Property tabs and Best Use are **Phase 3**; the action bar (Deal Analyzer, CRM, PDF, share) is **Phase 4** — not shown yet.
- Map tiles are OpenStreetMap, same as the main map.

## Verify
```
npm run check     # 40 files/blocks, 0 failed
npm test          # 53 pass
npm run test:ui   # 52 browser checks (needs Playwright + Chromium)
```

## Next steps
1. Merge PR #3. As an admin, open Property Search → "Comp a Property" (or "Comp This Property" on a result) and click through.
2. Phase 3: Rent, Market, Property tabs + ARIS best use.
