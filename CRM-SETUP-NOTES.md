# FORGE Native CRM — Backend Setup Notes

## Files in this delivery

```
schema.sql                              — run in Supabase SQL editor
netlify/functions/_lib/verify-member.js — Memberstack token verification
netlify/functions/_lib/supabase-client.js — shared Supabase client
netlify/functions/_lib/http.js          — shared CORS/response helpers
netlify/functions/crm-contacts.js       — contacts CRUD
netlify/functions/crm-deals.js          — deals CRUD + stage moves + summary
netlify/functions/crm-notes.js          — notes create/list
```

## New npm dependencies

```
npm install @supabase/supabase-js @memberstack/admin
```

## New Netlify environment variables required

| Variable | Where to get it | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase project settings | e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project API settings | **Service role key, not anon key.** Server-side only, never expose to client. |
| `MEMBERSTACK_SECRET_KEY` | Memberstack Dev Tools page | Starts with `sk_...`. Server-side only. |
| `MEMBERSTACK_APP_ID` | Memberstack app settings | Optional but recommended — enables audience validation on tokens. |

## Required client-side change (important — not yet done anywhere in the codebase)

Every request to `crm-contacts`, `crm-deals`, and `crm-notes` must include the
member's Memberstack token in an `Authorization: Bearer <token>` header.

Currently, `dashboard.html` only calls `memberstack.getCurrentMember()` to
read membership status client-side — it does not retrieve or send a token
anywhere, because nothing server-side has needed one before now.

To get the token, use Memberstack's DOM SDK, e.g.:

```js
const { data } = await window.$memberstackDom.getMemberCookie
  ? { data: window.$memberstackDom.getMemberCookie() }
  : await window.$memberstackDom.getCurrentMember();
// Confirm the exact method name against the current DOM package version —
// Memberstack's docs reference member token retrieval via the DOM package;
// verify against your installed version before wiring this in.
```

Then on every CRM fetch call:

```js
fetch('/api/crm-deals?action=list', {
  headers: { Authorization: `Bearer ${token}` }
});
```

**Flag before build continues:** the exact DOM SDK method for retrieving a
usable member token should be confirmed against Memberstack's current docs
for the installed package version — don't guess this at the wiring stage.

## Netlify redirects

Add to `netlify.toml`, matching the existing `/api/aris-quote` pattern:

```toml
[[redirects]]
  from = "/api/crm-contacts"
  to = "/.netlify/functions/crm-contacts"
  status = 200

[[redirects]]
  from = "/api/crm-deals"
  to = "/.netlify/functions/crm-deals"
  status = 200

[[redirects]]
  from = "/api/crm-notes"
  to = "/.netlify/functions/crm-notes"
  status = 200
```

## Scope note

These three functions are the only part of the FORGE backend that verify
Memberstack tokens server-side right now. Every other existing function
(`aris-quote.js`, `waitlist-subscribe.js`, etc.) still relies on client-side
membership gating only. Per discussion, this is scoped to CRM-only for now;
retrofitting server-side verification across the rest of the platform is a
flagged follow-on task, not done here.

## Not yet done (follow-on work, separate from this delivery)

- ARIS tool-use wiring in `aris-stream.js` (read + confirmed-write functions)
- Frontend CRM UI (pipeline/kanban view, contact list, note entry)
- Wiring the client-side token retrieval described above into `dashboard.html`
  and any new CRM pages
- Platform-wide Memberstack token verification retrofit (flagged, not scoped here)
