# ARIS Talk Mode: mobile full-duplex plan

Internal. Not linked from the site. Do not paste vendor names, model names, or bug titles into student-facing copy. Students see ARIS, Talk Mode, and the microphone only.

This is a research and sequencing note. It does not change runtime behavior. Read it against `origin/main` at `c0504fc` (Talk Mode playback echo guard, pull request 142).

## What this plan leaves alone

Another agent is fixing later-turn stalls: a reply that never returns to Listening on the second or third turn, a state watchdog, and trimming coach history. As of this writing that work has no open pull request. The only open pull request on the repo is 3 (Apartment Confidential book lead), which is unrelated.

Do not add a second watchdog, do not retune history or `trimMessagesToBudget`, and do not rewrite the coach turn state machine in `createTalkSession` as part of the audio work. Both efforts will touch `assets/js/aris-talk-session.js`. Land the stall fix first, then rebase the audio work onto it.

Pull requests 140, 141, and 142 already fixed a different set of iPhone failures: questions cut off mid-sentence, Talk Mode pausing on a one-frame hide event, barge-in that never fired, and barge-in that fired on speaker echo. This plan starts from that code. It does not reopen those patches.

## 1. Current audio architecture

Talk Mode is a hands-free loop on the coach page only (`aris-coach.html`). One tap starts it. The member talks, the page turns that audio into text, the existing coach stream answers, and the existing voice path speaks the answer one sentence at a time. The microphone stays open during the answer so the member can interrupt. Typing, uploads, and the speaker button stay available.

```text
tap
  -> unlock AudioContext + a one-shot silent HTML audio clip
  -> getUserMedia (echo cancellation, noise suppression, auto gain)
  -> one AnalyserNode on that same AudioContext
  -> requestAnimationFrame reads RMS levels

listening
  -> MediaRecorder on the mic stream
  -> 1.8 s of quiet ends the utterance
  -> POST /api/aris-transcribe (batch speech-to-text)
  -> page.sendText, the same path as a typed message
  -> POST /api/aris-stream (coach model, tools, research)

speaking
  -> split the stream into sentences
  -> prefetch two clips from POST /api/aris-voice
  -> buffer the whole mp3, decodeAudioData, schedule BufferSource
  -> mic still open
  -> interruption: ignore 300 ms at each sentence start,
     learn the level coming back from the speaker,
     require 2.5x that level for 500 ms,
     transcribe that clip, reject it if it is empty or mostly the sentence just spoken,
     only then stop playback and keep recording the new utterance
```

### Browser pieces

All of this lives in `assets/js/aris-talk.js` (pure decisions) and `assets/js/aris-talk-session.js` (mic, recorder, playback).

- One `AudioContext` (`unlockCtx`) is created on the tap, before the microphone promise resolves. The same context later decodes and plays speech.
- The microphone is one `MediaStream` for the whole active session. Tracks are stopped when Talk Mode pauses, ends, hits the cap, or fails. Pause also happens when the page stays hidden for 2 seconds (`HIDE_PAUSE_MS`). A brief `visibilitychange` or `pagehide` does not pause. That grace is from pull request 140: iOS fires those events when the mic and playback share a session.
- Voice activity for normal turns is an RMS threshold on analyser frames (`speechRms` 0.045, four frames, then 1.8 s of quiet, minimum utterance 280 ms). The analyser path is the one that shipped. The older script-processor WAV capture is still in the logic file and is not wired up. Pull request 140 removed it from the session because iOS exposes `ScriptProcessor` and then stops feeding it, and connecting that node to the output (even muted) fought the microphone session.
- `MediaRecorder` is constructed with no MIME type, so the browser picks. It is started with a 200 ms timeslice when the browser allows it. The recorder is stopped and started again per utterance. While ARIS is speaking, the first loud frames only arm a recorder; they do not stop playback.
- Playback is gapless-ish: 15 ms fades and a 12 ms crossfade, two sentences prefetched, previous/next text sent so prosody continues. A failed spoken sentence is skipped. The edge function already streams mp3 from the voice vendor, but the browser waits for `arrayBuffer()` of the whole clip before `decodeAudioData`. Time-to-first-audio is "the whole sentence encoded," not "the first audio frame."
- There is no `navigator.audioSession` use, no `AudioWorklet`, no WebRTC peer connection, and no streaming recognizer.

### Server pieces

- `netlify/edge-functions/aris-voice.js` calls the low-latency Flash speech model (`eleven_flash_v2_5`) at `/v1/text-to-speech/{voice}/stream`, asks for `audio/mpeg`, and passes the body through. Voice id, pronunciation dictionary, and voice settings are hardcoded. The API key is `ELEVENLABS_API_KEY`. Neighboring sentences go up as `previous_text` / `next_text`.
- `netlify/edge-functions/aris-transcribe.js` posts the clip to `/v1/speech-to-text` as multipart. It tries `scribe_v2` with the keyterm `ARIS`, and on failure retries `scribe_v1` with no keyterms. iOS `audio/mp4` and `audio/aac` are uploaded as `clip.mp4`. Bracketed non-speech tags are stripped. A clipped "ARIS" at the start is rewritten in `lib/aris-heard-name.js`. Nothing is stored. The comment at the top of that file is explicit: this is turn-based, not a live call.
- `netlify/edge-functions/aris-stream.js` is the coach. Talk Mode does not have its own model. Default model is `claude-sonnet-4-6`, `max_tokens` 2200. A research turn can emit a status line before the search finishes so Talk Mode can speak "let me research that" while the lookup runs. History trimming already happens here via `trimMessagesToBudget`. Leave that function to the stall-fix agent.
- `netlify/functions/aris-talk.js` is the gate and the minute meter (listen seconds plus speak seconds, UTC month, default cap 30 minutes, idle 120–180 seconds). `TALK_MODE_ENABLED` and `TALK_MODE_ALLOWLIST` hide it until John turns it on. `TALK_MODE_UNLIMITED` skips the cap for listed members and still stores minutes. No new vendor and no new paid plan were added for Talk Mode.

### Why it still feels like a radio, even though both sides are "on"

The mic and the speaker are open together. That is not the same as a conversation. A turn cannot start until 1.8 seconds of quiet. An interruption cannot stop the speaker until a loud stretch has held for half a second and a full transcription has come back. Empty text is treated as echo (`interruptionIsEcho` returns true when the heard text is blank), so a bad clip never cuts in. During that transcription, playback keeps going. On a phone, the member talks over ARIS for the whole round trip and only then hears the answer stop, if it stops at all.

Rough happy-path delay before ARIS starts a normal answer, ignoring the model:

| Step | What the member waits through |
| --- | --- |
| End of speech | 1.8 s fixed quiet |
| Recorder stop and upload | a short clip, then the edge hop |
| Batch transcription | usually well under 2 s; a keyterm failure repeats the call on the older model |
| Coach time to first sentence | model latency, plus a search when the turn is a real outside fact |
| First spoken sentence | the whole mp3 is buffered and decoded before any sample plays |

Desktop hides this better because echo cancellation actually removes the speaker from the mic, so the interruption logic rarely misfires. The phone does not.

## 2. iPhone Safari

John's report matches the platform, not a single bug in the threshold constants. Safari on iOS runs the microphone through a voice-call audio session. Web pages do not get to set `AVAudioSession` directly. What they get is `getUserMedia`, Web Audio, and, since Safari 16.4, `navigator.audioSession.type` (`auto`, `ambient`, `playback`, `play-and-record`). Talk Mode uses none of the session API. It asks for echo cancellation and hopes.

### Session type, earpiece, and volume

Opening the mic flips the page from the default ambient/playback session into play-and-record. That is the category a phone call uses.

- With echo cancellation on, iOS engages voice-processing I/O. Control Center shows a phone-call route. Hardware buttons control call volume, not media volume. Output is usually the loudspeaker, but the processing is the call path: mono, a lower internal rate on some routes (48 kHz hardware dropping toward 24 kHz), automatic gain, and a volume floor. Speech sounds like a call, not like a podcast. That alone makes Talk Mode feel stiff next to MacBook Chrome, where the same mp3 plays as media.
- With echo cancellation off, playback is cleaner and often louder as media, but WebKit routes it to the receiver (the earpiece) at a much lower level. Confirmed on iOS 27 test pages: echo cancellation off is clean and quiet at the ear; echo cancellation on is the loudspeaker and, on iOS 27.0 and 27.0.1, crackles. The crackle is gone on iOS 27.2. It is in WebKit bug 326286. A native app using play-and-record plus default-to-speaker, without voice processing, plays cleanly on the same phones. The web cannot select that combination. Echo cancellation is the switch that picks voice processing.
- A context created before `getUserMedia` resolves, which is what `unlockAudio()` does, can keep the old sample rate across the session flip and glitch afterward. The analyser is attached after the stream exists, but it is attached to the earlier context.
- `resume()` is only called for `suspended`. iOS uses a fourth state, `interrupted`, for a route change, a call, the screen lock, or a tab switch. A frozen context still accepts `start()` calls. `currentTime` does not move, and queued buffers fire in a pile when the clock restarts. Talk Mode never listens for `statechange`.

### Echo cancellation does not cover this playback path

Pull request 142 states the field result: on an iPhone, echo cancellation does not keep the speaker out of the mic, and about 60–80 ms of a sentence attack is enough to look like speech. That is why the barge watch ignores the first 300 ms of each sentence, learns a baseline, and demands 2.5 times that baseline (floor 0.1 RMS) for 500 ms, then a transcript.

Voice-processing echo cancellation subtracts audio rendered through the same voice-processing unit. It is built for a remote call track. Talk Mode plays local mp3 buffers into `AudioContext.destination`. On speakerphone the mic is a few centimeters from the loudspeaker, the speaker distorts, and the linear canceller cannot keep up at the start of each sentence. The residual is still speech-shaped, so a neural voice-activity model would also call it speech. Level gates and "transcribe, then see if the words match" are compensating for a missing reference signal. They work as a safety interlock. They cannot feel like interrupting a person.

The 300 ms grace also means the member cannot cut in at the start of any sentence. A long coaching answer is many sentences, so the door keeps closing.

### Autoplay and resume

iOS will not start audio without a user gesture. The Talk control's click is that gesture: it resumes the context, plays a one-sample buffer, and plays a tiny silent WAV through an `HTMLAudioElement`. That is the right shape, with two holes.

- The silent element is one shot. The old workaround for the ringer switch only holds if that element keeps looping. A one-shot does not.
- After an interruption, `resume()` from a timer or from `requestAnimationFrame` is outside a gesture. Safari often leaves the context interrupted until the next tap. The member hears nothing and the mic looks open. The status can still say Listening. That is a later-turn failure that looks like a stuck state machine and is not the watchdog the other agent is adding.

### MediaRecorder

Safari records AAC in an MP4 container (`audio/mp4`), not Opus in WebM. The transcribe function already maps that to `clip.mp4`. Constructing `MediaRecorder` with no MIME type is correct; forcing `audio/webm` throws on iOS.

`recorder.start(200)` asks for a blob every 200 ms. WebM handles that as clusters. Fragmented MP4 often does not. The barge path concatenates those chunks and uploads them before the utterance is finished. If the fragment is not a file the recognizer can read, the transcript comes back empty, and empty is classified as echo, so a real interruption is rejected and ARIS keeps talking. That path needs a phone test. If it fails, start the iOS recorder with no timeslice and only upload a clip from `stop()`.

Stopping and restarting a recorder on the same iOS stream is brittle across route changes. An AirPods connect, or the session flip itself, can end the track or yield a silent blob. The session releases the stream on pause, which is right for privacy and for the minute meter. It also means resume is a new `getUserMedia`, which on iOS can prompt again or can switch devices.

### Silent switch

Web Audio's default session type is ambient, and the ringer switch mutes ambient Web Audio while an `HTMLAudioElement` keeps playing. `AudioContext.state` stays `running`. There is no error. Setting `navigator.audioSession.type = 'playback'` opts out of the ringer, and it also makes `getUserMedia` reject with `InvalidStateError` ("category is not compatible with audio capture"). If a capture is already live and the type is changed away from `play-and-record` or `auto`, the spec says to end the track.

So the silent switch and the microphone are in conflict if handled naively. Once Talk Mode is in play-and-record, the ringer usually does not mute ARIS, because a call session ignores it. A member who hears nothing during Talk Mode is more likely on the earpiece, on call volume at zero, or on an interrupted context than on the red mute switch. After Talk Mode releases the mic, the session can stay in play-and-record and the rest of the site sounds like a phone call until the type is set back to `playback` and then `auto`.

### Backgrounding and screen lock

iOS mutes the capture track when the page is hidden. `visibilitychange` fires, the track gets a `mute` event, and on return an `unmute`. The `AudioContext` often stays `running` or goes `interrupted`. Safari will not keep a website microphone alive across the lock screen. A home-screen web app does not change this unless a native shell has the background-audio mode, which a website cannot declare.

Pull request 140's 2 second hide grace is the right product behavior: a flicker during playback must not pause, and a real lock must pause, release the mic, and stop the minute meter. The audio plan should keep that. It should also treat `track.mute` while the page is still visible as a route glitch, not as 1.8 seconds of silence that ends the turn.

### Bluetooth and AirPods

`getUserMedia({audio:true})` on iOS often captures the iPhone microphone and moves output to the loudspeaker even when AirPods are connected. WebKit bug 282939. Wired headsets sometimes play out of the headset while the iPhone mic stays selected. The workaround that has held up in the field:

1. Set `navigator.audioSession.type = 'auto'`.
2. Call `getUserMedia`.
3. Then set `navigator.audioSession.type = 'play-and-record'`.

Doing step 3 before step 2 is unreliable. After the tracks are stopped, set `playback` and then `auto` immediately, or the page stays in the degraded call session.

When the headset mic is actually selected, iOS drops Bluetooth from high-quality A2DP playback to the hands-free profile (SCO): mono, narrow band or 16 kHz wide band, and extra delay on the order of 100–200 ms. ARIS will sound like a phone call in the AirPods. Echo cancellation is often better than the loudspeaker, because the mic is not sitting on the speaker. Barge-in may work on AirPods and fail on the bare phone. The test matrix has to cover both. The web cannot ask iOS to keep A2DP and the headset mic at the same time. That is a Bluetooth profile limit, not a JavaScript limit.

## 3. Android Chrome

Android is closer to a real duplex conversation than iOS, and it is not MacBook Chrome.

### Echo cancellation

Chrome's software canceller is AEC3. On Android it uses a hardware canceller when the device has one, and AEC3 otherwise. There is no page-level way to pick. Quality tracks the device:

- Recent Pixels and recent Samsung phones usually cancel a voice assistant well enough that a level gate can be loose.
- Mid-range and low-end chipsets often have a weak or missing hardware canceller. Double-talk is the failure mode: either the member's voice is chopped when they talk over playback, or the speaker leaks into the transcript. Both feel like a walkie-talkie.
- The neural residual-echo model that Chrome on desktop downloads is not in Android Chrome. Do not expect the laptop result on a phone because both say Chrome.

`echoCancellation: false` has made recordings nearly silent on some Android Chrome versions, because automatic gain and noise suppression follow that flag. Leave the constraint at the browser default (`true`) unless a specific device is measured.

`getUserMedia` puts Chrome into communication mode. Hardware volume buttons then change call volume, not media volume (tracked against Chrome on Pixel, Samsung, and OnePlus). ARIS can come out too quiet until the member finds the in-call slider. Same symptom as iOS, different control.

### Opus and WebM

Android Chrome's `MediaRecorder` supports `audio/webm;codecs=opus`. That is the right type to pass explicitly there. Opus is what the batch recognizer handles most easily, and the files are smaller than iOS AAC. Do not assume that MIME on Safari. Feature-detect, in order: `audio/webm;codecs=opus`, then `audio/mp4`, then a bare `MediaRecorder`.

Timeslice is safe on WebM. It is the iOS MP4 path that is suspect.

### Audio focus and Bluetooth

Android lets one app hold audio focus. Chrome requests it for capture-plus-playback. From Android 12 on, the system enforces focus: a navigation prompt or another app fades or pauses Chrome. Notifications duck. A cellular call takes the session. The page usually sees this as an `HTMLMediaElement` pause, an `AudioContext` going `interrupted`, or a silent gap, not as a clean error. Talk Mode does not handle focus loss. A ducked answer looks like ARIS trailed off, and the 1.8 second quiet timer can then submit a half utterance.

Screen off and a backgrounded tab stop the mic. Treat that like iOS hide: pause Talk Mode, release the track, stop the meter.

Bluetooth headsets switch from A2DP to SCO when Chrome opens a Bluetooth input. Chrome does this on purpose so the headset mic and speaker stay on one profile. Playback quality drops to voice-call quality for the duration of the capture and returns to A2DP when the mic track stops. Expect the same "phone call in the earbuds" result as AirPods, including the extra delay that makes barge-in late.

## 4. Desktop, for comparison

MacBook Chrome is the best of the four targets, and it is still the same turn-based loop.

- Desktop Chrome runs AEC3 plus a neural residual-echo model shipped to Chrome profiles (not to Edge, not to Electron, not to Firefox, not to Safari, not to mobile Chrome). On hard double-talk it adds several decibels of echo suppression and cuts the transcription error rate on the near-end talker roughly in half, without chopping the near-end level. The laptop speaker is the case where this model helps most. That is why the same thresholds feel calm on John's MacBook and frantic on the iPhone.
- The `AudioContext` stays running across a long answer. There is no ringer switch, no earpiece, and no play-and-record sample-rate flip. `resume()` after a gesture sticks.
- `MediaRecorder` is Opus in WebM. Timeslice chunks concatenate. Uploads are smaller and the recognizer is less likely to return empty text, so the echo check in pull request 142 rarely rejects a real interruption.
- A MacBook's own mic and speakers are close, but the browser canceller has a real render reference for page audio. The barge baseline stays near the noise floor, so the member's voice clears 2.5 times that floor without shouting. Playback still does not stop until the 500 ms hold plus a transcription. On a fast network that is short enough to feel acceptable. It is not instant.
- macOS Bluetooth still drops to the hands-free profile when the mic is in use. A MacBook with AirPods can sound worse than the built-in speakers. The test that "works" is the laptop mic and speakers.
- Desktop Safari is closer to iOS than to Chrome: MP4 recording, weaker echo cancellation, no neural model. It does not have the iOS earpiece and hide-event problems. Firefox uses WebM/Opus and its own AEC3, and it has no built-in speech recognizer. Talk Mode already avoids that recognizer and posts audio to `/api/aris-transcribe`, which is the right call. Edge is Chromium without the neural echo model.

The shared floor on every platform, including the MacBook, is the 1.8 second endpoint, the batch transcription, and waiting for a whole mp3 sentence before playback. iOS adds a bad echo path and a session policy that the current code does not drive. Fix the session and the interrupt decision before replacing the vendor.

## 5. Options

Prices below are list rates read for this note, not a quote. Speech synthesis: Flash and the other low-latency models are $0.04 per 1,000 characters, and the vendor counts about 1,000 characters as a minute of speech. Batch Scribe v2 and v3 are $0.20 per hour. Realtime Scribe v2 and Scribe v3 Live are $0.22 per hour, billed per second. Keyterm prompting is an extra $0.05 per hour on batch and on realtime. The coach model is Claude Sonnet 4.6 at $3 per million input tokens and $15 per million output tokens (Anthropic list card effective 2026-11-09). Cache reads are $0.30 per million. None of these rates require a new subscription by themselves. Turning on a different product (agents, a higher concurrency tier, a new key) does. That needs John's approval. This note does not turn anything on.

At the 30 minute monthly cap, if about half the minute meter is ARIS speaking: about 15,000 spoken characters, about $0.60 of Flash, plus about 15 minutes of member audio. Batch transcription of that audio with the keyterm is about $0.06. Voice cost for a member who uses the whole cap is under a dollar. Sonnet is the larger line. A turn with a long system prompt and a few thousand tokens of history is a few cents; late turns cost more until history trimming lands. More, shorter turns raise request count. They do not multiply the voice bill if the words spoken stay the same. Streaming audio that is only sent while someone is actually talking stays in the same range. Streaming the entire open mic, including silence, bills the open time: 30 minutes of realtime audio is about $0.11, or about $0.14 with keyterms. Still small next to the model.

### A. One persistent AudioContext and one MediaStream for the session

The session already tries to do this. The holes are: the context is created before the mic session flips, `interrupted` is ignored, the recorder is destroyed per utterance, and the audio session type is never set or restored.

Pros: no new vendor, no new bill, fixes route flaps and "I came back and it was dead" more than it fixes echo. Effort is the session file plus tests, and it has to rebase onto the stall fix. Risk is low if the hide grace, the cap, and the minute meter stay as they are. This is necessary groundwork, not a full duplex solution.

Cons: a single context does not put local mp3 into the iOS echo-cancellation reference. Keeping the mic across pause would keep billing minutes and would keep the red recording indicator on. Do not do that.

### B. AudioWorklet voice-activity detection, for example Silero in WASM

Replace the RMS thresholds with a small speech model running off the main thread. The practical shape on iOS is an `AudioWorklet` that posts PCM frames to a worker, because the worklet thread itself is a poor place to host an ONNX runtime. `ScriptProcessor` must not come back. Pull request 140 showed iOS stops feeding it.

Pros: endpointing can follow speech instead of a flat 1.8 seconds, so a breath does not need a huge hangover, and a real end of turn can be shorter. It survives main-thread jank while coach tokens are rendering. No vendor bill. The model is a couple of megabytes, loaded once.

Cons: echoed ARIS speech is speech. Silero will mark the speaker leak as a voice. It does not replace echo cancellation or the echo check. iOS worklet support is good enough to try and bad enough to keep the analyser fallback: module URL rules, a context that dies on interruption, and sample-rate mismatch after the session flip. Risk is medium. Effort is a new client module and a fallback path, not a server change.

Use it in addition to a real echo check, not instead of pull request 142's reject path, until iPhone speaker tests say the false starts are gone.

### C. Rely on the browser canceller: same context, or a WebRTC loopback

Playing TTS through the same `AudioContext` is already what the code does, and iPhone echo still gets through. A stronger variant is a local `RTCPeerConnection` loopback: send the playback buffer as a track, play the remote side, and capture the mic with echo cancellation so the browser treats ARIS as the far end of a call.

Pros: no per-minute vendor fee. On desktop Chrome this is mostly redundant, because page audio is already in the render reference. On iOS it is the only web-shaped way to feed voice-processing the reference it was built for.

Cons: iOS loopback is fragile. It can pin the earpiece, it can crackle on iOS 27.0 and 27.1, it breaks when the route changes, and a "call" with no network still trips the Bluetooth hands-free profile. Two peer connections in the page are a large new client. If it fails, the member hears silence or a double voice. Effort is high. Risk is high on iOS and medium on Android. Worth a gated experiment on John's phone before any general rollout. Not worth a rewrite if the cheaper correlation check in phase 2 works.

### D. Streaming speech-to-text over a WebSocket

Scribe v2 Realtime and Scribe v3 Live take 16-bit mono PCM (16 kHz is the usual rate) on `wss://api.elevenlabs.io/v1/speech-to-text/realtime`. Partials arrive while the member is still talking. A committed transcript is on the order of 150 ms after the audio they have. The browser must not see the API key. The documented client path is a single-use token from `POST /v1/single-use-token/realtime_scribe`, minted on the server, 15 minutes, one connection. An edge function can mint that after the same membership check as the other ARIS routes. No `createRequire`. The browser then opens the socket itself. Netlify does not need to proxy the audio socket.

Pros: the transcript is ready when the member stops, instead of after an upload. Partials can also feed the echo check ("does this text match the sentence currently playing?") without a separate file upload. Cost delta versus batch is about $0.02 per hour plus the same keyterm adder, if audio is sent only during speech. Manual commit should stay under our endpointing. Their server VAD will reintroduce the mid-sentence cutoff from before pull request 140 if we let it decide the turn.

Cons: PCM has to come from an `AudioWorklet` or a worker. That is the iOS risk in option B. A token mint is a new route and must stay behind membership. Confirm the existing key is allowed to mint realtime tokens before any production use. That confirmation is John's. Do not enable it in the rollout flag until he says so. Effort is medium-high: token route, worklet, a fallback to today's file upload when the socket fails. The coach, the tools, and the voice route stay.

### E. Streaming playback

The voice route already streams mp3. The browser throws that away until the sentence is finished. Safari will not play mp3 through Media Source Extensions. The workable approach is to ask the voice route for PCM (the vendor offers 16, 22.05, 24, 44.1, and 48 kHz) and schedule the first frames on the same context as soon as a few hundred milliseconds have arrived.

Pros: time-to-first-audio drops from "whole sentence" to a short buffer. Same character price. Same voice, same pronunciation dictionary. No new product. Interruption already aborts the fetch.

Cons: PCM is larger on the wire (24 kHz 16-bit is about 48 KB/s). The context sample rate and the PCM rate will differ on iOS after a session flip, so the worklet has to resample. A sentence still cannot start until the model has emitted a sentence boundary. Effort is medium, concentrated in `aris-voice.js` (accept a format the client asks for, default stays mp3 so the speaker button does not change) and in the session scheduler. Risk is medium on iOS, low on desktop.

### F. A hosted conversational agent, or a WebRTC agent

The vendor's agent product runs the mic, the speaker, echo cancellation, and turn-taking as a WebRTC call, with a custom model webhook if we want to keep Sonnet and the coach prompt. Their public rate is $0.08 per minute of call on top of the model. Telephony is separate and we would not use it. Whether speech synthesis and recognition are inside that $0.08 or still metered on the API is easy to misread; treat $0.08 per connected minute as a new line until a bill is checked. Thirty minutes is $2.40 per member per month before Sonnet. A general REALWISE and FORGE rollout multiplies that by members who leave Talk Mode open.

Pros: this is the one option that uses a real call pipeline, so iOS voice processing finally has a far-end reference. Barge-in and endpointing become their problem. A custom model webhook could keep the coach.

Cons: tools, research, memory, membership, the minute cap, and the "no vendor names" rule all have to be re-wired around a session we do not control. The student UI can still say ARIS. The integration surface cannot. Concurrent-call limits on the agent plans are a paid-plan conversation. John has to approve any switch. Effort is a second coach stack. Risk is high. This is a fallback if the iPhone speaker test still fails after phases 1 and 2, not the way to roll Talk Mode out.

### G. A native wrapper or a home-screen web app

A home-screen web app on iOS is still the same WebKit audio session. It does not unlock `AVAudioSession`, and background mic still dies without a native background mode. It will not make Talk Mode full duplex.

A native shell (a small wrapper around the site) can set play-and-record with default-to-speaker and can choose whether voice processing is on. That can fix earpiece routing and the crackle. It cannot fix Bluetooth hands-free quality. It is an App Store product, a second release train, and a different privacy prompt. Out of scope for a website rollout to members.

### What not to do

- Do not put a vendor SDK on the coach page. A token minted by our edge function is enough if streaming recognition is approved. The page already talks only to `/api/aris-*`.
- Do not set the audio session to `playback` while the mic is open.
- Do not bring back `ScriptProcessor`.
- Do not shorten the 1.8 second quiet timer until the iPhone breath test from pull request 140 is repeated. That timer exists because 900 ms was cutting questions in half and the rest of the sentence was treated as an interruption.
- Do not show ElevenLabs, Anthropic, WebKit, Safari bug numbers, or "echo cancellation" in the UI.

## 6. Recommended phases

Sequence these after the stall-fix branch, or rebase onto it before editing `aris-talk-session.js`. Each phase is shippable by itself. None of them change the coach prompt or the history budget.

### Phase 1. Drive the iOS audio session, and stop the context from going dead

No new vendor and no new meter. This is the rollout candidate if the test matrix passes.

- On the Talk tap: `audioSession.type = 'auto'` when the API exists, then `getUserMedia` with the current constraints, then `audioSession.type = 'play-and-record'`. On release: `playback`, then `auto`, so the rest of the site leaves the call session.
- Create the `AudioContext` after the stream is live, or recreate it if `sampleRate` does not match the track. The tap is still the user gesture. Call `resume()` from that tap, and also from `statechange` when the member next taps. Treat `interrupted` the same as `suspended`. Never schedule buffers while the state is not `running`.
- On a visible page, a muted mic track or a `devicechange` resets the recorder and does not end the utterance. The 2 second hide grace stays. Locking the phone still pauses and releases the mic.
- On iOS, start `MediaRecorder` with no timeslice unless a test proves fragmented MP4 uploads transcribe. On Chromium, prefer `audio/webm;codecs=opus` and keep the timeslice. Keep the file-upload recognizer.
- Keep the pull request 142 gates. Do not loosen 2.5x or 500 ms in this phase.
- Add allowlist-only console lines next to the existing `ARIS talk playback:` logs: session type, context state, track `echoCancellation` and `sampleRate`, and whether the recorder MIME is mp4 or webm. No student-visible diagnostics. If nothing is heard, the status can say the phone may be on silent or the volume may be down. It must not name a vendor or a browser bug.

Effort: the session file, a few pure helpers in `aris-talk.js`, and tests around the session-type order and the interrupted-context rule. Risk: low on desktop, medium on iOS because session-type ordering is empirical. The AirPods workaround is specifically "getUserMedia first, play-and-record second."

### Phase 2. Stop the speaker on interrupt without waiting for a transcript

The stiffness members feel is phase 2's bug. Today, audio stops only after `confirmBarge` uploads a clip and gets text back.

- When the 500 ms / 2.5x candidate fires, compare the recent mic PCM to the `AudioBuffer` that is actually playing (normalized correlation, or a short adaptive subtraction). The session already has that buffer in `scheduleBuffer`.
- High correlation: it is the speaker. Keep playing. Log `barge-rejected`. Do not upload.
- Low correlation: stop playback and abort the reply immediately, then transcribe. The existing echo-text check remains the second gate before `sendText`, so a false stop does not become a false coach turn.
- Leave the 300 ms sentence-onset grace in place until correlation is measured. The onset is when a canceller is worst, and it is also when a correlation check is most reliable, because the buffer just started.

Cost: no extra transcription. A rejected echo no longer spends a Scribe call. Anthropic tokens drop when a real interruption aborts a reply that would have kept generating. Effort: medium, still in the session file, with unit tests on synthetic PCM (a delayed copy of the buffer must not barge; uncorrelated noise at the same RMS must). Risk: medium. If iOS delivers mic audio at a different rate than the buffer, correlation will lie until the rates are aligned. Phase 1's sample-rate check is a prerequisite.

Do not ship a shorter than 1.8 second endpoint in the same change. After phase 2 is calm on the iPhone speaker, a follow-up can try 900 ms of quiet that extends while RMS is still moving. Repeat the Crown Point question with a breath in the middle before that constant changes.

### Phase 3. Streaming recognition, only after John confirms the key

Mint a single-use realtime token in a new edge function. Membership check first. The browser sends PCM from the worklet only while local voice activity says someone is speaking, and it commits manually from our endpoint. Fall back to today's file upload if the worklet or the socket fails. Keep Scribe v2 batch as that fallback. Scribe v3 Live is the newer realtime model at the same $0.22 per hour; use it only if the token and the socket accept it with the current key. Keyterms stay, including the name bias, if the realtime socket accepts them without a plan change.

This phase is a latency upgrade (the transcript is ready at end of speech). It does not fix iOS echo. Do not start it until phase 2 has been heard on a phone. Flag for John: confirm the current key can mint `realtime_scribe` tokens and that he accepts the realtime meter. Do not flip it on for members in the same change as that confirmation.

Effort: medium-high. Risk: medium, mostly iOS worklet and socket drops when the screen locks. Cost: about two cents an hour above batch if we only send speech.

### Phase 4. Start speaking before the whole sentence is encoded

Ask `/api/aris-voice` for PCM when the Talk Mode client requests it. The speaker button keeps mp3. Schedule the first buffer on the phase 1 context. Same Flash model, same dictionary, same character price. Larger responses, so keep the two-sentence prefetch rather than prefetching the whole answer as PCM.

Effort: medium. Risk: medium on iOS sample rates, low elsewhere. Do this after phase 1. It can run in parallel with phase 3.

### Phase 5. Only if the iPhone speaker still fails

Revisit a hosted WebRTC agent, with John's approval, or accept that bare-iPhone Talk Mode is "tap to interrupt" rather than talk-over. A native shell is not the rollout path. Write the decision down with the phase 2 recordings attached so it is not relitigated from memory.

### Test matrix

Run on the production site. Memberstack login does not work on Netlify preview deploys. Use an allowlisted account. Record the OS version. iOS 27.0 and 27.0.1 crackle with echo cancellation even when our code is right; iOS 27.2 does not. Note call-volume versus media-volume if the phone shows a phone icon.

| Case | iPhone Safari, built-in mic and speaker | iPhone Safari, AirPods | Android Chrome, mid-range phone, built-in | Desktop Chrome, MacBook speakers |
| --- | --- | --- | --- | --- |
| Start Talk Mode with one tap | Hears ARIS from the loudspeaker at a normal level, not only the earpiece | Stays on the AirPods for both mic and speech. A move to the iPhone speaker is a failure of phase 1 | Speech is audible without hunting for a hidden slider. Note if volume buttons change call volume | Unchanged from today |
| Question with a breath in the middle | One turn, full question, full answer. Control does not say paused | Same | Same | Same |
| Stay quiet through a long answer | Answer finishes. Console does not show `barge-in` | Same | Same | Same |
| Talk over a later sentence | Speaker stops within about half a second of the member's voice, and the next answer is the new words | Same. Phone-call quality in the buds is accepted. A dropped AirPods route is not | Same, including on double-talk. Member's words are not chopped out of the transcript | Same, and it should still match today's good behavior |
| Second and third turns | Returns to Listening and takes another question with no extra tap | Same | Same | Same. If this fails while the audio session is healthy, it belongs to the stall-fix agent, not to a new audio gate |
| Lock the phone, or switch apps, for more than 2 seconds | Pauses, mic indicator goes away, minutes stop. Resume after unlock works, including playback | Same, and the route comes back to the AirPods | Same | Hide the tab for more than 2 seconds. Same pause and resume |
| Flick the ringer, or drop volume | Either ARIS is still heard (call session ignores the ringer) or the status tells the member to check volume. Talk Mode does not sit on Speaking with no sound and no way back | Same | Volume buttons documented in the test notes | Not applicable |
| Incoming route change | Pulling AirPods out, or a notification that takes audio focus, does not submit a half sentence and does not stick the status | Same | A navigation prompt or notification ducks or pauses without a stuck Listening state | Unchanged |
| Leave Talk Mode and use the site | Speaker button, typed chat, and upload still work. Audio is not stuck in a quiet "call" timbre | Same | Same | Same |
| Cap and idle | Unchanged: 2 minute idle pause, monthly cap, typing still works | Same | Same | Same |

Console logs are for the allowlisted tester. Nothing in the matrix may put a vendor name on screen.

### Acceptance for a general member rollout

All of these, on the four targets above, on production, with `TALK_MODE_ENABLED` still off and the allowlist holding the testers:

1. A member can hold a three-turn exchange without tapping again, without the control flipping to paused unless they hid the page or stayed quiet for two minutes, and without the answer stopping while they are silent.
2. On the iPhone loudspeaker, talking over ARIS stops the audio in well under a second and the following answer addresses the new utterance. Silence during an answer never stops it.
3. AirPods stay the input and the output for the whole session. Call-quality sound in the buds is acceptable. Jumping to the iPhone speaker is not.
4. A mid-range Android phone completes the same three turns. A chopped interruption is a failure. A quiet answer that is fixed by raising call volume should be written down and, if it is common, called out in the status line.
5. Desktop Chrome does not get worse than it is after pull request 142.
6. Locking the phone releases the microphone and stops the minute meter. Resume is one tap.
7. Student-visible strings still do not name a vendor. `node --test tests/aris-talk.test.js tests/aris-heard-name.test.js` stays green, including the 1.8 second quiet default until a later change says otherwise.
8. No new paid product. Phases 3 and 5 stay off until John approves the meter in writing.

Roll out the way `docs/ARIS-TALK-MODE.md` already says: John, then the allowlist, then `TALK_MODE_ENABLED`. Watch `aris_talk_usage` and the `ARIS_TALK_ALERT` log. The audio work does not change that gate.

## Sources checked for this note

Platform behavior: WebKit bugs 282939 (AirPods route), 311451 (quality drop with the mic on), 326286 (iOS 27.0/27.1 crackle with echo cancellation, gone on 27.2). `navigator.audioSession` session types and the ringer switch. Chrome's desktop-only neural echo model, Android communication-mode volume, and the A2DP-to-SCO switch when a Bluetooth mic opens.

Prices, read November 2026: ElevenLabs API price card (Flash $0.04 per 1,000 characters, batch Scribe $0.20 per hour, realtime Scribe $0.22 per hour, keyterms $0.05 per hour, agents $0.08 per minute plus the model). Anthropic list card effective 2026-11-09 (Sonnet 4.6 at $3 / $15 per million tokens). Single-use realtime token: `POST /v1/single-use-token/realtime_scribe`.
