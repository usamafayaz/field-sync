# FieldSync

A React Native (bare CLI, TypeScript) app for filing photo reports from a site where the
connection is 2G at best and gone for stretches. A report is a short description and one to
five photos. Once saved, it reaches the server by itself, exactly once, whatever the network does.

**Demo video:**
https://drive.google.com/file/d/1vAa2umhA8L0dt1xQCyZN49L_Q-6PHGe4/view?usp=drive_link

```
src/
  config.ts            product rules (1–5 photos, 5 MB) and tuning (chunk sizes, timeouts)
  delivery/            the upload system: plain TypeScript, no React, no React Native
    ports.ts           interfaces for fs / http / network / image encoder / keep-alive / clock
    outbox.ts          the durable list of reports this phone owns (atomic JSON file)
    drafts.ts          the report being composed, persisted on every change
    prepareImage.ts    gets each photo under the 5 MB ceiling
    api.ts             typed client for the server protocol
    engine.ts          the delivery loop: prepare → upload chunks → commit → confirm
    errors.ts          transient vs permanent, the one decision on every failure
  platform/            React Native adapters for the ports
  specs/               TurboModule spec for the Android foreground service
  ui/                  screens, hooks and design tokens. Reads the stores, owns no logic
  services.ts          composition root + reset
android/.../delivery/  DeliveryService (foreground HeadlessJsTaskService) + TurboModule
server/                the test backend (Node, no dependencies) with fault injection
__tests__/             the delivery guarantees, tested headless against a fake server
```

## Run it

Needs Node ≥ 22.11 (`nvm use` picks it up from `.nvmrc`), JDK 17, Android SDK, and an emulator or device.

```sh
npm install
npm run server            # terminal 1: backend on :4000, controls at http://localhost:4000/admin
npm start                 # terminal 2: Metro
npm run android           # terminal 3: builds and installs the debug app
npm test                  # the delivery tests (no device needed)
```

Or start the backend and Metro together in one terminal, with both logs, and Ctrl-C stops both:

```sh
npm run dev               # then `npm run android` in a second terminal
```

The app talks to `http://10.0.2.2:4000` by default, which is your computer as seen from the
Android emulator. On a physical device, put your computer's LAN address (the server prints it)
in **Settings → Server**, or run `adb reverse tcp:4000 tcp:4000` and use `http://localhost:4000`.

## Make it fail

**Network (the phone side).** Airplane mode works as you'd expect. To throttle the emulator to 2G:

```sh
npm run android:2g        # adb emu network speed gsm + delay gprs
npm run android:fast      # back to normal
```

**Server side.** Open `http://localhost:4000/admin` in a browser on your computer. Presets:

| Preset         | What it does                                                                      | What the app should do                                     |
| -------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Slow 2G        | 800 ms latency, ~6 KB/s                                                           | Keep making progress, in small chunks                      |
| Flaky          | ~300 KB/s, drops 20% of uploads mid-way, random 503s, loses 30% of commit replies | Resume from the server's offset; never duplicate           |
| Demo           | ~800 KB/s, drops 15% of uploads, loses **every** commit reply once          | Same, fast enough to record                                |
| Down           | every request is 503                                                              | Retry with backoff, report stays "On this phone"           |
| Black hole     | accepts requests, never answers                                                   | Time out, retry                                            |
| Refuse uploads | 400 on every upload                                                               | Stop. Mark "Needs you". Don't retry until the user says so |

Each knob can also be set individually, or by `POST /admin/faults` with JSON such as
`{"dropRate":0.3,"bandwidthBps":6000}`. `POST /admin/wipe` empties the server.

## Decisions and why

**Backend**

- **My own Node server, no dependencies, instead of Firebase, Supabase or S3.** The brief needs a
  backend that fails on demand, in specific ways: latency, dropped connections, refused uploads,
  requests that never answer. The hardest case for an app is "the server saved the report, then
  the reply got lost", and a hosted service can't be told to do that. With my own server, every
  failure is one click on the admin page or one `curl`, and it runs with plain `node` and nothing
  to install or sign up for. It also enforces the 5 MB ceiling (413), so the phone's limit is
  checked at the destination too.
- **Resumable upload protocol instead of one multipart POST.** `GET` asks how many bytes of a photo
  the server has, `PATCH` appends a chunk at that offset, and `PUT` commits the report. A 30 MB
  multipart POST that dies at 90% starts again from zero; this resumes from the last byte.
- **The server's byte count is the truth.** The phone never trusts its own memory of what it sent.
  It asks before every photo, so a crash, a force-quit or a server wipe can't leave phone and
  server disagreeing.
- **The commit carries each photo's size and SHA-256.** The server checks every file before
  accepting the report, so a corrupted or half-written photo is caught and re-sent, never stored.
- **Reports are assembled in a temp folder and renamed into place.** A report on the server is
  either complete or absent, never half there.

**Exactly once**

- **The report id is a UUID made on the phone when the draft starts**, not by the server. Sending
  the same report again (after a lost reply, a timeout or a crash) hits the same id, and the
  commit is idempotent: the server answers "already stored" and creates nothing new.

**Storage on the phone**

- **A JSON file plus folders of photos, instead of AsyncStorage or SQLite.** Photos are files, so
  the outbox stores them as files and moves them by rename (instant, however big). The list of
  reports is small, so one `outbox.json` written atomically (temp file, then rename) is enough, and
  a crash mid-write can't corrupt it. No database dependency.
- **The draft is saved as you type**, with its id, so killing the app mid-report loses nothing.

**Images**

- **Compressed on the phone, not the server.** Sending 30 MB over 2G and shrinking it on arrival
  wastes minutes per photo. The brief also puts the 5 MB rule on the app.
- **Natively, with `@bam.tech/react-native-image-resizer`.** It decodes and re-encodes in Java on a
  background thread, so the JS thread and the screen never freeze, and it applies EXIF rotation.
- **4.8 MB target, 3072 px long edge.** 4.8 MB leaves a safety margin under the 5,000,000-byte
  ceiling; 3072 px is still sharp enough to read a crack or a serial plate (see Images below).
- **Android's system photo picker**, so the gallery needs no storage permission at all.

**Delivery**

- **One report and one chunk at a time, oldest first.** Parallel uploads on 2G share one thin pipe
  and make every request more likely to time out.
- **Chunk size adapts (16 KB – 1 MB, aiming for ~8 s per chunk).** Small on a bad link so a drop
  loses little; large on a good one so it's fast.
- **Transient vs permanent errors.** Drops, timeouts and 5xx retry by themselves with exponential
  backoff and jitter. A 4xx refusal won't fix itself, so the report goes to *Needs you* instead of
  looping.
- **A stalled upload times out after 30 s without progress**, not after a fixed time per chunk.
  Slow is fine as long as bytes keep moving; *Try now* also cancels a hung request.
- **XMLHttpRequest instead of fetch**, for upload progress events and raw binary bodies.

**Background**

- **An Android foreground service, written as my own TurboModule** (Kotlin, with a Codegen spec in
  `src/specs`). It shows a notification while work is waiting and runs the same delivery engine as
  a headless JS task, so uploads continue with the app in the background. WorkManager (resuming
  after a reboot without opening the app) is on the "another day" list.

**Architecture**

- **The delivery logic is plain TypeScript with no React Native imports** (`src/delivery`). Phone
  features (files, HTTP, network, image encoding, the background service) sit behind small
  interfaces in `ports.ts`, and `services.ts` wires the real ones in one place. That's why the
  classes take their dependencies through the constructor: the same engine runs in the app, in the
  background task, and in Jest against a fake server, so the delivery guarantees are tested without
  a phone.
- **No Redux or other state library.** The state lives in the outbox, draft and engine stores,
  outside React. Screens subscribe with `useSyncExternalStore`, so there's one source of truth
  and no copy of it to keep in sync.
- **Bare React Native CLI with the new architecture (TurboModules, Hermes), Android only.** The
  brief asks for bare RN; I chose to do one platform properly rather than two thinly.

## How delivery works

1. **Save is local and instant.** Each draft keeps its photos in its own folder. Tapping *Save
   report* renames that folder into the report's folder (one step, however big the photos) and
   appends the report to `outbox.json` (temp file + rename, so it's atomic). Only then does the UI
   say "On this phone". If the app dies between the two steps, the next launch moves the photos back
   into the draft. No network is involved.
2. **Prepare.** Each photo is re-encoded natively (off the JS thread) to a JPEG under 4.8 MB.
   This happens even in airplane mode, so sending can start the moment signal returns.
3. **Upload in resumable chunks.** For each photo the app asks the server how many bytes it
   already has, then sends the rest in chunks (16 KB – 1 MB, sized to take ~8 s on the current
   link). The server keeps every byte that arrives, even from a connection that dies halfway.
4. **Commit.** The app sends the description and each photo's SHA-256. The server checks every
   file, then stores the report with one atomic rename. Only now does the app say "On the server".

**Nothing is lost**, because nothing leaves the outbox until the server has confirmed the commit,
and the outbox is on disk before the UI claims anything.
**Nothing lands twice**, because the report's id is chosen on the phone when the draft starts, and
the server's commit is idempotent on that id. Replaying it after a lost reply returns 200 and
changes nothing. Even the draft carries the id, so a crash between "saved to outbox" and "draft
cleared" can't make a second report on the next launch.
**Progress on a bad link** comes from resuming chunks rather than restarting whole photos.
**Survives a kill**: all durable state is the outbox file plus the server's offsets. After a force-quit
the engine re-reads both and carries on.

### Retry policy

| What happened                                                                                | Treated as | Behaviour                                                                              |
| -------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| No connection / connection dropped                                                           | transient  | backoff 1–60 s with jitter; reset immediately when the OS reports the network is back |
| Request hung (no bytes moving for 30 s, or the chunk takes longer than it would at 1.5 KB/s) | transient  | abort, ask the server for its offset, continue                                         |
| 5xx, 408, 429                                                                                | transient  | backoff                                                                                |
| 409 on a chunk (offset mismatch)                                                             | normal     | continue from the server's offset                                                      |
| 409 on commit (bytes missing or corrupt)                                                     | normal     | re-send just those photos, up to 3 rounds                                              |
| Any other 4xx (refused, 413, 422)                                                            | permanent  | report becomes **Needs you**; never retried automatically                        |

One report and one chunk at a time, oldest first. On 2G, parallel uploads share the same thin pipe
and make every request more likely to time out. A permanently refused report doesn't block the ones
behind it.

### Background

Android pauses React Native's JS timers when no activity is visible, which would freeze retries.
`DeliveryService` is a foreground `HeadlessJsTaskService`: it shows a low-priority notification
("2 reports saved on this phone, waiting for signal") and runs a headless JS task that resolves only
when the outbox is empty. That keeps both the process and the timers alive. It stops by itself once
everything is delivered.

## Images

- Photos come from the camera at full quality, or from Android's system photo picker. Originals
  are moved out of the picker's cache into app storage straight away (a rename, so an 18 MB photo
  costs nothing).
- A JPEG that's already ≤ 4.8 MB and ≤ 3072 px on its long edge is sent as-is. Re-encoding would
  only lose quality.
- Anything else walks a ladder (3072 px q85 → 3072 q75 → 2560 q75 → 2048 q70 → 1600 q65) until it
  fits. The decoder subsamples while it reads and applies EXIF rotation, so an 18 MB or 100 MP original
  never has to fit in memory. All of it is native and asynchronous, so the UI never freezes.
- The final file size is measured on disk, not taken from the encoder, and checked against the hard
  5,000,000-byte ceiling before anything is sent. The server enforces the same ceiling (413).
- Metadata, including GPS, is stripped by re-encoding. A pass-through JPEG keeps its EXIF. See gaps.

Why 3072 px and not "as close to 5 MB as possible"? The ceiling is a limit, not a target. 3072 px
still reads a serial plate or a hairline crack, and is usually 1.5–3 MB, which is minutes saved
per photo on 2G.

## UI decisions

- **One glance, one answer.** The top of the Reports screen is a single coloured statement:
  *Everything is on the server* / *3 reports on this phone* / *Sending 1 of 3* / *1 report needs you*,
  with a progress bar when bytes are moving. A tab badge shows the unsent count from every screen.
- **Four words, never mixed.** *On this phone*, *Sending*, *On the server*, *Needs you*. They're
  produced by one function (`ui/describe.ts`), so the vocabulary can't drift. "On the server" only
  appears after the server confirmed the commit.
- **Nothing waits on the network except the network.** Saving, photo preparation and the outbox
  all work in airplane mode. The *On server* tab is the only screen that needs the network, and it
  says so.
- **Failure is designed.** Every failure state has its own text and action: no signal, retrying
  (with countdown and *Try now*), refused by the server (*Try again* / *Delete*), server unreachable
  on the *On server* tab, camera permission blocked (*Open Settings*, re-checked when you come back,
  no restart needed).
- **Native feel.** 48 dp touch targets, safe areas, keyboard-aware compose screen, a fixed primary
  action within thumb reach.
- Visual language: concrete grey ground, deep green-black ink for glare, and one bright green used
  only for the primary action ("On the server" is a deeper, muted green, so action and done don't blur). IBM Plex Sans throughout, Plex Mono for byte counts and ids.
- **Light and dark themes**, following the phone by default, with a System / Light / Dark choice in
  Settings. Light reads best in sunlight; dark suits stairwells and night, and its background is the
  icon's ink, so splash → app is seamless. Colours are named by role (`text`, `surface`, `accent`…)
  in `src/ui/theme.tsx`, and every screen styles itself from the active theme (`makeStyles`). All text
  passes WCAG AA contrast in both themes. The choice is also applied at OS level
  (`Appearance.setColorScheme`), so native dialogs match.
- **Icon and splash** are generated by `scripts/generate-icons.py`: a green report sheet with an
  upload arrow, adaptive (follows the launcher's shape) with a monochrome layer for themed icons.

## Permissions

- **Camera:** asked when *Take photo* is first tapped. If refused for good, the compose screen shows
  "Camera access is off" with *Open Settings*. The app re-checks whenever it returns to the
  foreground, so granting it in Settings works immediately, without a restart.
- **Photos:** the gallery uses Android's system photo picker, which needs no permission: the user
  picks the files, and the app only gets those. There is nothing to refuse, so nothing to break.
  This is deliberate.
- **Notifications (Android 13+):** asked once, right after the first save, so the background
  notification ("2 reports saved on this phone, waiting for signal") can show. Refusing it doesn't
  stop delivery; the service still runs, just without a visible notification.

## Reset ("Start over on this phone")

Deletes everything this phone holds: unsent reports (after a confirmation that names how many will
be lost), the delivered history, the draft and its photos, and the picker's cached copies. It stops
the engine and waits for it to exit first, so no in-flight request can write state back afterwards.
Then it asks the server, best effort, to drop half-uploaded bytes for the abandoned reports.

It keeps what's on the server (that belongs to the organisation, not to the phone) and the server
address (wiping it would just strand you). Use the admin page to empty the server.

## Verified on a device

Run on an Android 14 emulator (Pixel 7, API 34) against the real server:

| Scenario                                                                                   | Result                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Airplane mode, 3 reports (one with five 24–35 MB photos), force-quit, reopen              | All 3 still there; photos prepared offline (35.5 MB → 2.7 MB at 3072 px, EXIF rotation applied) |
| Signal back with the server dropping 15% of connections, 10% 503s, 50% lost commit replies | 3 reports on the server exactly once (25 drops, 2 lost replies answered by idempotent replay)    |
| 20 KB/s link, airplane mode toggled twice mid-upload, once while backgrounded              | Resumed from the server's offset each time, not from zero                                        |
| Force-quit mid-upload                                                                      | Resumed from the server's offset after reopening                                                 |
| App in background with work outstanding                                                    | Foreground service running, notification shown, upload continued                                 |
| Server refuses uploads (400)                                                               | "Needs you" after exactly 1 attempt, no automatic retries; *Try again* delivers once fixed     |
| Server never answers                                                                       | Times out, shows the reason and a countdown, retries with growing backoff                        |
| Sixth photo / zero photos / blank or spaces-only description                               | All blocked with a specific message                                                              |
| Camera refused twice → Settings → granted                                                | Works without restarting the app                                                                 |
| Reset with an unsent report                                                                | Warned with the count; local reports, draft, photos and picker cache gone; server unchanged      |

Bugs found this way and fixed: a hung request was being reported as "cancelled" (so it never backed
off or showed an error), photo tiles collapsed to zero height, the keyboard covered *Save* in
edge-to-edge mode, and saving five huge photos took ~20 s because they were copied instead of moved.

## What I'd do with another day

- **WorkManager** job so delivery resumes after a reboot or force-stop without opening the app.
  Today, after a force-quit, delivery resumes when the app is next opened.
- Server-side cleanup of abandoned partial uploads (a TTL), since the reset-time request is best effort.
- Strip EXIF from pass-through JPEGs too, for consistency (needs a small native pass).
- iOS: the core is platform-free, but the background story (BGTaskScheduler / background URLSession)
  needs its own native work.
- A Detox end-to-end test that drives airplane mode through `adb`.

## What I knowingly left out

- Everything the brief scoped out: login, push notifications, comments, map, video, editing an
  uploaded report.
- iOS is not set up (not required). The delivery core is platform-free; iOS would need its own
  background-upload work.
- If the OS kills the app process outright (rather than a user force-quit while open), delivery
  waits until the next launch. See WorkManager above.
- Android 15 limits dataSync foreground services to 6 h a day. After that the service stops and
  delivery continues only while the app is open.
- Report ids use `Math.random` (RFC 4122 v4 layout). They only need to be unique per phone, but a
  crypto RNG would be stricter.

## How I used AI

I used AI coding tools throughout, the same way I work day to day: to draft code, compare
approaches, and write tests and docs faster. The decisions were mine, and I reviewed and tested
everything that went in. Examples: writing my own failing server instead of using a hosted
backend, uploading in resumable chunks with the server's byte count as the truth, making the
report id on the phone so a retry can't create a duplicate, and shrinking photos natively so the
screen doesn't freeze. Testing on the emulator also found real bugs that I then fixed, such as a
stalled upload that took 12 minutes to time out. I'm happy to go through any part of
the code and explain why it's built this way.
