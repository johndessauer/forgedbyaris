// Serves member HTML and Document Vault files only after membership-check
// confirms a live plan. The Memberstack session lives in localStorage, so
// the first visit has no cookie: this responds with a tiny bootstrap (no
// lesson, calculator, or vault content) that reads the Memberstack cookie
// JWT, stores it as forge_ms, and reloads. The reload is what actually
// receives the page.
//
// Unsigned visitors end on /login.html. Signed-in visitors without a live
// plan end on /signup.html. Deal Network is Empire-only: a Foundation
// member gets a short lock page, not the tool.

import { requireEdgeMembership, tokenFromRequest } from './lib/membership.js';

const MEMBER_APP = 'app_cmr41qq5500q80tsx94pj61rc';

const EMPIRE_ONLY = new Set(['/deal-network', '/deal-network.html']);

function pathnameOf(request) {
  try { return new URL(request.url).pathname; }
  catch (e) { return '/'; }
}

function bootstrapHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>FORGE</title>
<script src="https://static.memberstack.com/scripts/v1/memberstack.js" data-memberstack-app="${MEMBER_APP}" defer></script>
</head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0D1B2A;color:#fff;font-family:Inter,Arial,sans-serif;">
<p>Checking your membership…</p>
<script>
(async function () {
  function wait(max) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function check() {
        if (window.$memberstackDom && window.$memberstackDom.getCurrentMember) resolve(window.$memberstackDom);
        else if (Date.now() - start > max) reject(new Error('timeout'));
        else setTimeout(check, 100);
      })();
    });
  }
  try {
    var ms = await wait(6000);
    var memberRes = await ms.getCurrentMember();
    var member = memberRes && memberRes.data;
    if (!member) { location.replace('/login.html'); return; }
    var token = await ms.getMemberCookie();
    if (!token) { location.replace('/login.html'); return; }
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = 'forge_ms=' + encodeURIComponent(token) + '; Path=/; Max-Age=43200; SameSite=Lax' + secure;
    var res = await fetch('/.netlify/functions/membership-check', { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 403) { location.replace('/signup.html'); return; }
    if (!res.ok) { location.replace('/login.html'); return; }
    // One reload. If the cookie cannot be stored, the next hit within 15s
    // goes to login instead of reloading forever. A later visit can try again.
    var reloadKey = 'forge_gate_reload';
    var prev = (sessionStorage.getItem(reloadKey) || '').split('|');
    var recent = prev[0] === location.pathname && (Date.now() - Number(prev[1] || 0)) < 15000;
    if (recent) {
      sessionStorage.removeItem(reloadKey);
      location.replace('/login.html');
      return;
    }
    sessionStorage.setItem(reloadKey, location.pathname + '|' + Date.now());
    location.reload();
  } catch (e) {
    location.replace('/login.html');
  }
})();
</script>
</body></html>`;
}

function empireLockHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Empire | FORGE</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0D1B2A;color:#fff;font-family:Inter,Arial,sans-serif;">
<div style="max-width:420px;padding:32px;text-align:center;">
<div style="font-size:28px;">🔒</div>
<h1 style="font-size:22px;letter-spacing:1px;">Empire content</h1>
<p style="color:#c9d2dc;line-height:1.5;">Deal Network is part of Empire. Your current plan does not include it.</p>
<p><a href="/profile.html#empire-section" style="color:#FF6B2B;">See what's in Empire</a></p>
<p><a href="/dashboard.html" style="color:#c9d2dc;">Back to dashboard</a></p>
</div>
</body></html>`;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}

export default async function handler(request, context) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return context.next();
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;

  // No cookie yet: the bootstrap reads the Memberstack session (localStorage)
  // and either sets forge_ms and reloads, or sends the visitor to login.html.
  if (!tokenFromRequest(request)) return htmlResponse(bootstrapHtml());

  const access = await requireEdgeMembership(request, { origin, need: 'member' });
  if (!access.ok) {
    if (access.status === 403) return Response.redirect(origin + '/signup.html', 302);
    // Expired cookie: bootstrap can replace it from the live Memberstack session.
    return htmlResponse(bootstrapHtml());
  }

  if (EMPIRE_ONLY.has(path) && !access.empire) {
    return htmlResponse(empireLockHtml());
  }

  const res = await context.next();
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(res.body, { status: res.status, headers });
}

export const config = {
  path: [
    '/dashboard', '/dashboard.html',
    '/crm', '/crm.html',
    '/deal-analyzer', '/deal-analyzer.html',
    '/deal-network', '/deal-network.html',
    '/capital-radar', '/capital-radar.html',
    '/market-oracle', '/market-oracle.html',
    '/education', '/education.html',
    '/document-vault', '/document-vault.html',
    '/aris-coach', '/aris-coach.html',
    '/profile', '/profile.html',
    '/property-search', '/property-search.html',
    '/real-estate-lab', '/real-estate-lab.html',
    '/docs/*',
  ],
};
