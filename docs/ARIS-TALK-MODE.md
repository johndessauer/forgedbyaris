# ARIS Talk Mode

Talk Mode is a hands-free conversation on the ARIS coach page (`aris-coach.html` only). The member taps once, talks, and hears ARIS answer in the voice the coach already uses. Typing, uploads, and the click-to-play speaker stay available.

The control is hidden after merge until John turns it on for himself, then a trial list, then everyone.

This file is internal. It is not linked from the site.

## What members see

- A Talk control next to the existing microphone.
- A status line: Listening, Thinking, or Speaking.
- If they talk over ARIS, playback stops and that speech becomes the next turn.
- After 2 minutes with no member speech (configurable, 2–3 minutes), Talk Mode pauses. The microphone turns off, playback stops, and minutes stop counting. The control reads: Talk Mode paused — tap to resume. About 15 seconds before that, ARIS shows a note and speaks a short heads-up.
- At the monthly cap, Talk Mode stops. Typing and the speaker button still work.
- Spoken turns are saved as text in the same chat. Audio is not stored.
- Member-facing text says ARIS, Talk Mode, and the microphone only.

The dashboard Ask ARIS box is unchanged.

## What John runs before any live test

Netlify does not apply SQL on deploy. In the Supabase SQL editor, run:

`sql/migrations/add-aris-talk-usage.sql`

Safe to run more than once. Until it has been run, an allowlisted member still will not see Talk Mode (the page hides the control if usage cannot be read).

## Environment variables

Set these in Netlify. None are required for the merge. Defaults keep Talk Mode off.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TALK_MODE_ENABLED` | off | `true`, `1`, `on`, or `yes` shows Talk Mode to every member. Anything else, including unset, hides it. |
| `TALK_MODE_ALLOWLIST` | empty | Comma-separated Memberstack member ids and/or emails who see Talk Mode while the global flag is off. Example: `mem_abc123, john@thedessauergroup.com` |
| `TALK_MODE_UNLIMITED` | empty | Same comma list of Memberstack ids and/or emails. Those members skip the monthly cap. Their minutes are still stored. Unset means everyone is capped. |
| `ARIS_TALK_CAP_MINUTES` | `30` | Per-member cap for the UTC month. Counts listening time and speaking time. Paused time is not counted. `0` blocks Talk Mode. Ignored for members on `TALK_MODE_UNLIMITED`. |
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
       listen_seconds + speak_seconds as total_seconds,
       updated_at
from public.aris_talk_usage
where month_key = to_char(now() at time zone 'utc', 'YYYY-MM')
order by total_seconds desc;

select * from public.aris_talk_usage_totals;
select * from public.aris_talk_alert_log order by flagged_at desc;
```

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

### Cap

With John's OK, set `ARIS_TALK_CAP_MINUTES` to `1` for the test only. Talk until the minute is used. Confirm the cap note, that Talk Mode stops, and that typing and the speaker button still work. Set the variable back to `30` (or unset it) before anyone else uses Talk Mode.

### Flag

- Allowlisted account sees Talk. A normal member account does not.
- After the trial, `TALK_MODE_ENABLED=true` shows Talk to a normal member. Unset it again if you need to hide Talk.

### History

After a spoken exchange, reload the coach. The words you said and ARIS's reply are in the chat as text. No audio file is saved.
