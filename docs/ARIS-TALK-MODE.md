# ARIS Talk Mode

Talk Mode is a hands-free conversation on the ARIS coach page (`aris-coach.html` only). The member taps once, talks, and hears ARIS answer in the voice the coach already uses. Typing, uploads, and the click-to-play speaker stay available.

The control is hidden after merge until John turns it on for himself, then a trial list, then everyone.

This file is internal. It is not linked from the site.

## What members see

- A Talk control next to the existing microphone.
- A status line: Listening, Thinking, or Speaking. Below Mogul the status also says: Your turn — tap Talk.
- Mogul (and anyone on `TALK_MODE_UNLIMITED`) gets the hands-free loop. If they talk over ARIS, playback stops and that speech becomes the next turn.
- Below Mogul, Talk Mode is turn-taking. The member taps Talk, speaks, and the microphone closes while ARIS answers. There is no barge-in and the microphone is not left open. They tap Talk again for the next turn.
- After 2 minutes with no member speech during a listening turn (configurable, 2–3 minutes), Talk Mode pauses. The microphone turns off, playback stops, and minutes stop counting. The control reads: Talk Mode paused — tap to resume. About 15 seconds before that, ARIS shows a note and speaks a short heads-up.
- At 90% and 95% of the monthly cap, ARIS posts a short heads-up in the chat. At the cap, Talk Mode stops. Typing and the speaker button still work. A student who has hit the cap can add 60 minutes for $19.97. That button is hidden until the cap is hit. The extra minutes count for the current month only.
- Spoken turns are saved as text in the same chat. Audio is not stored.
- Member-facing text says ARIS, Talk Mode, and the microphone only.

The dashboard Ask ARIS box is unchanged.

## What John runs before any live test

Netlify does not apply SQL on deploy. In the Supabase SQL editor, run:

`sql/migrations/add-aris-talk-usage.sql`

Then, for the Mogul cap and the extra-minutes pack:

`sql/migrations/add-aris-talk-packs.sql`

Safe to run more than once. Run the usage file first. Until the usage file has been run, an allowlisted member still will not see Talk Mode (the page hides the control if usage cannot be read). Until the pack file has been run, Talk Mode still works and the extra-minutes button stays unavailable.

## Environment variables

Set these in Netlify. None are required for the merge. Defaults keep Talk Mode off.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TALK_MODE_ENABLED` | off | `true`, `1`, `on`, or `yes` shows Talk Mode to every member. Anything else, including unset, hides it. |
| `TALK_MODE_ALLOWLIST` | empty | Comma-separated Memberstack member ids and/or emails who see Talk Mode while the global flag is off. Example: `mem_abc123, john@thedessauergroup.com` |
| `TALK_MODE_UNLIMITED` | empty | Same comma list of Memberstack ids and/or emails. Those members skip the monthly cap, the Mogul check, and the extra-minutes pack. They keep hands-free Talk Mode. Their minutes are still stored. Unset means everyone is capped. |
| `TALK_MOGUL_MEMBER_IDS` | empty | Comma-separated Memberstack ids and/or emails treated as Mogul, for testing. This does not replace the education badge. |
| `ARIS_TALK_CAP_MINUTES` | `30` | Monthly cap for a student who is not Mogul. Counts listening time and speaking time. Paused time and the gap between turns are not counted. `0` blocks Talk Mode. Mogul students get 600 minutes instead. Ignored for members on `TALK_MODE_UNLIMITED`. |
| `TALK_PACK_LIVE_CHECKOUT` | off | Must be the string `true` before a live secret key is accepted for the extra-minutes pack. Leave it unset. The pack stays in test mode. |
| `TALK_PACK_STRIPE_WEBHOOK_SECRET` | empty | Signing secret for the test-mode webhook endpoint described below. The pack is not credited until this is set. |
| `MARKETING_STRIPE_SECRET_KEY` | empty | Same secret the skip-trace pack already uses. For this pack it must be a test key (`sk_test_` or `rk_test_`) unless `TALK_PACK_LIVE_CHECKOUT` is `true`. |
| `ARIS_TALK_IDLE_SECONDS` | `120` | Silence before pause. Values outside 120–180 are clamped into that range. |
| `ARIS_TALK_ALERT_MINUTES` | `300` | When all members' Talk Mode seconds this UTC month reach this many minutes, the function writes one `aris_talk_alert_log` row and one `ARIS_TALK_ALERT` line to the function log. `0` turns the flag off. |

No new vendor and no new paid plan.

## Rollout

1. Merge the pull request. Leave `TALK_MODE_ENABLED` unset. Talk Mode stays hidden for members.
2. Run the SQL migration above.
3. Put John's Memberstack id or email in `TALK_MODE_ALLOWLIST`. Leave the global flag off.
4. John runs the live checklist below on production. Memberstack login does not work on Netlify preview deploys.
5. Add the opt-in trial members to `TALK_MODE_ALLOWLIST`.
6. When the trial looks right, set `TALK_MODE_ENABLED` to `true`.
7. Watch minutes in Supabase and the `ARIS_TALK_ALERT` log. Only then consider a wider change.

To see usage:

```sql
select memberstack_id,
       listen_seconds,
       speak_seconds,
       pack_seconds,
       listen_seconds + speak_seconds as total_seconds,
       updated_at
from public.aris_talk_usage
where month_key = to_char(now() at time zone 'utc', 'YYYY-MM')
order by total_seconds desc;

select * from public.aris_talk_usage_totals;
select * from public.aris_talk_alert_log order by flagged_at desc;
select * from public.aris_talk_pack_credits order by created_at desc;
```

`pack_seconds` is the extra time bought for that month. The totals view includes it after `add-aris-talk-packs.sql`.

## Who counts as Mogul

Hands-free Talk Mode and the 600-minute cap use `isMogul()` in `assets/js/aris-talk.js`.

What exists in this repo:

- FORGE education stores Rookie, Investor, and Mogul in `education_level_awards` (`level = 'mogul'`). That badge is earned by passing the Mogul topics. `isMogul()` treats a stored Mogul row as Mogul.
- Memberstack plans are Foundation and Empire. There is no Mogul plan and no Mogul custom field.
- realwiseacademy.com is not in this repository. There is no REALWISE progression table, API, or member field to read.

`TALK_MOGUL_MEMBER_IDS` forces Mogul for the listed ids or emails so John can test without a badge. Anyone on `TALK_MODE_UNLIMITED` stays hands-free and uncapped either way.

If the Mogul John means is a progression that lives only on the REALWISE site, that source is still missing. Wire it into `isMogul()` and leave the rest of Talk Mode alone.

## Extra minutes

60 minutes for $19.97, one charge, for the current UTC month only. The button is shown only after the student has hit the cap. A second pack is offered only after those minutes are used too. Tax is not calculated: `automatic_tax` is off, and the checkout request does not send `tax_behavior` or a tax code.

The site creates a Checkout Session with inline `price_data` when a qualifying student taps the button. The test-mode product `prod_Vi0PsLX2Yfw3y9` and price `price_1UgaOnK4zh6RSWCry84qZAnS` are stored as metadata only. No pre-made payment link is required.

`TALK_PACK_LIVE_CHECKOUT` defaults to off, the same idea as `SKIP_TRACE_LIVE_CHECKOUT`. Leave it unset so only test keys work.

### Webhook John adds in the Stripe test dashboard

1. Open the FORGE Stripe account in test mode. Do not do this in live mode.
2. Add an endpoint: `https://forgedbyaris.com/api/aris-talk-pack-webhook`
3. Send the event `checkout.session.completed`.
4. Copy the signing secret into Netlify as `TALK_PACK_STRIPE_WEBHOOK_SECRET`.
5. Confirm `MARKETING_STRIPE_SECRET_KEY` is a test key, and leave `TALK_PACK_LIVE_CHECKOUT` unset.
6. Run `sql/migrations/add-aris-talk-packs.sql` if it has not been run.

The webhook credits `pack_seconds` on `aris_talk_usage` for the month that was current when checkout started, and writes one row in `aris_talk_pack_credits`. The same session id does not credit twice.

## Alert hook (no email is sent by this code)

The function does not send email, and it does not call a mail provider.

When the monthly total crosses `ARIS_TALK_ALERT_MINUTES`, it:

1. Inserts one row into `public.aris_talk_alert_log` (one row per UTC month per threshold).
2. Writes a log line like `ARIS_TALK_ALERT month=2026-11 totalSeconds=18000 totalMinutes=300 thresholdMinutes=300 note=log-only-no-email`.

To email John and Simon later, pick one of these. Do it only after John says to:

- Netlify log alert: notify on the text `ARIS_TALK_ALERT`. Send it to John (`john@thedessauergroup.com`, `jdessauer@antonagency.com`) and to Simon (the same address already used in `COMPS_ALERT_EMAILS`).
- Supabase database webhook on `INSERT` into `aris_talk_alert_log`, pointed at the same GoHighLevel workflow pattern as the comping-engine budget alerts (`docs/handoffs/2026-10-12-comping-engine.md`). That workflow already emails John and Simon. This repo does not add that webhook.

## Live test checklist (after merge, on the production site)

Sign in on https://forgedbyaris.com (not a Netlify preview). Use an account that is on `TALK_MODE_ALLOWLIST`, with the migration applied and the global flag still off. Confirm a second account that is not on the list does not see Talk.

### iPhone Safari (required)

1. Open the ARIS coach. Confirm a Talk control sits next to the microphone. Tap it once.
2. Allow the microphone if asked. That same tap must unlock playback. Ask a short question and wait.
3. Confirm the status moves Listening, then Thinking, then Speaking, and you hear ARIS without tapping the speaker button.
4. Barge-in: while ARIS is mid-sentence, talk over the reply. Playback must stop. Your new words must be the next turn (ARIS answers those words, not the interrupted question). After that reply finishes, status returns to Listening and a further question works without tapping the microphone again. Repeat once, to confirm listening still starts after the second playback.
5. Idle: stay quiet. Around 1 minute 45 seconds, confirm the heads-up. At about 2 minutes, confirm the microphone is off and the control says Talk Mode paused — tap to resume. Wait another minute and confirm no new listening is happening. Tap the control once and confirm the loop starts again, including playback.
6. Leave Talk Mode with End. Type a message and send it. Upload still opens. Tap the speaker on a finished reply and confirm it plays.
7. Lock the phone or switch apps during Talk Mode. Confirm Talk Mode pauses and the microphone is released. Unlock, tap resume, and confirm it listens again.

### Desktop

Repeat the permission, listen, spoken reply, barge-in, idle pause, resume, and typed-message checks on:

- Chrome
- Safari
- Firefox
- Edge

Firefox and Safari do not use the browser's built-in speech recognizer. Each of them should still transcribe through the same path as the existing microphone button.

### Cap, Mogul, and the extra-minutes pack

Use an account that is not on `TALK_MODE_UNLIMITED`. That list skips the cap and the pack.

Card for the pack, test mode only: `4242 4242 4242 4242`, any future expiry, any CVC, any postal code.

Below Mogul (no education Mogul badge, and not listed in `TALK_MOGUL_MEMBER_IDS`):

1. Tap Talk, speak one sentence, and wait. The microphone must close while ARIS answers. The status then says: Your turn — tap Talk. Talking over ARIS must not cut the reply off.
2. Tap Talk again and confirm the next turn works.

Mogul (either the education badge or `TALK_MOGUL_MEMBER_IDS`):

1. Confirm the hands-free loop, including barge-in, still works.
2. On the status response, `capSeconds` is 36000 (600 minutes) before any pack. Do not burn 600 minutes in a live test. The unit tests cover the stop.

Cap and pack, with John's OK:

1. Set `ARIS_TALK_CAP_MINUTES` to `1` for the test only. This changes the cap for every non-Mogul student, so do it in a quiet window and set it back to `30` (or unset it) as soon as the test is done. Mogul students stay at 600.
2. Talk until the minute is used. A heads-up can show in the chat as that minute fills (90%, then 95%). At the cap, Talk Mode stops. Typing and the speaker button still work.
3. Confirm the button: Add 60 more minutes this month for $19.97. It must not be visible before the cap.
4. Tap it. Pay with the test card above. The page returns to the coach. Refresh if the minutes are not there yet. Talk Mode works again. In Supabase, `pack_seconds` for this month is 3600 and `aris_talk_pack_credits` has one row.
5. Set `ARIS_TALK_CAP_MINUTES` back to `30`.

Memberstack login does not work on a Netlify preview. Do this on https://forgedbyaris.com after merge.

### Flag

- Allowlisted account sees Talk. A normal member account does not.
- After the trial, `TALK_MODE_ENABLED=true` shows Talk to a normal member. Unset it again if you need to hide Talk.

### History

After a spoken exchange, reload the coach. The words you said and ARIS's reply are in the chat as text. No audio file is saved.
