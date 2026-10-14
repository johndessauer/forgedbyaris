#!/usr/bin/env python3
# Browser tests for the comps panel (Comping Engine Phase 2).
#   pip install playwright && playwright install chromium
#   python3 tests/ui/comp-panel.ui.py
# Serves the repo locally, stubs Memberstack and the API, and uses a real
# backend response generated from the fixtures (mock mode) — no network,
# no RentCast. Screenshots go to tests/ui/screenshots/ (git-ignored).
import os, subprocess, tempfile, pathlib
REPO = str(pathlib.Path(__file__).resolve().parents[2])
W = os.path.join(REPO, 'tests', 'ui', 'screenshots')
os.makedirs(W, exist_ok=True)
_tmp = tempfile.mkdtemp()
# Real backend response from fixtures (mock mode)
_gen = """
const { createHandler } = require('./netlify/functions/rentcast-comps');
const { createMemoryStore } = require('./tests/helpers/memory-store');
const h = createHandler({ env:{RENTCAST_MOCK:'1'}, store:createMemoryStore(), now:()=>new Date(), verifyMember: async()=>'mem_admin',
  getMember: async()=>({auth:{email:'john@thedessauergroup.com'},planConnections:[]}), fetch: async()=>({ok:true,status:200,json:async()=>({})}) });
h({httpMethod:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify({action:'comp',address:'733 N Main St, Crown Point, IN 46307'})})
  .then(r=>process.stdout.write(r.body));
"""
_comp_json = subprocess.run(['node', '-e', _gen], cwd=REPO, capture_output=True, text=True, check=True).stdout
# Leaflet 1.9.4 from npm (the page loads it from cdnjs)
subprocess.run(['npm', 'pack', 'leaflet@1.9.4', '--silent', '--pack-destination', _tmp], check=True, capture_output=True)
subprocess.run(['tar', 'xzf', os.path.join(_tmp, 'leaflet-1.9.4.tgz'), '-C', _tmp], check=True)
import asyncio, json, http.server, threading, functools, time, sys, copy
from playwright.async_api import async_playwright

COMP = json.loads(_comp_json)
COMP['reportId'] = 'rep_test'; COMP['demo'] = True
LEAFLET_JS = open(os.path.join(_tmp, 'package/dist/leaflet.js')).read()
LEAFLET_CSS = open(os.path.join(_tmp, 'package/dist/leaflet.css')).read()

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(Q, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8766'

SEARCH = {"results": [
  {"id": "demo-4", "address": "733 N Main St, Crown Point, IN 46307", "lat": 41.4278, "lng": -87.3602, "playIds": ["prefore"], "owner": "T. Alvarez", "equity": 112,
   "details": {"beds": 3, "baths": 2, "sqft": 1650, "yearBuilt": 1978, "propertyType": "Single Family"}},
  {"id": "demo-1", "address": "2107 Delaware Pkwy, Crown Point, IN 46307", "lat": 41.4102, "lng": -87.3599, "playIds": ["taxdelinquent"], "owner": "R. Nowak", "equity": 34, "details": {}},
  {"id": "R100", "address": "1930 SILVER CREEK CT", "lat": 41.40, "lng": -87.33, "playIds": ["prefore"], "owner": "S. Fiori", "equity": 133,
   "details": {"city": "Crown Point", "state": "IN", "zip": "46307", "beds": 2, "baths": 2, "sqft": 1684}}],
  "total": 3, "demo": True}

def member_script(email):
    return """
    window.$memberstackReady = true;
    window.$memberstackDom = {
      getCurrentMember: async () => ({ data: { id: 'mem_1', auth: { email: '%s' }, customFields: { 'first-name': 'John', 'last-name': 'Dessauer' },
        planConnections: [{ planId: 'pln_founding-member-a1p70rff', status: 'ACTIVE', payment: { priceId: 'prc_x' } }] } }),
      getMemberCookie: async () => 'test-token', logout: async () => {}
    };""" % email

async def make_page(browser, vp, email='john@thedessauergroup.com', comp_override=None):
    ctx = await browser.new_context(viewport={'width': vp[0], 'height': vp[1]})
    page = await ctx.new_page()
    calls = []
    await page.add_init_script(member_script(email))
    async def route(r):
        url = r.request.url
        if 'leaflet.min.js' in url: return await r.fulfill(body=LEAFLET_JS, content_type='application/javascript')
        if 'leaflet.min.css' in url: return await r.fulfill(body=LEAFLET_CSS, content_type='text/css')
        if url.startswith(BASE):
            if '/api/rentcast-comps' in url:
                body = r.request.post_data
                payload = json.loads(body) if body else {}
                action = payload.get('action') or ('budget' if 'action=budget' in url else '?')
                calls.append({'action': action, 't': time.time(), 'payload': payload})
                if action == 'rent':
                    return await r.fulfill(body=json.dumps({'demo': True, 'cached': False, 'rent': FIX('avm-rent.json')}), content_type='application/json')
                if action == 'market':
                    return await r.fulfill(body=json.dumps({'demo': True, 'cached': False, 'market': FIX('markets.json')}), content_type='application/json')
                if 'action=listings' in url:
                    calls[-1]['action'] = 'listings'
                    return await r.fulfill(body=json.dumps({'demo': True, 'cached': False, 'type': 'rental', 'listings': FIX('listings-rental.json')}), content_type='application/json')
                if action == 'retry-record':
                    return await r.fulfill(body=json.dumps({'reportId': 'rep_test', 'cached': False, 'subject': COMP['subject'], 'property': COMP['property'], 'comps': COMP['comps'], 'report': COMP['report']}), content_type='application/json')
                if action == 'best-use':
                    if BEST_USE_FAIL: return await r.fulfill(status=502, body=json.dumps({'error': 'best_use_unavailable'}), content_type='application/json')
                    return await r.fulfill(body=json.dumps(BEST_USE), content_type='application/json')
                if action == 'comp':
                    if comp_override: return await r.fulfill(status=comp_override[0], body=json.dumps(comp_override[1]), content_type='application/json')
                    return await r.fulfill(body=json.dumps(COMP), content_type='application/json')
                return await r.fulfill(body=json.dumps({'ok': True}), content_type='application/json')
            if '/api/property-search' in url:
                return await r.fulfill(body=json.dumps(SEARCH if 'action=search' in url else {'leads': []}), content_type='application/json')
            if '/api/' in url or '/.netlify/' in url:
                return await r.fulfill(body='{}', content_type='application/json')
            return await r.continue_()
        return await r.abort()
    await page.route('**/*', route)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    await page.goto(BASE + '/property-search.html', wait_until='load')
    await page.wait_for_timeout(600)
    return ctx, page, calls, errors

async def open_by_lookup(page):
    await page.fill('#ps-comp-street', '733 N Main St')
    await page.fill('#ps-comp-city', 'Crown Point')
    await page.fill('#ps-comp-state', 'IN')
    await page.fill('#ps-comp-zip', '46307')
    await page.click('#ps-comp-go')
    await page.wait_for_selector('.ps-comp-stat.arv .v', timeout=5000)
    await page.wait_for_timeout(400)

FIX = lambda name: json.load(open(os.path.join(REPO, 'netlify/functions/__fixtures__/rentcast', name)))
BEST_USE = {'cached': False, 'hash': 'x', 'model': 'claude-sonnet-4-6', 'result': {'ranked': [
  {'strategy': 'Rental', 'score': 81, 'reasons': ['Rent-to-value near 0.7%', 'ARV within 1% of the FORGE Cast value']},
  {'strategy': 'Flip', 'score': 64, 'reasons': ['Thin spread without a purchase price']},
  {'strategy': 'Wholesale', 'score': 55, 'reasons': ['Needs a deep discount']},
  {'strategy': 'Hold', 'score': 50, 'reasons': ['Modest appreciation']},
  {'strategy': 'STR', 'score': 30, 'reasons': ['No STR demand data']}], 'caveats': ['No repair estimate was provided.']}}
BEST_USE_FAIL = False

results = []
def check(name, ok, info=''):
    results.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name + (('  ' + str(info)) if not ok or info else ''))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ── Desktop, admin ──
        ctx, page, calls, errors = await make_page(b, (1440, 900))
        check('lookup card replaces the address teaser', await page.is_visible('#ps-comp-lookup') and not await page.is_visible('#ps-teaser-lookup'))
        check('comps teaser hidden for admins', not await page.is_visible('#ps-teaser-comps'))
        check('result cards get a Comp button', await page.locator('.ps-lead-card .ps-comp-lead-btn').count() == 3)
        await page.click('#ps-comp-go')
        check('lookup form validates empty street', await page.is_visible('#ps-comp-form-error'))
        await open_by_lookup(page)
        check('one comp call made', [c['action'] for c in calls].count('comp') == 1, [c['action'] for c in calls])
        sent = [c for c in calls if c['action'] == 'comp'][0]['payload']
        check('address composed from the form', sent['address'] == '733 N Main St, Crown Point, IN 46307', sent['address'])
        arv = await page.inner_text('.ps-comp-stat.arv .v')
        check('ARV shown', arv == '$261,000', arv)
        check('demo badge shown', await page.is_visible('.ps-comp-pill.demo'))
        check('confidence High', (await page.inner_text('.ps-comp-conf')).strip() == 'High')
        rows = await page.locator('.ps-comp-table tbody tr[data-id]').count()
        check('table shows eligible comps', rows == 5, rows)
        check('recorded-sale badges', await page.locator('.ps-comp-badge.rec').count() == 5)
        check('map pins rendered', await page.locator('.ps-comp-pin').count() == 5)
        check('subject star rendered', await page.locator('.ps-comp-star').count() == 1)
        check('no JS errors', not errors, errors)
        await page.screenshot(path=f'{W}/shot-1440.png', full_page=False)

        # Toggle a comp: ARV recalculates locally, fast, no lookup call.
        before = len(calls)
        t = await page.evaluate("""() => new Promise(res => {
          const cb = document.querySelector('.ps-comp-table input[data-toggle^="1012"]');
          const t0 = performance.now(); cb.click();
          const t1 = performance.now();
          res({ ms: t1 - t0, arv: document.querySelector('.ps-comp-stat.arv .v').textContent });
        })""")
        check('toggle updates ARV in < 100 ms', t['ms'] < 100 and t['arv'] == '$260,700', t)
        check('toggle made no immediate network call', len(calls) == before)
        await page.wait_for_timeout(1200)
        new_actions = [c['action'] for c in calls[before:]]
        check('selection saved once via free update (debounced)', new_actions == ['update'], new_actions)
        upd = calls[-1]['payload']
        check('update carries the manual exclusion', upd['selection']['manual'].get('1012-N-Court-St,-Crown-Point,-IN-46307') is False)

        # Filters inside the pulled range: no lookup.
        before = len(calls)
        await page.select_option('select[data-f="radius"]', '0.25')
        await page.wait_for_timeout(100)
        check('narrow radius recalculates with no lookup', all(c['action'] == 'update' for c in calls[before:]))
        check('ladder appears when < 3 comps', await page.is_visible('.ps-comp-ladder'))
        check('no expand button inside pulled range', await page.locator('#ps-comp-expand').count() == 0)
        await page.select_option('select[data-f="radius"]', '1.5')
        await page.select_option('select[data-f="soldWithinDays"]', '180')
        await page.wait_for_timeout(100)
        check('1.5 mi / 180 days still free', await page.locator('#ps-comp-expand').count() == 0)
        await page.select_option('select[data-f="radius"]', '3')
        await page.wait_for_timeout(100)
        check('beyond 2 mi shows explicit expand button', await page.is_visible('#ps-comp-expand'))
        check('no expand call without a click', not any(c['action'] == 'expand' for c in calls))
        # adj slider clamp
        await page.evaluate("""() => { const r = document.getElementById('ps-comp-adjrate'); r.value = 50; r.dispatchEvent(new Event('input')); }""")
        check('adj slider shows $50', (await page.inner_text('#ps-comp-adjrate-out')) == '$50/sq ft')
        # reset
        await page.click('#ps-comp-reset')
        await page.wait_for_timeout(100)
        check('reset restores auto ARV', (await page.inner_text('.ps-comp-stat.arv .v')) == '$261,000')
        # sorting
        await page.click('button[data-sort="price"]')
        first = await page.inner_text('.ps-comp-table tbody tr[data-id] .addr')
        check('sort by price (desc) puts 1012 N Court first', first.startswith('1012 N Court'), first)
        # Escape closes
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        check('Escape closes the panel', await page.get_attribute('.ps-comp-panel', 'aria-hidden') == 'true')
        # Lead card button opens with known details as overrides
        before = len(calls)
        await page.click('#ps-card-demo-4 .ps-comp-lead-btn')
        await page.wait_for_selector('.ps-comp-panel.open .ps-comp-stat.arv .v')
        p2 = [c for c in calls[before:] if c['action'] == 'comp'][0]['payload']
        check('lead card passes beds/baths/sqft', p2['overrides'].get('sqft') == 1650 and p2['overrides'].get('beds') == 3, p2['overrides'])
        # Street-only live lead: the full address goes to RentCast.
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        before = len(calls)
        await page.click('#ps-card-R100 .ps-comp-lead-btn')
        await page.wait_for_selector('.ps-comp-panel.open .ps-comp-stat.arv .v')
        p3 = [c for c in calls[before:] if c['action'] == 'comp'][0]['payload']
        check('street-only lead sends the full address', p3['address'] == '1930 SILVER CREEK CT, Crown Point, IN 46307', p3['address'])
        lines = await page.locator('.ps-comp-table .ps-comp-cityline').all_inner_texts()
        check('comp rows show city, state, ZIP', len(lines) >= 5 and all(l == 'Crown Point, IN 46307' for l in lines), lines[:3])
        await page.click('#ps-comp-tabbtn-rent'); await page.wait_for_selector('#ps-comp-tab-rent tbody tr')
        rl = await page.locator('#ps-comp-tab-rent .ps-comp-cityline').all_inner_texts()
        check('rental comps show city, state, ZIP', len(rl) == 4 and rl[0] == 'Crown Point, IN 46307', rl)
        await page.keyboard.press('Escape'); await page.wait_for_timeout(300)
        # Old saved lead with no city/state/ZIP: ask instead of guessing.
        before = len(calls)
        await page.evaluate("savedLeadsCache = [{ id: 'old1', address: '55 OLD MILL RD', details: {} }]; ForgeComps.openLead('saved', 'old1')")
        await page.wait_for_timeout(500)
        check('incomplete saved lead makes no comp call', not any(c['action'] == 'comp' for c in calls[before:]))
        check('lookup card prefilled with the street', await page.input_value('#ps-comp-street') == '55 OLD MILL RD')
        msg = await page.inner_text('#ps-comp-form-error')
        check('member is asked for city, state and ZIP', 'city, state and ZIP' in msg, msg)
        check('city field focused', await page.evaluate("document.activeElement && document.activeElement.id") == 'ps-comp-city')
        await page.fill('#ps-comp-city', 'Hobart'); await page.fill('#ps-comp-state', 'IN'); await page.fill('#ps-comp-zip', '46342')
        await page.click('#ps-comp-go'); await page.wait_for_selector('.ps-comp-panel.open .ps-comp-stat.arv .v')
        p4 = [c for c in calls[before:] if c['action'] == 'comp'][0]['payload']
        check('completed address is used', p4['address'] == '55 OLD MILL RD, Hobart, IN 46342', p4['address'])
        await page.keyboard.press('Escape')
        await page.screenshot(path=f'{W}/shot-1440-cityline.png')
        await ctx.close()

        # ── FORGE Cast: no vendor name anywhere a member can read ──
        ctx, page, calls, errors = await make_page(b, (1440, 900))
        await page.evaluate("ForgeComps.open('733 N Main St, Crown Point, IN 46307', {})")
        await page.wait_for_selector('.ps-comp-bu-top', timeout=5000)
        seen_text = [await page.inner_text('body')]
        for tab in ['rent', 'market', 'property']:
            await page.click(f'#ps-comp-tabbtn-{tab}')
            await page.wait_for_timeout(500)
            seen_text.append(await page.inner_text('#ps-comp-tab-' + tab))
        await page.click('#ps-comp-rentals-btn') if await page.is_visible('#ps-comp-rentals-btn') else None
        await page.click('#ps-comp-tabbtn-rent'); await page.click('#ps-comp-rentals-btn'); await page.wait_for_timeout(300)
        seen_text.append(await page.inner_text('#ps-comp-tab-rent'))
        await page.click('#ps-comp-tabbtn-comps')
        await page.evaluate("document.querySelector('.ps-comp-how').open = true")
        seen_text.append(await page.inner_text('#ps-comp-body'))
        alltext = '\n'.join(seen_text)
        check('no "RentCast" anywhere members can read', 'rentcast' not in alltext.lower(), [l for l in alltext.splitlines() if 'rentcast' in l.lower()][:3])
        check('FORGE Cast named on the gauge and stats', 'FORGE Cast' in await page.inner_text('#ps-comp-summary'))
        fs = await page.inner_text('.ps-comp-factsrc')
        check('fact source line shown', 'Facts from the public record' in fs, fs)
        await ctx.close()

        # No public record + FORGE Cast spelling → honest notice and 1-lookup retry
        NR = dict(COMP); NR['noPublicRecord'] = True; NR['suggestedAddress'] = '733 N Main St, Crown Point, IN 46307'; NR['property'] = None
        ctx, page, calls, errors = await make_page(b, (1440, 900), comp_override=(200, NR))
        await page.evaluate("ForgeComps.open('733 North Main Street, Crown Pt, IN 46307', {})")
        await page.wait_for_selector('#ps-comp-norecord', timeout=5000)
        nt = await page.inner_text('#ps-comp-norecord')
        check('honest no-record notice (no new-construction guess)', "doesn't have a public property record" in nt and 'construction' not in nt.lower(), nt[:120])
        check('suggested spelling shown with a 1-lookup retry', '733 N Main St, Crown Point, IN 46307' in nt and 'uses 1 lookup' in nt)
        before = len(calls)
        await page.click('#ps-comp-retry-record')
        await page.wait_for_timeout(600)
        acts = [c['action'] for c in calls[before:]]
        check('retry makes exactly one retry-record call', acts.count('retry-record') == 1 and 'comp' not in acts, acts)
        check('notice cleared after a successful retry', await page.locator('#ps-comp-norecord').count() == 0)
        await page.click('#ps-comp-tabbtn-property'); await page.wait_for_timeout(200)
        check('property tab filled from the retried record', 'T. Alvarez' in await page.inner_text('#ps-comp-tab-property'))
        check('no-record flow: no JS errors', not errors, errors)
        await ctx.close()

        # ── Phase 3: best use, tabs, lazy loading ──
        ctx, page, calls, errors = await make_page(b, (1440, 900))
        await page.evaluate("ForgeComps.open('733 N Main St, Crown Point, IN 46307', {})")
        await page.wait_for_selector('.ps-comp-bu-top', timeout=5000)
        acts = [c['action'] for c in calls]
        check('best use requested automatically, once', acts.count('best-use') == 1, acts)
        check('best use shows the top pick', 'Buy & Hold Rental' in await page.inner_text('.ps-comp-bu-top'))
        check('best use lists all five strategies', await page.locator('.ps-comp-bu-list > li').count() == 5)
        check('no rent/market lookups before tabs are opened', 'rent' not in acts and 'market' not in acts)
        await page.click('#ps-comp-tabbtn-rent')
        await page.wait_for_selector('#ps-comp-tab-rent .ps-comp-stat.arv .v')
        check('rent tab loads once with the estimate', (await page.inner_text('#ps-comp-tab-rent .ps-comp-stat.arv .v')) == '$1,850')
        check('rent tab: comps table + map pins', await page.locator('#ps-comp-tab-rent tbody tr').count() == 4 and await page.locator('#ps-comp-rentmap .ps-comp-pin').count() == 4)
        check('comps tab hidden while on rent', await page.is_hidden('#ps-comp-tab-comps'))
        check('active rentals not loaded until clicked', not any(c['action'] == 'listings' for c in calls))
        await page.click('#ps-comp-rentals-btn')
        await page.wait_for_selector('#ps-comp-rentals tbody tr')
        check('active rentals load on click', [c['action'] for c in calls].count('listings') == 1 and await page.locator('#ps-comp-rentals tbody tr').count() == 2)
        await page.click('#ps-comp-tabbtn-comps'); await page.click('#ps-comp-tabbtn-rent'); await page.wait_for_timeout(150)
        check('re-opening rent makes no new call', [c['action'] for c in calls].count('rent') == 1)
        await page.click('#ps-comp-tabbtn-market')
        await page.wait_for_selector('#ps-comp-tab-market .ps-comp-chart')
        check('market tab: one call, four charts', [c['action'] for c in calls].count('market') == 1 and await page.locator('#ps-comp-tab-market svg.ps-comp-chart').count() == 4)
        await page.screenshot(path=f'{W}/shot-1440-market.png')
        before = len(calls)
        await page.click('#ps-comp-tabbtn-property'); await page.wait_for_timeout(150)
        ptxt = await page.inner_text('#ps-comp-tab-property')
        check('property tab: no call, owner + lawful note + history + taxes', len(calls) == before and 'T. Alvarez' in ptxt and 'lawful outreach' in ptxt and '2016' in ptxt and '2025' in ptxt, ptxt[:120])
        await page.screenshot(path=f'{W}/shot-1440-property.png')
        await page.click('#ps-comp-tabbtn-comps'); await page.wait_for_timeout(100)
        check('update-best-use link appears after rent/market load', await page.is_visible('#ps-comp-bu-update'))
        await page.click('#ps-comp-bu-update'); await page.wait_for_timeout(300)
        bu = [c for c in calls if c['action'] == 'best-use']
        check('update re-asks ARIS for the same report (server adds rent/market to the summary)', len(bu) == 2 and bu[1]['payload'].get('reportId') == 'rep_test', bu[-1]['payload'] if bu else None)
        sent = json.dumps([c['payload'] for c in bu])
        check('best-use request carries no owner data', 'Alvarez' not in sent and 'mailing' not in sent.lower())
        await page.focus('#ps-comp-tabbtn-comps'); await page.keyboard.press('ArrowRight'); await page.wait_for_timeout(100)
        check('arrow keys move between tabs', await page.get_attribute('#ps-comp-tabbtn-rent', 'aria-selected') == 'true')
        await page.click('#ps-comp-tabbtn-comps'); await page.wait_for_timeout(100)
        await page.screenshot(path=f'{W}/shot-1440-bestuse.png')
        check('phase 3: no JS errors', not errors, errors)
        await ctx.close()

        BEST_USE_FAIL_PREV = globals()['BEST_USE_FAIL']
        globals()['BEST_USE_FAIL'] = True
        ctx, page, calls, errors = await make_page(b, (1440, 900))
        await page.evaluate("ForgeComps.open('733 N Main St, Crown Point, IN 46307', {})")
        await page.wait_for_selector('#ps-comp-bu-retry', timeout=5000)
        check('best use failure shows retry, ARV still shown', (await page.inner_text('.ps-comp-stat.arv .v')) == '$261,000')
        globals()['BEST_USE_FAIL'] = BEST_USE_FAIL_PREV
        await ctx.close()

        # ── Non-admin: nothing changes on the page ──
        ctx, page, calls, errors = await make_page(b, (1440, 900), email='member@example.com')
        check('non-admin: teasers still visible', await page.is_visible('#ps-teaser-lookup') and await page.is_visible('#ps-teaser-comps'))
        check('non-admin: no comp buttons', await page.locator('.ps-comp-lead-btn').count() == 0 and await page.locator('#ps-comp-lookup').count() == 0)
        check('non-admin: no JS errors', not errors, errors)
        await ctx.close()

        # ── Error states ──
        for status, body, expect in [(403, {'error': 'not_empire'}, 'Empire feature'), (402, {'error': 'budget_cap'}, 'paused for this month'),
                                     (404, {'error': 'address_not_found'}, "couldn't find that address"), (401, {'error': 'session_expired'}, 'session expired'),
                                     (502, {'error': 'rentcast_unavailable'}, 'temporarily unavailable'), (429, {'error': 'member_limit'}, 'lookup limit')]:
            ctx, page, calls, errors = await make_page(b, (1440, 900), comp_override=(status, body))
            await page.fill('#ps-comp-street', '1 Test St'); await page.fill('#ps-comp-zip', '46307'); await page.click('#ps-comp-go')
            await page.wait_for_selector('.ps-comp-notice', timeout=5000)
            txt = await page.inner_text('#ps-comp-body')
            check(f'error state {status} {body["error"]}', expect.lower() in txt.lower(), txt[:80])
            if status == 403: await page.screenshot(path=f'{W}/shot-upgrade.png')
            await ctx.close()

        # ── Tablet and phone ──
        for vp in [(768, 1024), (375, 812)]:
            ctx, page, calls, errors = await make_page(b, vp)
            await page.evaluate("ForgeComps.open('733 N Main St, Crown Point, IN 46307', {})")
            await page.wait_for_selector('.ps-comp-stat.arv .v'); await page.wait_for_timeout(400)
            w = await page.evaluate("document.querySelector('.ps-comp-panel').getBoundingClientRect().width")
            check(f'{vp[0]}px: panel is full width', abs(w - vp[0]) < 2, w)
            disp = await page.evaluate("getComputedStyle(document.querySelector('.ps-comp-table thead')).display")
            check(f'{vp[0]}px: table collapses to cards', disp == 'none', disp)
            check(f'{vp[0]}px: filters toggle visible', await page.is_visible('#ps-comp-filters-toggle'))
            small = await page.evaluate("""() => [...document.querySelectorAll('.ps-comp-panel button, .ps-comp-panel select, .ps-comp-panel .ps-comp-hit')]
               .filter(e => e.offsetParent && !e.closest('.ps-comp-filter-sheet') && !e.closest('.leaflet-control') && !e.classList.contains('ps-comp-link'))
               .map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0,20) || e.type, h: Math.round(r.height), w: Math.round(r.width) }; })
               .filter(x => x.h < 44 && x.w < 44)""")
            check(f'{vp[0]}px: tap targets ≥ 44px (except inline links)', not small, small[:5])
            sw = await page.evaluate("document.querySelector('.ps-comp-body').scrollWidth <= document.querySelector('.ps-comp-body').clientWidth + 1")
            check(f'{vp[0]}px: no sideways scroll in panel', sw)
            await page.screenshot(path=f'{W}/shot-{vp[0]}.png', full_page=False)
            await page.click('#ps-comp-filters-toggle'); await page.wait_for_timeout(300)
            check(f'{vp[0]}px: filter bottom sheet opens', await page.evaluate("document.querySelector('#ps-comp-sheet').classList.contains('open')"))
            await page.screenshot(path=f'{W}/shot-{vp[0]}-filters.png', full_page=False)
            await page.click('#ps-comp-sheet-done')   # close the sheet again
            await page.click('#ps-comp-tabbtn-market'); await page.wait_for_selector('#ps-comp-tab-market .ps-comp-chart')
            cols = await page.evaluate("getComputedStyle(document.querySelector('.ps-comp-charts')).gridTemplateColumns.split(' ').length")
            check(f'{vp[0]}px: market charts stack in one column', cols == 1, cols)
            check(f'{vp[0]}px: filters button hidden off the comps tab', not await page.is_visible('#ps-comp-filters-toggle'))
            sw2 = await page.evaluate("document.querySelector('.ps-comp-body').scrollWidth <= document.querySelector('.ps-comp-body').clientWidth + 1")
            check(f'{vp[0]}px: no sideways scroll on market tab', sw2)
            await page.click('#ps-comp-tabbtn-property'); await page.wait_for_timeout(150)
            sw3 = await page.evaluate("document.querySelector('.ps-comp-body').scrollWidth <= document.querySelector('.ps-comp-body').clientWidth + 1")
            check(f'{vp[0]}px: no sideways scroll on property tab', sw3)
            await page.screenshot(path=f'{W}/shot-{vp[0]}-property.png', full_page=False)
            check(f'{vp[0]}px: no JS errors', not errors, errors)
            await ctx.close()
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} UI checks passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
