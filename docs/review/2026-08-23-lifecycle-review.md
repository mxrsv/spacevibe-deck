# Lifecycle review — the four uncommitted workstreams (2026-08-23)

> **Superseded (decided 2026-08-23, committed 2026-08-24):** the consent model
> reviewed in §2 was reversed after this review closed — analytics is default-on and the consent modal no longer
> mounts (`USAGE_CONSENT_ASKED=false`, commit `cdc07a0`). The "Consent modal on
> screen" states below are reachable only if that constant is flipped back;
> findings #2 and #3's fixes shipped and stay valid for that day.

A review by **lifecycle**, not by diff: what states can the UI be asked to
render, which of them are newly reachable, and which have no owner. Scope is
the working tree as it stood on 2026-08-23 — opt-in usage analytics, the rail
close model, the rail cluster reorder, and the rail tail pane pairing.

The review itself changed no product code. Three test-gate repairs and two
consent-modal fixes followed it in the same tree; both sets are recorded in §5,
and the findings they close are marked where they appear.

## 1. What ran

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx tsc -p tsconfig.electron.json --noEmit` | clean |
| telemetry suites (7 files) | 62/62 — **their first ever execution** |
| `npm test` before the repairs | 3676 passed / 11 failed |
| `npm test` after the repairs | **3772 passed / 0 failed** |

Failure attribution was done by reading each assertion for the artifact it
names, not by re-running against a pristine `HEAD` worktree. §5 records one
attribution that turned out wrong under that method until the fix proved it.

## 2. State inventory

Legend: **NEW** = newly reachable in this working tree. **⚠** = has a finding.

### Boot → consent unknown

| State | What renders | |
| --- | --- | --- |
| `telemetryConsent = "loading"` | full app, no dialog | |
| Modal mounts LATE, after the IPC answers | `Modal` claims focus on mount, pulling it off whatever pane the user was typing in | ⚠ |
| Restore focuses a pane AFTER the modal mounted | keystrokes reach the agent behind a dialog that has no exit | ⚠ |
| `unreadable` at boot | the consent question is NEVER asked — `shouldShowUsageNotice` only accepts `"unanswered"`; reachable only through Settings → Privacy | ⚠ |
| `unavailable` (Tauri, browser preview) | switch silently disabled, with the whole "what Deck sends" disclosure under it on a host that can never send | ⚠ |

### Consent modal on screen

| State | | |
| --- | --- | --- |
| Every chord still runs behind the scrim | ⌘T spawns a pane and takes focus; ⌘, opens Settings at z-35 under a z-40 scrim; ⌘W closes a pane nobody can see | ⚠ NEW — **fixed 2026-08-23** |
| Awaiting the IPC | no busy state, no spinner, both buttons live | ⚠ NEW — **fixed 2026-08-23** |
| The write fails | an opt-IN rolls back and the dialog stays, by design; a DECLINE stands in main's memory and is broadcast, so the dialog leaves even on a read-only disk | NEW — not a dead end |
| Two windows race the first read | window A adopts B's answer from the event, then its own stale read overwrites it — the modal returns | ⚠ NEW |

### Rail — close model

| State | | |
| --- | --- | --- |
| Window with 0 tabs | `disposeTab` keeps the window and raises the board, but `railAvailable` is `liveRailAvailable(tabViews.length)`, so the rail unmounts and the sidebar goes to width 0 — the project headers the change exists to preserve are not on screen | ⚠ NEW |
| Tab holding one agent beside a shell, agent closed | tab survives — deliberate | NEW |
| Project header ✕, busy dialog declined | nothing closes, nothing is forgotten — correct | NEW |
| Every index already stale | `closeTabs` returns `false`: the ✕ does nothing and says nothing | ⚠ NEW |

### Rail — cluster drag

| State | | |
| --- | --- | --- |
| Under the 5px threshold | the collapse click fires untouched | |
| Escape mid-drag | chrome goes, listeners stay for the click swallow — correct | |
| Pointer released outside the window | no `setPointerCapture`, so `pointerup` can be missed and the ghost and insertion line stay on `body` | ⚠ NEW |
| Dropped, but `orderKey` is twinned | `pinAt` refuses; nothing moves and nothing explains why | ⚠ NEW |
| Project closed or re-keyed mid-drag | `source < 0`, silent no-op | ⚠ NEW |
| Held at the edge with the list fully scrolled | the rAF loop keeps running until the pointer leaves the band | NEW |

### Rail — tail

| State | | |
| --- | --- | --- |
| Same session, nothing new to quote | the row keeps its sentence — the fix working | NEW |
| A different session | the sentence is dropped even when the new one is empty — the fix working | NEW |
| Pane `cd`s to another repository | `preferredId` pins the old session; `findCandidateById` skips the cutoff and the ranking by design | ⚠ |
| Tail miss | `readGrowingTail` tries 64K → 256K → 1M with no early exit, `readSync`, in the main process; a miss is the common case for a working pane by the change's own measurement (486/616 records past the window were tool traffic). Cadence not measured | ⚠ NEW |

### Analytics counting and sending

| State | | |
| --- | --- | --- |
| Consent not yet given | main drops every count — matches the public claim | |
| **Opted in mid-session** | the renderer has already seeded `prevTabs`/`prevPanes`, and `countRestoredSessions()` only fires at boot — so that day reports `maxTabs: 0` and `restoredSessions: false` while five tabs are open | ⚠ NEW |
| 400/413 | the stale `buffer` is written back, discarding a fold that landed during the POST; harmless because the day is terminal, but it is not the care the 2xx branch takes | ⚠ NEW |
| `unreadable` with Settings open | the note says "repair the file, then reopen Settings", but `unreadable()` reads a load-time cache — **the app has to be restarted** | ⚠ NEW |

### Quit

| State | | |
| --- | --- | --- |
| Waiting on the final POST | `flushOnQuit` sits between `killAll` and `saveAll` with a 5s timeout; an opted-in user on a hanging network watches the window sit there | ⚠ NEW |

## 3. Findings by severity

1. **Window with 0 tabs loses the rail.** `src/ui/app.tsx:1035`, `:1491` against
   `src/terminal/tab-manager.ts:1178+`. Two halves of one decision contradict
   each other; `AGENTS.md`'s "project headers intact" is not true today.
2. **The consent modal blocks no shortcut.** `usageConsentOpen` reaches
   `browserPanelObscured` (`src/ui/app-policy.ts:14`) but not
   `openOverlayRanks()` (`src/terminal/tab-manager.ts:1567`). The one modal with
   no exit is the one modal that guards nothing. **Fixed 2026-08-23** — see §5.
3. ~~**An unwritable `telemetry.json` walls the user in.**~~ **WITHDRAWN.**
   Traced through `setEnabled` and pinned by a new case in
   `electron/telemetry/service.test.ts`: a failed DECLINE still leaves main's
   in-memory consent at `declined` and still broadcasts it, so the dialog
   leaves. Only a failed opt-IN keeps it up, which is correct — main refuses to
   claim a consent that never reached disk. The real half of this finding was
   the missing busy state, fixed 2026-08-23.
4. **Opting in mid-session corrupts that day's numbers.**
   `src/telemetry/usage-counters.ts:68-102`, `src/ui/app.tsx:532`.
5. **The recovery instruction is wrong.**
   `src/ui/settings/sections/privacy-section.tsx:69-72`.
6. **Quit can wait 5s on analytics.** `electron/main.ts`,
   `POST_TIMEOUT_MS` in `electron/telemetry/model.ts:37`.
7. **Two-window consent race.** `src/telemetry/consent-store.ts:47-61`; the
   listener also outlives `resetTelemetryConsentStore`.
8. **Synchronous 1.3 MiB tail reads in main.** `electron/resume/session-tail.ts`.
   Measure the `changedAt` cadence before acting.
9. Drag: no pointer capture, and three silent no-op branches.
10. `closeTabs` returning `false` leaves a dead control.
11. Tauri's Privacy section: a disabled switch with no explanation.
12. `preferredId` survives a pane changing directory.

## 4. Gate quality

The gates were reviewed on their own terms after the owner noted they may be
out of date. Four weaknesses, none of them currently hiding a bug:

- `scripts/security-regressions.test.ts` is named for a class of failure but
  pins three literals from one past incident, and scans only `src/terminal/` —
  not `electron/`, which is where network access lives.
- `specifiers()` in `scripts/monaco-smoke-entry.test.ts:31` and
  `scripts/gallery-entry.test.ts:46` matches `from "…"` only, so a dynamic
  `import()` walks past both — including past R7's gallery boundary.
- Six `not.toContain("<name>")` assertions across three gates anchor on a name
  with nothing anchoring the name itself; the monaco harness has already been
  renamed once. `scripts/icon-system.test.ts:96` shows the fix — it asserts its
  own scan is non-empty.
- `scripts/ipc-contract.test.ts` is excluded from `npm test` AND red.

The packaged Monaco smoke gate itself (renamed from Gate M on 2026-08-23) is
sound: 12/12, inside `npm test`, rename consistent across config, HTML,
`.gitignore` and `electron/main.ts:71`, and its new `stopChild` test waits on a
real process-group exit rather than assuming one. Its runtime half still only
runs on the verification Mac, so a green `npm test` says nothing about whether
Monaco survives packaging.

## 5. Repairs made during the review

Three reds, none of them a product bug:

- `src/styles/04b-agent-rail-rows.css` — `.asr-leaf__hit` took
  `var(--radius-control)` in place of `inherit`, matching `.asr-row__hit`, the
  identical hit layer that predates it.
- `src/terminal/tab-manager.file-surfaces.test.ts` — T21 inverted to match the
  close model, and `boardOpen` added to the `afterEach` reset.
- `src/ui/settings/settings-screen.test.tsx` — `"Share usage stats"` added to
  `EXPECTED_ROWS`, 18 → 19.

Two consent-modal fixes landed after the review, in the same tree:

- `usageConsentOpen` became a `computed` in `src/telemetry/consent-store.ts`,
  read by BOTH the dialog and `openOverlayRanks()` at the `modal` rank — one
  source, so the guard and the screen cannot disagree. Pinned by a new case in
  `tab-manager.overlay-guard.test.ts`.
- Both dialog buttons disable while a decision is in flight, and a new case in
  `electron/telemetry/service.test.ts` pins the escape hatch that withdrew
  finding #3.

A thin `/code-review` pass over those two fixes returned three findings; one
was real and is fixed, one was a false positive, one sharpened a comment:

- **Real.** `setTelemetryEnabled` RESOLVED when the reply did not parse — the
  signal stayed put and the caller's `catch` never ran, so on the one surface
  with no other exit the button did nothing and said nothing. It throws now. A
  test in `consent-store.test.ts` was pinning the old behaviour and was
  inverted.
- **False positive.** `ensureTelemetryStateLoaded` was reported as stranding
  the phase on `"loading"` after a rejected read. It cannot: `telemetryState`
  catches internally and answers `null`, which the caller turns into
  `unavailable`.
- **Sharpened.** A failed DECLINE leaves by the `telemetry:state-changed`
  broadcast, never by the call's return value. Narrow and now stated in the
  code: if that listener never attached, the decline is stranded.

Not found by the review, and raised here instead: `decide`'s in-flight flag
never clears if the IPC never settles, which would disable both buttons for
good. Left alone deliberately — reaching it means the main process is already
hung, and a timeout would invent a third state ("sent, maybe") on a dialog whose
whole point is that every exit persists an answer.

**The `boardOpen` reset is the finding inside the repair.** Five of the six
`file-surfaces` failures were attributed to a concurrent session and were not:
T21 raised `boardOpen`, the file never reset it, and every later test was
ranked at `"board"` and blocked. The close model caused six of the eight reds,
not one. Any new branch that raises a module-scoped chrome signal needs a reset
in the suites that can reach it — the `afterEach` there already carries that
lesson for `agentQuickPickerOpen` and `settingsOpen`.
