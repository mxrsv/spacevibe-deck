# Review — Electron cutover release readiness, Windows first

Run 2026-08-17, 17:30–19:00 local, against **HEAD `878fce3` plus the uncommitted working
tree** (270 changed paths: 203 modified, ~60 untracked). The working tree is the subject —
every surface shipped since 2026-08-14 lives there and in no commit.

**Scope taken from the owner at the start of this review, overriding the plan on disk:**

| Question                                               | Answer                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where does the Electron build stand relative to Tauri? | **Cutover.** Electron replaces Tauri. Not the parallel release that [`docs/plans/2026-08-16-electron-release.md`](../plans/2026-08-16-electron-release.md) `decided` assumes. |
| Which platform first?                                  | **Windows first.** macOS is waiting on an Apple Developer Program approval (~48h from 2026-08-17).                                                                            |
| Run the gates?                                         | Yes, one timestamped pass. Results below.                                                                                                                                     |

Twelve specialist agents ran in parallel over partitioned criteria. Findings were re-read
against the file by the orchestrator before being written down; anything that survived only as
a hypothesis says so.

> **The checkout is shared.** Other sessions edit this tree. Every gate below carries the
> wall-clock time it was taken, and failures are attributed by file mtime, not by assumption.

---

## Baseline gates — measured, 2026-08-17 17:38–17:39

| Gate                                                                     | Result                                                          | Time              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------- |
| `npm run generate:menu:check` (R3)                                       | **clean**, exit 0                                               | 17:38:11          |
| `npx tsc --noEmit` (renderer)                                            | **clean**, exit 0                                               | 17:38:11–14       |
| `npx tsc -p tsconfig.electron.json`                                      | **clean**, exit 0                                               | 17:38:14–15       |
| `npm test`                                                               | **2 failed / 3026** — 253 of 255 files green                    | 17:38:15–49       |
| `npx vitest run scripts/ipc-contract.test.ts` (excluded from `npm test`) | **1 failed** — 40 renderer commands have no Rust implementation | 17:38:49          |
| `npm run test:updater-manifest`                                          | **clean**, exit 0                                               | 17:38:50          |
| `node --test scripts/verify-windows-bundle.test.mjs`                     | **clean**, exit 0                                               | 17:38:50          |
| `npm run build`                                                          | **clean**, exit 0, 8.50s                                        | 17:38:50–17:39:02 |
| `npm run electron:build`                                                 | **clean**, exit 0                                               | 17:39:02–03       |
| `npm audit`                                                              | **4 vulnerabilities**: 2 high, 1 moderate, 1 low                | 17:39:03–04       |

### The suite is green again — the audit's P0-1 is closed

[`docs/review/2026-08-17-maintainability-performance-audit.md`](2026-08-17-maintainability-performance-audit.md)
`current` recorded `npm test` **RED at 00:13 today** — 279 failures of 2877, 271 of them the
same `InvalidCharacterError: "[object Object]" did not match the QName production` from
`@phosphor-icons/react` escaping Vitest's Preact alias. **That fix has since been applied**:
[`vite.config.ts:26-43`](../../vite.config.ts) `current` now carries a `test.server.deps.inline`
block for the package. The 17:38 run is 3024 passed of 3026.

The two remaining reds are **not this review's subject and not new**:

| Test                                                   | Assertion                                         | Owning file mtime |
| ------------------------------------------------------ | ------------------------------------------------- | ----------------- |
| `src/prompts/prompt-popover.test.tsx:342`              | `.cfg-custom--error` textContent is `undefined`   | 2026-08-16 23:34  |
| `src/ui/settings/sections/agents-section.test.tsx:208` | edited label reads `Aider`, expected `Aider fast` | 2026-08-16 23:34  |

Both files and both their components were last written at 23:34 on 2026-08-16, before this
session opened, and both are uncommitted. They belong to another session's in-flight work.
They are still **red in the tree that would be released**, so they are release debt regardless
of authorship.

### `npm audit` — only one of the four reaches a user

| Package           | Severity                                       | Path                                                       | Ships?                                                                                                 |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `dompurify` 3.4.8 | moderate (4 XSS / config-pollution advisories) | `monaco-editor@0.56.0 → dompurify`                         | **YES** — `monaco-editor` is a runtime dependency and the file editor's chunk is 2.66 MB of the bundle |
| `monaco-editor`   | low                                            | self                                                       | **YES**                                                                                                |
| `undici`          | high (5 advisories)                            | `electron-builder`, `electron@43 → @electron/get`, `jsdom` | no — devDependencies only                                                                              |
| `nanoid`          | high                                           | `vite → postcss → nanoid`                                  | no — build-time only                                                                                   |

`npm audit`'s suggested fix for the DOMPurify chain is `monaco-editor@0.53.0` — a **downgrade**
from the installed 0.56.0, flagged `isSemVerMajor`. Taking it trades a moderate advisory for
three minor versions of editor regressions.
[`docs/plans/2026-08-17-electron-quality-refactor.md`](../plans/2026-08-17-electron-quality-refactor.md)
Task 36 (“Resolve dependency advisories without a forced downgrade”) already names this and is
unexecuted.

### Bundle, measured at 17:39

```
dist/assets/editor.api-m3GNiz7J.js   2,659.25 kB │ gzip: 674.50 kB
dist/assets/index-DZMmldB1.js          983.22 kB │ gzip: 273.42 kB
dist total 4.2M   ·   dist-electron total 1.4M
```

Vite warns on both chunks. Not a blocker; recorded so the cutover's public copy does not claim
a size it has not measured.

---

## The fact that reframes this entire review

**The cutover is not a decision waiting to be taken. It already happened in the renderer, and
only the release pipeline has not noticed.**

- [`src/host/bridge.ts:18-25`](../../src/host/bridge.ts) `current` is the renderer's only door
  to a host. It reads `globalThis.__deckHost` and **throws** `Deck host bridge is unavailable`
  when it is absent.
- The sole injector of `__deckHost` is [`electron/preload.ts`](../../electron/preload.ts)
  `current`. `src-tauri/` installs no `initialization_script`.
- `src-tauri/tauri.conf.json` still points `frontendDist` at `../dist` — the same renderer.
- `scripts/ipc-contract.test.ts`, the one gate that ever crossed the Tauri IPC boundary, is
  **excluded from `npm test`** by [`package.json:24`](../../package.json), and its own docblock
  says why: “SUPERSEDED ON THIS BRANCH… The renderer no longer invokes Tauri commands.” Run
  directly at 17:38:49 it reports **40 commands the renderer calls that no `#[tauri::command]`
  implements** — the browser surface, the file surface, dialogs, menus, resume, session tail,
  sessions list, shell open.

**Two precisions, both of which matter.**

_It is not a blank window._ `desktop_environment`, `window_boot_mode` and `initSettings` each
catch the bridge throw and degrade, so a Tauri build from current `main` boots into a degraded
shell. The proven hard break is the pane: `spawnPane` at
[`src/terminal/pane-lifecycle.ts:183-187`](../../src/terminal/pane-lifecycle.ts) `current`
awaits `deps.pty.spawnShell(...)` with **no `catch`**, unlike the `resizePty` / `killPty` calls
beside it. So the app opens and cannot produce a terminal — which for a terminal is the same
outcome, reached one screen later.

_The installed base is safe._ The bridge swap is commit `5b9305f`
(`feat(electron): implement the Electron host and swap the renderer onto it`, 2026-08-11), and
`git merge-base --is-ancestor v0.12.3 5b9305f` **passes** — the last shipped tag predates it.
Nobody running Deck today is affected. The breakage is latent, in `main`, waiting for the next
tag.

So a `v*` tag today builds, signs and publishes a **Tauri app that cannot open a pane**. This
was found this morning as P0-2 of the maintainability audit; the owner's cutover decision
resolves the fork that finding raised, and this review proceeds on that basis.

The practical consequence for release planning: **the rollback path is fiction.** "If Electron
goes wrong we cut a Tauri release from `main`" does not currently produce a working app. Windows
Electron is not the preferred path; it is the only path.

---

## The second fact, and it is larger than the first

**The Electron host does not run on Windows at all. Not "needs an installer" — it cannot open
a single pane.**

[`electron/platform/windows.ts`](../../electron/platform/windows.ts) `current` is a deliberate,
documented stub. All six of its exports are `never`-typed and throw
`WindowsGateUnresolvedError`: `shellLaunch`, `userHome`, `readProcessTable`,
`foregroundProcess`, `processCwds`, `terminateProcessGroups`. Its own docblock explains why:

> The Tauri build carries ~1,100 audited lines for Windows: `platform/windows/job_object.rs`
> (428 LOC) … and `platform/windows/process_snapshot.rs` (682 LOC) … Neither is ported, and
> that is a decision rather than an omission.

The module is not behind a flag or a fallback. Three call sites reach it unconditionally on
`win32`:

- [`electron/pty/spawn.ts:22`](../../electron/pty/spawn.ts) `current` —
  `process.platform === "win32" ? windows : macos`, then `platform().shellLaunch()`
- [`electron/pty/manager.ts:28`](../../electron/pty/manager.ts) `current` — same selector
- [`electron/pty/info.ts:34`](../../electron/pty/info.ts) `current` — same selector

So on Windows the first pane throws before a shell is spawned. Also stubbed:
[`electron/links.ts:246-248`](../../electron/links.ts) `current` throws unconditionally on
`win32`, so “open this file in my editor” is a hard no-op.

Combined with the first fact, the release position is:

| Host     | State on Windows                                                   |
| -------- | ------------------------------------------------------------------ |
| Tauri    | Renderer throws at `bridge.ts` on first host call — **dead**       |
| Electron | PTY layer throws at `platform/windows.ts` on first pane — **dead** |

**There is currently no host that runs Deck on Windows.** A Windows-first cutover therefore does
not start at packaging or signing; it starts at porting ~1,100 lines of audited Rust process
management into the Electron host, on hardware that can run it. That work has not begun, and the
migration design's own written abort criterion (§11 — "if Windows kill-tree or process inspection
cannot be done without a native addon, the pure Node/TS host decision was wrong and must be
reopened") is still open and unanswered.

---

## Verdict

**NOT READY — and the distance is measured in a port, not in a checklist.**

A Windows-first Electron cutover is blocked on work that has not started, not on work that is
nearly done. The honest ordering of what stands between today and a Windows release:

| #   | Gate                                              | State                                              | Owner decision needed?                                                                 |
| --- | ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Windows process semantics (`platform/windows.ts`) | **not started** — deliberate stub                  | Yes — port to pure Node, or invoke the spec's abort criterion and allow a native addon |
| 2   | Windows packaging target                          | **does not exist** — no `win:` key anywhere        | No, once 1 is answered                                                                 |
| 3   | Windows code-signing certificate                  | **not purchased**; route undecided                 | Yes — gated on the owner's country                                                     |
| 4   | `electron-updater` wired at all                   | **absent from `package.json`**                     | No                                                                                     |
| 5   | Windows Electron CI lane                          | **does not exist**                                 | No                                                                                     |
| 6   | Tauri migration notice (the transition)           | designed today, **zero code**                      | Approve the spec                                                                       |
| 7   | Any diagnostic channel at all                     | **does not exist** — no log file, no crash handler | No                                                                                     |
| 8   | Packaged Windows acceptance pass                  | **never run**, on any host                         | No — it needs hardware and hours                                                       |
| 9   | Owner eye review, ~16 surfaces                    | **outstanding**                                    | Yes — only the owner can do it                                                         |

Nothing above is a reason to stop; several are cheap. But the review's job is the distance, and
the distance is real: gate 1 alone is ~1,100 lines of audited Rust with no pure-Node precedent
in this repo, and it must be written on hardware nobody has confirmed exists.

Gate 7 earns its row rather than a footnote. There is no telemetry by design, so when a Windows
user hits a problem the only evidence is whatever the app left on disk — and the app leaves
nothing: no `crashReporter`, no `uncaughtException` / `unhandledRejection` handler, no
`child-process-gone`, no use of `app.getPath("logs")`, and 105 `console.*` calls that all vanish
in a packaged app. The one real Windows field report this product has ever received arrived with
zero diagnostic artifacts. Shipping Windows-first into that silence is a choice, not an oversight,
and it should be made deliberately.

### What is genuinely healthy

Enumerated so it is not re-audited: the preload allowlist and the browser preload's zero-exposure
design; `will-navigate` / `setWindowOpenHandler` refusal; `path-guard.ts` failing closed on
Windows semantics; the full 30-command IPC name parity between hosts; `WINDOWS_KEYMAP` existing
and being genuinely Windows-idiomatic; `node-pty`'s `win32-x64` / `win32-arm64` prebuilds already
present; the store's corrupt-file write lock and the forced quit-time journal flush (both landed
after this morning's audit); the theme folder model; the fresh-install empty state; every one of
the seven pinned CI action SHAs verified authentic against its tag.

---

## Priority order

Ranked by: **irreversible loss first, then active harm, then what unblocks the most, then what a
user meets in the first five minutes, then everything else.** Severity alone would put the Gate C
port at the top; it is P3 here because three decisions have to precede it and one of them may
change what the port even is.

### An asymmetry that may reorder the whole plan

The Windows-first premise deserves one factual check before weeks are spent on it. **macOS
Electron has been run as a packaged app and passed a six-item gate** (Gate M, 6/6, 2026-08-14).
**Windows Electron has never opened a pane**, and cannot, by design. The stated reason for
Windows-first is that macOS waits on an Apple Developer approval — but that wait is ~48 hours,
while the Windows port is unbounded work whose feasibility the migration spec itself flags as an
open question (§11's abort criterion).

Both platforms still need the same downstream work: a production electron-builder config,
`electron-updater`, a CI lane, and the packaged acceptance pass. macOS needs **only** that work.
Windows needs that work **plus** a port of ~1,100 lines of audited Rust, on hardware nobody has
confirmed exists. If the goal is "ship the new Deck soonest", the evidence inverts the order. If
the goal is "Windows users specifically", the order stands and P3 is where the schedule lives.
This is an observation, not a recommendation to overturn the decision — but it should be made
knowingly.

### P0 — today, minutes, and irreversible if skipped

1. **Commit the fixes that exist only in the working tree.** The corrupt-store write lock and the
   forced quit-time flush — the audit's two most serious findings, both fixed — live nowhere but
   this shared checkout, alongside the Vitest repair that made the suite a usable gate again.
   The bearing files are `electron/store.ts` + `store.test.ts`, `src/lib/load-state.ts` (new),
   `electron/ipc/register-store.ts` (new), `src/settings/settings-store.ts`,
   `src/terminal/session-journal.ts`, `src/ui/app.tsx`, `vite.config.ts`.
   **Commit by explicit path.** Two files are already staged by another session
   (`src/terminal/pane-ping.ts` and its test, both deletions) and a bare `git commit` sweeps them
   in. Leave `src/prompts/prompt-popover.*` and `src/ui/settings/sections/agents-section.*`
   alone — they are another session's in-flight work and they are the suite's only two reds.
2. **Freeze tagging.** A `v*` tag today builds a Tauri app that cannot open a pane, publishes it,
   and — because `src-tauri/tauri.macos.conf.json:27` points every installed client at
   `releases/latest/download/latest.json` — offers it to the existing installed base as an update.
   Nothing is broken until someone tags. Do not tag.

### P1 — three decisions, zero engineering, gating weeks

3. **Gate C's shape: pure Node, or a native addon?** The largest schedule risk in the project. A
   native addon makes this a known, bounded job; pure Node makes it a research task with no
   precedent in this repo and an outcome the migration spec already says may force reopening the
   "full Node/TS host" decision. Nobody has _attempted_ a pure-Node implementation — `windows.ts`
   is a stub, not a failed experiment — so nobody currently knows which world they are in.
4. **Country of residence.** Decides whether Azure Artifact Signing's Individual Developer path
   exists at all (US/CA only) and prunes the entire certificate tree.
5. **Does real Windows hardware exist?** Every Windows claim, and the 33-step acceptance pass,
   depends on it. The private `spacevibe-deck-windows-mirror` remote suggests a workflow once did.

### P2 — long-lead, start the moment P1 answers

6. **Buy the certificate.** 3–5 business days for an SSL.com IV certificate; the Azure individual
   flow publishes no SLA. It is consumed late but must be started early, and its publisher string
   feeds item 7.
7. **Decide the shipping identity** — `appId`, `productName`, publisher, copyright. It blocks
   packaging, it decides whether the installer replaces or orphans the installed Tauri app, and the
   publisher string is what Authenticode reputation accrues against, so it is chosen once and then
   must never drift. Fill `package.json`'s `author` / `description` / `homepage` / `license` /
   `repository` in the same change: electron-builder derives the installer and exe strings from
   them, and today every one is `undefined`.

### P3 — the critical path, in dependency order

8. Port `electron/platform/windows.ts` — kill-tree and process classification. Everything below
   waits on it, and nothing above it in this list does.
9. Production `win:` / `nsis:` block in `electron-builder.yml` (+ `win.icon`, which
   `src-tauri/icons/icon.ico` already supplies).
10. Windows Electron CI lane. The private mirror's `windows-engineering-bundle` job is a working
    template. Add `npm run electron:build` to CI in the same pass so the Electron main process is
    typechecked on push at all.
11. `electron-updater` plus the renderer adapter. **Unblock this from Gate A first** — it is
    stubbed pending an _Apple_ identity, and Windows needs no Apple identity.

### P4 — what a Windows user meets in the first five minutes

Each is small. Together they are the difference between a port and a product.

12. Window chrome — `titleBarOverlay`, or drop `titleBarStyle` on `win32` for a native frame.
    Today there are no caption buttons at all and no double-click-to-maximise.
13. `app.requestSingleInstanceLock` — two instances share one `userData` and race on
    `settings.json`. This is data loss, not polish. `app.setAppUserModelId` rides along, and
    without it agent-attention toasts attribute to "Electron".
14. Saving a file — `save-file` in `WINDOWS_KEYMAP`, a menu bar, or a Save control. Any one.
15. Agent discovery's `win32` branch. Without it the picker shows "Shell only" forever, silently,
    even after item 8 lands.
16. A log file and crash handling. There is no telemetry by design, so this is the _only_
    diagnostic channel that will ever exist.
17. `FONT_FALLBACK` — add Cascadia Mono / Consolas, or panes render in Courier New.
18. `openEditor` on Windows — port `windows_editor_program` and its PATHEXT probe from the Rust
    host, which shares its shape with item 15.
19. `electron/git.ts:15` — `windowsHide: true`. One line; a console window currently flashes on
    every cwd change.

### P5 — before anything is published

20. Decide `releases/latest`: prerelease-first for Electron, or freeze/redirect the Tauri endpoint.
21. Decide the final Tauri release's branch point. It must predate `5b9305f` or carry a
    `__deckHost` shim, or the migration banner ships in a build that cannot open a pane.
22. The landing-page migration explainer, then the banner. In that order — the banner links to it,
    and its §10 risk is live until the page says something true.
23. `README.md:21` — "Your settings carry over automatically on first launch" is the opposite of
    the cutover decision. Then line 101 and the five landing-copy strings across both locales.
24. Third-party licence notices in the package, surfaced in the About panel.

### P6 — cheap, parallel, do while blocked on P1

25. Exclude `smoke.cjs` / `shoot.cjs` from the packaging glob.
26. Move `three` and `ogl` to `devDependencies`; drop the six unimported `@tauri-apps/*` packages.
27. Make "Check for Updates" say "unsupported on this host" instead of "up to date".
28. `will-download` handler on the browser view.
29. IPC sender guards (quality-refactor Tasks 31-34). Not reachable today; the backstop for when it
    is.
30. Resolve the DOMPurify advisory without the suggested `monaco-editor` downgrade.
31. Decide the three hidden-feature flags together: `GRAB_PASTE_DISABLED`, `PANE_TREE_HIDDEN`,
    `SIDEBAR_TOOLS_HIDDEN`.
32. Housekeeping: root `CONTEXT.md` (still titled "Stackgrid"), `RepositoryRail`'s dead CSS import,
    `toolbar-collapsed.png`.
33. CSP — deliberately last of the cheap items, because adding it invalidates the Gate M run.

### P7 — the ship gate, and it cannot be shortened

34. The 33-step packaged acceptance pass on real Windows hardware (~3 hours) —
    [Appendix A](#appendix-a--windows-packaged-acceptance-checklist).
35. Owner eye review across ~16 surfaces. No automated gate substitutes for it, and the review
    session and item 34 are the same sitting.

---

## Criteria

Twelve criteria, each reviewed by a dedicated agent against the working tree. Severity is the
agent's, re-checked by the orchestrator; claims marked **[verified here]** were read back
against the file before being written down.

### C1 — Windows packaging and installer · **NOT READY**

No Windows packaging configuration exists anywhere. `electron-builder.yml` (49 lines) and
`electron-builder.gate-m.yml` (35 lines) each carry exactly one platform key, `mac:`;
`package.json`'s `electron:package` is hardcoded `--mac --arm64 --dir`; `.github/workflows/ci.yml`
contains **zero** occurrences of the string "electron". There is no `win:` block, no NSIS target,
no Windows icon (`src-tauri/icons/icon.ico` exists and is unreferenced), and no script that would
drive one.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | No Windows packaging target exists (see above)                                                                                                                                                                                                                                                                                                 |
| HIGH     | Installer identity vs. the shipped Tauri Windows preview is undecided. Tauri ships `dev.spacevibe.deck` / `SpaceVibe Deck` with NSIS `installMode: "currentUser"` and a live `windows-preview-channel` updater serving 0.11.0. Whether the Electron installer replaces it in place or orphans it with a dead updater is decided in no document |
| HIGH     | `verify:windows-bundle` runs only against `src-tauri/target/release/bundle` (`ci.yml:151`). The checker itself is generic ("exactly one `*-setup.exe`, zero `.msi`") and reusable as-is                                                                                                                                                        |
| MEDIUM   | No `win.icon` wired; `build/` does not exist, so a naive `--win` falls through to electron-builder's default icon                                                                                                                                                                                                                              |

**Healthy:** `node-pty` ships real prebuilds for **both** `win32-x64` and `win32-arm64`
(`pty.node`, `conpty.node`, `conpty_console_list.node`) — the native-module supply chain is not
the blocker. `asarUnpack` is already platform-agnostic.
`scripts/fix-spawn-helper-permissions.mjs:51-53` already early-returns on `win32` with the right
reason, and its test gates the POSIX assertion with `it.runIf`. The vendored react-grab glob has
no extension filter, so MVP plan T19's historical failure appears already fixed.

### C2 — Windows signing and SmartScreen · **NOT READY**

Zero Windows signing surface exists in either host. The uncommitted `release.yml` diff adds
Apple/macOS signing only; the Windows job ("Build unsigned Windows preview draft") is untouched.

**The plan's assumption is wrong in a useful direction.** `docs/plans/2026-08-16-electron-release.md`
P0.3 treats Azure Trusted Signing as closed because the owner has no ≥3-year business entity.
Microsoft Learn's Azure Artifact Signing quickstart (page updated 2026-08-11, six days before this
review) documents a full **Individual Developer** identity-validation path — government ID via
AU10TIX plus Verified ID, no business entity, no 3-year rule. It carries a different restriction:
**the individual must be located in the United States or Canada.** So the gating question is not
"do you have a company" but "where do you live", and it prunes the whole tree.

| Route                               | Eligible?                              | Lead time                                                     | Cost                                      | SmartScreen                                                       | Works with electron-updater?                                                           |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Azure Artifact Signing — Individual | only if US/CA resident                 | individual-flow SLA undocumented; org path 1–20 business days | ~$10/mo, no hardware token                | same as OV                                                        | yes                                                                                    |
| Azure — Organization                | no (no ≥3yr entity)                    | —                                                             | —                                         | —                                                                 | —                                                                                      |
| SSL.com Individual Validation       | yes, worldwide                         | 3–5 business days                                             | $129/yr + ~$20/mo eSigner, or ~$379 token | same as OV                                                        | yes                                                                                    |
| Certum Open Source                  | likely (MIT + public repo), CA decides | manual verification                                           | $49.99                                    | same as OV                                                        | yes; CN reads "Open Source Developer", not a legal name                                |
| Ship unsigned                       | trivial                                | none                                                          | $0                                        | warns every first run; Win11 Smart App Control may block outright | only with `verifyUpdateCodeSignature: false`, losing all update-integrity verification |

**No certificate clears SmartScreen on day one.** EV lost its instant-reputation privilege in
August 2024 and now clears no faster than OV; Microsoft's own SmartScreen page (ms.date
2026-05-04) describes a valid OV/EV signature as "flagged as unrecognized until reputation
accumulates", measured in weeks and hundreds of clean installs.

**Unsigned Electron is a trust regression, not a lateral move.** Today's unsigned Tauri Windows
channel still verifies a **Minisign** signature the OS knows nothing about. `electron-updater`'s
NSIS path has no equivalent: without Authenticode the only integrity check left is a sha512 hash
inside `latest.yml`, fetched over the same channel as the payload it checks. Do not let the ledger
record this as "no worse than before".

**The spec's open question, answered — and it is a foot-gun.** If `publisherName` /
`certificateSubjectName` is ever configured while the binary is not actually signed, the verifier
sees `SignerCertificate: null` and refuses with "New version is not signed by the application
owner". The load-bearing detail: verification behaviour is read from the **already-installed**
app's cached config, so a corrected next release cannot rescue users stuck on a bad first build.
The mitigation is procedural — pin `verifyUpdateCodeSignature: false` explicitly while unsigned,
and add a CI assertion that a publisher name never appears without real signing behind it.

**Do not credit signing with fixing the one real field failure.** The 2026-08-01 report is an NSIS
"Extract: error writing" **when installing to a secondary drive**; the default `%LOCALAPPDATA%`
install succeeded (`docs/CONTEXT.md`). That is path-dependent and happens during extraction — a
different shape from a SmartScreen block, which fires at launch. It is a separate, still-open
defect.

### C3 — Auto-update and the cutover transition · **NOT READY**

`electron-updater` is absent from `package.json`. `electron/ipc/register-updater.ts` is 24 lines
whose own docblock says "the check itself is a stub". The renderer half is complete and
host-agnostic and needs only an adapter.

**An Electron user asking for an update today is told a falsehood.** Traced end to end:
`check-for-updates` → `runUpdateMenuAction` → `controller.checkNow()` → `checkForAvailableUpdate()`
→ `src/updater/tauri-updater-adapter.ts:12-17`, which returns `null` unconditionally when
`__TAURI_INTERNALS__` is absent → result `"current"` → **"SpaceVibe Deck is up to date."** That is
false reassurance rather than an honest "unavailable on this host", and it is a one-line fix
independent of everything else here.

**Auto-update is blocked on a macOS gate for no platform reason.** The updater is stubbed pending
Gate A — an _Apple_ signing identity. Windows needs no Apple identity. If Windows goes first, the
Windows updater path can be unblocked immediately and independently.

**The transition mechanism now exists on paper.** A concurrent session wrote
[`docs/specs/2026-08-17-tauri-migration-notice-design.md`](../specs/2026-08-17-tauri-migration-notice-design.md)
`decided` today (untracked, 17:33): a persistent banner in the **Tauri** build saying this build no
longer updates itself and the new Deck must be downloaded by hand, with one control opening the
landing page. Hardcoded text, no manifest change, Tauri-only. It has **zero code**.

| Transition option                                                        | Possible?                                                                                                                                                                 | Cost                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Banner in a final Tauri build, manual download (**owner-decided today**) | yes — rides the working Minisign channel, no new trust material                                                                                                           | user hand-downloads; clean install; only reaches users who still check for updates |
| Electron installer as the Tauri updater's payload                        | Windows-shape only, never built, and explicitly forbidden by the notice spec's non-goals; macOS cannot take it at all (in-place `.app.tar.gz` swap, not an installer run) | stranded install if it silently fails                                              |
| Tauri build that only launches the Electron installer                    | not designed anywhere                                                                                                                                                     | extra hop, still manual                                                            |
| Manual download only, no notice                                          | today's actual state                                                                                                                                                      | violates AGENTS.md's core requirement outright                                     |

**Two hazards nobody has written down.**

1. **The banner runs in a build that cannot open a pane.** The notice ships on Tauri, and a Tauri
   build cut from current `main` cannot spawn a shell (see "the fact that reframes this review").
   The final Tauri release must therefore be branched from **before `5b9305f`** (2026-08-11), or a
   `__deckHost` shim must land first. No document says this.
2. **`releases/latest` is a moving pointer every installed Tauri client trusts.**
   `src-tauri/tauri.macos.conf.json:27` points them at
   `releases/latest/download/latest.json`, and `release.yml` flips that same release to
   `draft=false`. The first **non-prerelease** Electron release hijacks `releases/latest` and gets
   offered as an update to clients that cannot run it. Decide before any non-prerelease Electron
   release publishes: prerelease-first, or freeze/redirect the Tauri endpoint.

**Windows updater mechanics** (docs-based, unverified on hardware): an unsigned NSIS build _can_
self-update with `verifyUpdateCodeSignature: false`; default `perMachine: false` matches Tauri's
current `installMode: "currentUser"` and self-updates without a UAC prompt; differential updates
fall back to a full download whenever bundled assets change. **Pin a patched `electron-updater`** —
CVE-2024-39698 was a shell-injection bypass in exactly its Windows signature verifier, via
`cmd.exe` environment-variable expansion.

**Healthy:** manifest names cannot collide by construction (`latest.json` / `latest-mac.yml` /
`latest.yml`). `app_relaunch` and `app_version` are really implemented on Electron. The
single-flight is symmetric on both hosts. The update-attempt breadcrumb store is host-agnostic and
works today. The busy-pane guard on update-relaunch is fully implemented in the shared renderer
with live per-pane `pty_info` and update-specific dialog copy — it carries to Electron for free.

### C4 — Release CI, tags and validation · **NOT READY**

No Electron build, package or validation step exists in CI on any platform. Every workflow run
back to 2026-08-07 is `CI` or `Release`, none Electron-shaped.

**The uncommitted workflow diff.** `ci.yml` is pure SHA-pinning. `release.yml` adds the same
pinning plus Developer ID certificate import, notarization env and post-build
`codesign --verify` / `spctl --assess` / `stapler validate` to exactly one job,
`build-macos-stable-draft`; `src-tauri/tauri.macos.conf.json` drops `"signingIdentity": "-"`.

- All **seven** distinct pinned action refs were verified authentic, not merely well-formed:
  `gh api repos/.../compare/<tag>...<sha> --jq .status` returned `identical` for every one.
- `scripts/verify-macos-release-signing.mjs` **fails closed**, and `release-workflow.test.ts`
  proves it by _executing_ the script with empty env (expects failure) and full env (expects
  success) — behavioural, not a grep.
- **None of the six Apple secrets exist.** `gh secret list -R mxrsv/spacevibe-deck` returns only
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Committing this diff makes
  the next `v*` tag fail `build-macos-stable-draft` at the new preflight until the secrets land.
  Nothing is broken today, because a tag against current HEAD runs the old workflow.
- It is wired entirely to `tauri-action` and dies with the Tauri job at cutover — but the
  keychain-import / notarize / staple pattern transfers almost directly to a future Electron macOS
  job. Read as Gate-A credential groundwork, not waste.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BLOCKER  | No Electron CI pipeline exists, on any platform                                                                                                                                                                                                                                                                                                                    |
| HIGH     | `releases/latest` hijack (see C3)                                                                                                                                                                                                                                                                                                                                  |
| HIGH     | CI never typechecks the Electron main process. `tsconfig.json` includes only `src`; `tsconfig.electron.json` is invoked solely by `electron:build`, which appears in neither workflow. Vitest transpiles `electron/*.test.ts` without full typechecking, so a type error in a non-test Electron file merges green                                                  |
| MEDIUM   | `release-workflow.test.ts` only gates the three jobs it already names. Nothing enumerates which jobs may reference `TAURI_SIGNING_PRIVATE_KEY` / `APPLE_*`, or which may upload to a Tauri channel. A new Electron job that copy-pastes the wrong secret passes the suite untouched                                                                                |
| MEDIUM   | `verify-updater-manifest.mjs` (586 lines) hardcodes `latest.json` plus a hand-rolled Minisign/Ed25519 verifier — needs a true Electron sibling. `verify-windows-bundle.mjs` and `create-updater-provenance.mjs` are format-agnostic and reusable as-is. `generate-release-notes.mjs` hard-allowlists channel to `stable`/`windows-preview` — a contained extension |
| LOW      | Recent `main` CI runs are frequently red, including on docs-only commits. Do not treat "CI green" as a trustworthy baseline for a new lane without checking                                                                                                                                                                                                        |

**The `windows-mirror` mystery, solved.** `ci.yml:118-125` throws unless
`github.event.repository.private == 'true'`, and `mxrsv/spacevibe-deck` is **PUBLIC** while
`mxrsv/spacevibe-deck-windows-mirror` is **PRIVATE**. The `windows-engineering-bundle` job can
never run against the main repo — the mirror is where Windows CI actually runs. That is an
already-proven template (private-gate → build → validate → upload) for an unsigned Electron-Windows
preview lane.

### C5 — Windows runtime (main process) · **NOT READY**

The headline is in "the second fact" above. Beyond it:

| Severity         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER          | `platform/windows.ts` — six throwing stubs, reached unconditionally from `pty/spawn.ts:22`, `pty/manager.ts:28`, `pty/info.ts:34`. The seam's _interface_ is POSIX-shaped: macOS's `foregroundProcess` / `terminateProcessGroups` are built on tty→tpgid→pgid joins via `ps`, which do not exist on Windows. Tauri solved it with Job Objects and a process-tree BFS. There is no drop-in port                                                                                                                                                 |
| HIGH             | Agent discovery can never work on Windows **even after the stub is fixed**. `electron/agents.ts:14` imports `macos` directly, bypassing the `platform()` dispatch its three PTY siblings use, and runs `shell -ilc "command -v claude; …"`. On Windows this ENOENTs and `detectAgentsSafely` swallows it to `[]` — the picker shows "Shell only" as if no agent were installed. Tauri's `agent_discovery.rs` probes `["", ".exe", ".cmd", ".bat", ".ps1"]` per PATH directory, because npm-installed CLIs are `.cmd` shims with no bare `.exe` |
| HIGH             | No `app.setAppUserModelId` and no `app.requestSingleInstanceLock` anywhere in `electron/`. Without the first, Windows toasts and taskbar grouping attribute to "Electron", not Deck — and `notification_send` is how agent-attention alerts reach the user. Without the second, launching Deck twice yields two processes sharing one `userData`: last-writer-wins on `settings.json` and `workspaces.json`                                                                                                                                    |
| MEDIUM           | `openEditor` throws unconditionally on `win32` (`electron/links.ts:246-249`). Tauri implements it fully — `windows_editor_program` with shell-operator rejection, argv template parsing, `resolve_windows_executable`'s PATHEXT probe for VS Code/Cursor `.cmd` shims, and `NO_CONSOLE_WINDOW`. A regression, not a gap                                                                                                                                                                                                                        |
| LOW              | `electron/git.ts:15` lacks `windowsHide: true`, which both its siblings set. Git branch is polled per pane-info tick, so a console window flashes on every cwd change. The same defect was found and fixed in the Rust host                                                                                                                                                                                                                                                                                                                    |
| LOW (hypothesis) | `fs.watch` may hold directory handles Windows will not let another process delete or rename underneath — e.g. an agent running `git worktree remove` on an expanded explorer folder                                                                                                                                                                                                                                                                                                                                                            |
| LOW (hypothesis) | Agent data directories are joined onto `os.homedir()` uniformly (`~/.local/share/opencode`, `~/.gemini/antigravity`). `os.homedir()` resolves to `%USERPROFILE%` correctly, but whether those tools actually write there on Windows rather than `%APPDATA%`/`%LOCALAPPDATA%` is unverified                                                                                                                                                                                                                                                     |

**One risk closed by measurement, not argument.** `node:sqlite` — load-bearing for opencode resume
and the rail's turn sentence — had only ever been proven under system Node via `tsx`. Probed
directly inside the Electron binary:

```
$ ELECTRON_RUN_AS_NODE=1 npx electron -e "…require('node:sqlite')…"
OK node:sqlite exports: DatabaseSync,StatementSync,Session,constants,backup
electron-node: 24.18.1  electron: 43.3.0
```

Available. This was a cross-platform risk, and it is now closed.

**Healthy:** `path-guard.ts` fails closed on Windows — cross-drive escape blocked by
`!path.isAbsolute(relative)`, both sides `realpathSync`'d so case and 8.3 names resolve at the OS
level. `git/worktree.ts` and `worktrees.ts` use `execFile` argv arrays with `windowsHide: true`.
`shell-integration.ts` already carries the Tauri host's own audit lesson about blocking UNC probes.
`menu.ts:229-236` deliberately calls `Menu.setApplicationMenu(null)` on non-darwin.
`main.ts:536-539` quits on `window-all-closed` for non-darwin. Resume scanners use `path.join`
throughout.

### C6 — Windows UI and keyboard · **NOT READY**

**The window has no controls.** `electron/main.ts:156-171` is the only `new BrowserWindow()` call
in the host, and it hardcodes `titleBarStyle: "hiddenInset"` — a macOS-only option — with no
platform branch and no `titleBarOverlay`. On Windows this yields a frameless window with **no
OS-drawn caption buttons at all**, not buttons on the wrong side. There is no fallback gesture
either: `desktop-chrome.tsx:76` disables double-click-to-maximize specifically for Windows.

This contradicts three things at once. **DL-18.5** states _"Windows draws its own controls and owns
the system title row"_. The approved Windows spec §7.7 says _"Native Windows title bar, not custom
window controls. Do not recreate minimize, maximize, close in Preact."_ And
`src-tauri/tauri.windows.conf.json:12` sets `"decorations": true` — **the frozen Tauri build
already does this correctly; Electron regressed it.** `desktop-chrome.tsx:43`'s own comment
("native Windows system controls stay outside Preact") shows the author assumed `titleBarOverlay`
would supply them. It never was wired.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | No native Windows window chrome (above)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| HIGH     | The terminal font has no Windows fallback. `settings-schema.ts:150` sets `FONT_FALLBACK = "Menlo, Monaco, monospace"` and `:160` defaults `fontFamily: "SF Mono"`; `pane.ts:112` composes `"SF Mono", Menlo, Monaco, monospace`. All three are macOS-exclusive and no Cascadia/Consolas appears anywhere in the repo, so panes render in Courier New. The chrome stack `--ui-font` _does_ include `"Segoe UI"` — only the surface users stare at all day was missed |
| HIGH     | No right-click context menu anywhere. Zero `contextmenu` handlers in `src/`; Electron supplies none by default. Windows terminal users reach for right-click-paste by reflex                                                                                                                                                                                                                                                                                        |
| MEDIUM   | About Deck, Check for Updates, Hide and the Window submenu's roles live only in the macOS App menu, and `menu.ts:229-241` installs **no menu at all** on non-darwin. No Settings-screen trigger exists for any of them. Alt+F4 still quits, so the app is not trapped                                                                                                                                                                                               |
| MEDIUM   | The entire 2026-08-14→17 chrome reshape would be rendering in a real window for the first time on Windows, layered directly on the frame-row uncertainty above                                                                                                                                                                                                                                                                                                      |
| LOW      | `desktop_environment` resolves async; the first frame renders as neither-mac-nor-Windows on every platform. Already self-documented; cosmetic                                                                                                                                                                                                                                                                                                                       |

**The keyboard is the one Windows surface that is genuinely finished.** `WINDOWS_KEYMAP` lives in
the shared renderer (`default-keymaps.ts:289-358`) and `active-keymap.ts` selects it off the live
`desktop_environment` value. Bare Ctrl+C, Ctrl+W, Ctrl+D and Ctrl+A are all left unbound so they
reach the PTY; Ctrl+Shift+C copies; Ctrl+Shift+V and Shift+Insert paste; Ctrl+Tab cycles tabs;
F3/Shift+F3 find. The 2026-08-10 standard-paste plan's three chords are present verbatim. Nothing
was lost at the cutover — **with one exception, below.**

**Healthy:** `-webkit-app-region: drag` is bridged app-wide from the inert `data-tauri-drag-region`
attribute by `src/styles/11-settings-screen.css:196-209`. `backdrop-filter` needs no per-OS worry —
Electron bundles one Chromium for every platform, unlike Tauri's WebView2-vs-WKWebView split.
Custom scrollbars are Chromium pseudo-elements, same engine both ways.

### C7 — Tauri → Electron parity · **NOT READY**

**Contract shape is clean.** Electron's 30 `CHANNELS` keys are name-identical to all 30
`#[tauri::command]` functions in `src-tauri/src/lib.rs`, and the 17 `PLUGIN_CHANNELS` cover the
plugin surface 1:1, pinned by `scripts/electron-ipc-contract.test.ts` (R6). Every divergence is
behavioural, not structural.

**What a Tauri user loses at cutover**, ordered by impact: Windows PTY spawn / classification /
kill-tree (BLOCKER); auto-update (BLOCKER — every release becomes a manual reinstall on every
platform until an adapter exists); Windows editor-open (HIGH); Windows agent auto-discovery (HIGH);
Windows PowerShell prompt integration (HIGH); preset rename/delete (MEDIUM — orphaned on **both**
hosts since 2026-08-16; `presets-store` still exports both functions with zero callers repo-wide;
create ⌘⇧N and overwrite ⌘⇧S still work).

**What the cutover buys:** repository/worktree rail and create-worktree; session restore and the
rail's turn sentence; the browser tab; themes-as-files; session history; the file explorer.

**A newly found contradiction, in no ledger:** on Windows there is **no way to save a file**.
`save-file` appears exactly once in `default-keymaps.ts:180`, inside `MACOS_KEYMAP` (line 86);
`WINDOWS_KEYMAP` (line 289) has no entry. `menu.ts:229-240` installs no menu bar on non-darwin. No
Save button exists in `src/files/ui/` or `src/ui/`. Open a file, edit it, and there is no keyboard,
menu, or button path to persist it.

**Healthy:** the `src/host/` facades are thin 1:1 wrappers and none manufactures fake success. The
silent-null pattern is narrow and documented (`sessions-host` → the toolbar control simply is not
rendered; `menu-host` swallows deliberately). `resume-host` and `session-tail-host` degrade only a
malformed _response shape_; a real rejection propagates. `bridge.ts` is fail-loud by design.
`RepositoryRail` is confirmed parked, not regressed — its only import is a gallery fixture.
`GRAB_PASTE_DISABLED` costs a Tauri user nothing, because the browser tab never existed there.

### C8 — Security and privacy · **READY WITH CONDITIONS**

This is the most solid criterion in the review. The findings are about a missing backstop, not a
live hole.

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH     | No sender validation on any of **73** `ipcMain.handle` channels — zero uses of `event.senderFrame` anywhere in `electron/`. **Not reachable by page JavaScript today**: `browser-preload.ts` never calls `exposeInMainWorld`, and the browser `WebContentsView` runs `sandbox: true, contextIsolation: true, nodeIntegration: false`. But `browser-preload.ts:24` imports the real `ipcRenderer` into that view's isolated-world preload, and `sandbox: true` stops OS syscalls, not `ipcMain`. A native Chromium renderer exploit reaching that context gets a live `ipcRenderer` and all 73 channels — `spawn_shell` + `write_pty` is RCE. The quality-refactor plan's Tasks 29-34 propose exactly this fix and are unexecuted |
| HIGH     | `readImageAsDataUrl` / `scanWorkspaceFavicon` take a caller-supplied `path` / `dir` with **no root binding** — only an extension allowlist and a 1 MB cap. The explorer channels bind a root; these do not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| MEDIUM   | No Content-Security-Policy anywhere. Lower urgency than it looks: there is no `innerHTML` / `dangerouslySetInnerHTML` / `insertAdjacentHTML` in `src/`, so no known first-stage XSS to reach. CSP is the missing backstop if one is ever introduced — and adding it invalidates the passed Gate M run                                                                                                                                                                                                                                                                                                                                                                                                                            |
| MEDIUM   | The main Deck window runs `sandbox: false` while the browser view runs `sandbox: true`. This is the window rendering PTY output and file contents from arbitrary cloned repos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MEDIUM   | No `will-download` handler. The panel loads any `http(s)` URL and Electron's default with no handler is to save automatically to Downloads, with no prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LOW      | `git worktree add` passes `destPath` as a bare positional with no `--` end-of-options guard. `execFile`, no shell, so flag confusion only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Privacy holds.** The rail's turn sentence is computed per request and sent over IPC to the screen
only — verified never written to `session.json` (the schema has no message field) or anywhere else
on disk. `usage-cache.json` is structurally verified to hold counters, model ids, timestamps and
paths, never conversation text. Session titles and cwds live in an in-process cache that dies on
quit. There are **no outbound network calls** in `electron/` or `src/` except opening the OS
browser to a fixed release-notes URL on a menu click, plus a manual dev script excluded from every
build. "No telemetry, no accounts" survives. One new category the README does not anticipate: the
browser tab keeps a real cookie-persisting session (`persist:deck-browser`) across ordinary web
browsing.

**A flagged risk, dismissed on evidence.** `pubkey: ""` in both `tauri.*.conf.json` files is not a
live gap: `release.yml:169` fails the build when `DECK_UPDATER_PUBLIC_KEY` is empty and `:251`
writes it in with `jq` before bundling.

**Healthy:** zero `shell: true` anywhere in `electron/`; every `execFile` uses an argv array. The
Windows UNC/NTLM-leak class the Rust host fixed **is** ported and shared — `hasRejectedRoot` is
used by `path-guard.ts`, `links.ts` and `fs/read.ts` alike. Atomic writes use `O_CREAT|O_EXCL` on a
unique temp name specifically to close a reproduced symlink-write attack. Pane ownership is
enforced: `write` / `resize` / `kill` all call `assertOwner`, which throws on a mismatched window.
The main window cannot be navigated away from its own document, so its trusted preload cannot be
re-injected into hostile content. Electron 43.3.0 is the current stable line, not EOL.

### C9 — User data, first run and migration · **NOT READY**

**Two of the maintainability audit's four P0s are already fixed in this tree** — the audit is from
00:10 today and is stale on its two most important items. `electron/store.ts:32` now tracks
`state: "ready" | "unreadable"`, `assertWritable()` blocks writes on an unreadable store, seeding
is skipped unless the load succeeded, and the renderer surfaces a real error banner (P0-3).
`flushSessionJournal` takes `{ force?: boolean }` and `app.tsx:606` calls it with `force: true`
(P0-4). **The remaining risk is process, not code: these fixes exist only in an uncommitted,
shared checkout.**

**Data inventory.** Every store is a flat file in one `app.getPath("userData")` root, plus a
`themes/` folder.

| Host / mode                             | Windows root                             | macOS root                                                                            |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Tauri (ships today)                     | `%APPDATA%\dev.spacevibe.deck`           | `~/Library/Application Support/dev.spacevibe.deck`                                    |
| Electron, `electron:dev`                | `%APPDATA%\spacevibe-deck`               | `~/Library/Application Support/spacevibe-deck` — **not isolated from a real install** |
| Electron, packaged mac (local unsigned) | —                                        | `~/Library/Application Support/Deck Electron` — explicitly not the shipping identity  |
| Electron, packaged **Windows**          | **undecided — no Windows config exists** | —                                                                                     |

Tauri and Electron-dev land in different, non-colliding folders on both platforms, which matches
the clean-install decision by accident rather than by design.

**What the user actually loses.** Shorter than it sounds. Settings, presets, custom-agent command
lines, logos and theme files are lost; recents, the session journal and the usage cache all
self-heal. **Only two items are genuinely irrecoverable**: hand-edited theme files in
`<userData>/themes`, and custom-agent command lines if they are not written down anywhere else.
Worth saying plainly to users: **agent conversations are not Deck's data** — they live in each
CLI's own store (`~/.claude`, `opencode.db`) and survive untouched and resumable. What Deck forgets
is which tabs pointed at them.

| Severity | Finding                                                                                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | No first-run question is reachable on Windows (C5)                                                                                                                                                                                                                                              |
| BLOCKER  | The Windows shipping `productName` / `appId` is undecided, so the userData path cannot be stated in user-facing docs                                                                                                                                                                            |
| HIGH     | The migration design §5's two **non-optional** mitigations have not shipped: a final Tauri release telling 0.12.x users to download by hand, and a doc page naming the old store path so values can be copied across                                                                            |
| MEDIUM   | No settings schema version. The only forward-compat mechanism is a hand-maintained `RETIRED_KEYS` scrub list for _removed_ keys, with no hook for a _reshaped_ value                                                                                                                            |
| MEDIUM   | Uninstall leaves userData behind (inferred from the absence of `deleteAppDataOnUninstall`). That is the **right** call — deleting it would destroy exactly what §5's doc page tells users to copy out — but it should be stated, not left implicit                                              |
| LOW      | Both hosts resolve under `%APPDATA%` (Roaming), which corporate roaming profiles and OneDrive Known Folder Move commonly redirect. Neither falls back to `%LOCALAPPDATA%`. Mitigating: a write failure is **not** silent — `writeFileAtomically` throws and a real persist-error banner appears |

**Healthy:** a fresh install with zero recents and zero detected agents is **not** a blank screen —
`OpenBoardHome` renders unconditionally and a zero-agent launch degrades to a plain Shell pane.
Fresh-install session restore returns early before touching `dirsExist` or `resume_lookup`, and
`app.tsx` always falls back to opening the board. The usage cache is version-gated, atomically
written and self-healing by design. The theme folder isolates per-file failures and has size and
count ceilings.

### C10 — Verification debt · **NOT READY**

Evidence ladder, weakest to strongest: `L1` typecheck · `L2` unit suite · `L3` build · `L4` browser
harness · `L5` gallery specimen · `L6` native macOS `electron:dev` · `L7` packaged app · `L8` owner
eye review · `L9` real Windows hardware. **Nothing in this repo has ever reached L9, and almost
nothing has reached L8.**

| Claim                                          | Strongest reached                  | Weakest link                                                        |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Electron replaces Tauri on both platforms      | L6 (macOS only)                    | Gate C hardware-blocked since 2026-08-11                            |
| Windows process semantics                      | —                                  | code throws by design; no pure-Node attempt exists                  |
| Deck ships the Electron host                   | L3                                 | `release.yml` still builds Tauri; no Windows packaging at all       |
| "Renderer-only reaches both hosts" (recurring) | L3                                 | **contradicted** — `bridge.ts` throws without `__deckHost`          |
| File explorer / side panel                     | L7 (stale — reshaped the same day) | owner eye review and the spec's own 13-item pass, run zero times    |
| Unified tab strip                              | L5                                 | no native pass, no owner review                                     |
| Agent rail + turn sentence                     | L6 (unapproved screenshot)         | owner has not approved the screenshot that exists                   |
| Open board one-click                           | **L1 only**                        | three suite files are uncommitted rewrites that have never executed |
| Phosphor icon set                              | **L1 only**                        | four marks never rendered anywhere                                  |
| Modal scrim                                    | L4                                 | photographed over a synthetic ground, not a real xterm canvas       |
| Session restore                                | L2                                 | no native pass                                                      |
| Preset rename/delete                           | —                                  | **false**, self-disclosed                                           |
| Save on Windows                                | —                                  | **false**, newly found here                                         |

**One ledger row is now out of date in the good direction.** The suite is no longer a broken gate:
measured green at 17:38 today (3024/3026, the two reds owned by another session's 23:34 files). Any
"verified by suite" claim written before that fix landed was written against a suite that could not
have been green, so those rows deserve re-running rather than trust — but the gate itself works
again.

**Owner eye review (DL §9.6) is outstanding on ~16 surfaces**: file explorer, browser tab,
tab-strip/document split, AgentQuickPicker, theme gallery, session restore's rail row, both
collapse seams, unified tab strip, modal scrim, quick-picker worktree destination, drag-`New`,
collapsed toolbar, agent rail, the rail's turn sentence, neutral chrome ink, and the new
typography/toggles.

**The deliverable — a 33-step Windows packaged acceptance checklist — is in
[Appendix A](#appendix-a--windows-packaged-acceptance-checklist).** It is ordered the way a
first-time user meets the app, each step carries an observable PASS criterion, and each names the
ledger row it retires. Two of its steps are blocked by code today and are marked as such.

### C11 — Ship hygiene · **NOT READY**

| Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | The documented Tauri hotfix path cannot boot, and CI cannot catch it because it only _compiles_ Tauri, never launches it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| HIGH     | No log file and no crash handling in the packaged app. No `crashReporter`, no `uncaughtException` / `unhandledRejection` handler, no `child-process-gone`, no `app.getPath("logs")` use; the one `render-process-gone` listener only resets menu-recording state. 21 `console.*` calls in `electron/` and 84 in `src/` all vanish in a packaged app. With no telemetry, this is a total support blind spot — and the one real Windows field report already arrived with zero diagnostic artifacts                                                                                                                      |
| HIGH     | Dev entrypoints ship inside the package. `electron/smoke.ts` (531 lines, drives the whole app) and `shoot.ts` compile to `smoke.cjs` / `shoot.cjs`, which the unfiltered `dist-electron/electron/**/*.cjs` glob sweeps in — both confirmed present in the built tree                                                                                                                                                                                                                                                                                                                                                   |
| MEDIUM   | **Three** owner-approved "temporary" flags disable shipped behaviour, not one: `GRAB_PASTE_DISABLED` (`browser-store.ts:100`), `PANE_TREE_HIDDEN` (`agent-rail.tsx:209`, flattens the rail's pane tree) and `SIDEBAR_TOOLS_HIDDEN` (`sidebar-actions.tsx:74`, hides the rail footer; `DeckToolbar` branches on it too). Each is a `const = true` whose comment names the other two as the same revert seam. Not bugs — but a pattern belongs on one checklist                                                                                                                                                          |
| MEDIUM   | `RepositoryRail` is orphaned from the render tree, yet `src/styles/03-repository-rail.css` is unconditionally `@import`ed by the shipping `src/styles.css:12` — dead CSS for an unreachable component                                                                                                                                                                                                                                                                                                                                                                                                                  |
| MEDIUM   | Root `CONTEXT.md` is tracked, last touched 2026-07-27, and opens with `# Stackgrid` — the retired product name. `docs/CONTEXT.md` is the live one                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MEDIUM   | The packaged `app.asar` measures **141 MB** (147,941,689 bytes, built 2026-08-16 23:40 — the last local `electron:package` run, not today's tree) against a 4.2 MB `dist/` and 1.4 MB `dist-electron/`. Identifiable dead weight: `three` (25 MB) + `ogl` (708 KB), used only by `marketing/`'s video pipeline yet listed in `dependencies`; `react` + `react-dom` (7.3 MB), present only as `@phosphor-icons/react` peers and aliased away by Vite for the actual bundle; six of eight `@tauri-apps/*` packages with zero import sites. `monaco-editor` (98 MB) is legitimately used and already dynamically imported |
| LOW      | `toolbar-collapsed.png` sits untracked at the repo root; the two sibling screenshots were gitignored by `7f39c1e` but this third was not                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Two stale beliefs corrected by this criterion.** `src/ui/sessions/` is **tracked on `main`** (via
checkpoint `7be6a04`) and **wired into shipping UI** — `SessionsDockTab` is imported by
`src/ui/app.tsx`. Diffing `main` against `feat/session-history` _deletes_ all eight files, so that
branch is now behind `main`. And `pubkey: ""` is not a security gap (see C8).

**Healthy:** gallery leakage is clean in both directions, enforced by its own test; the only
"gallery" string in the built bundle is an unrelated `theme-gallery` CSS class. Gate M is a fully
separate build graph, proven by `gate-m-entry.test.ts`, and `main.ts` loads it only behind
`DECK_GATE_M=1`. The TODO/FIXME/HACK/`@ts-ignore` sweep is essentially clean — zero TODO-family
markers in `src/`, `electron/` or `scripts/`, re-verified with `grep -a` against this repo's known
NUL-byte hazard. All five `dist*` directories, `.planning/` and `docs/superpowers/` are gitignored
and untracked.

### C12 — Docs, comms and licensing · **NOT READY**

_Drafted by the orchestrator after the assigned agent went idle; the agent's report arrived
afterwards and is merged in. Every figure below was measured firsthand, and the two independent
anchor counts agree exactly._

**README claims that become false.**

| Line    | Text                                                                               | Why it dies                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12      | `built with Tauri 2` badge                                                         | host replaced                                                                                                                                                           |
| 101     | "A native **Tauri 2** shell — **no Electron**."                                    | The selling point inverts. It sat in the same sentence as "no telemetry and no accounts", which **stays true** — do not let the retraction take the honest half with it |
| 113     | `[PtyInfo](src-tauri/src/info.rs#L10-L34)` cited as `current` evidence             | anchor dies (D8)                                                                                                                                                        |
| 114-115 | "Deck doesn't restore sessions across launches: it always opens on the Open board" | **already false** — session restore landed 2026-08-15. This is a rewrite, not an addition                                                                               |
| 271     | "Requires Node.js 20+, Rust (stable), and the Tauri 2 prerequisites"               | contributors no longer need Rust                                                                                                                                        |
| 282     | "**Tauri 2** — native desktop shell (Rust), real PTYs via `portable-pty`"          | now Electron + `node-pty`                                                                                                                                               |

Also line 43 (PTY via Rust's `portable-pty`), line 75 (Windows agent discovery anchored into
`agent_discovery.rs`), line 90 (editor boundary anchored into `links.rs`) and line 267 ("stored as
JSON via the Tauri store").

**Two more that are worse than the badge, and were nearly missed.**

- **Line 21 promises the opposite of the cutover decision.** It reads: _"Formerly **Stackgrid**.
  Same app, new name … **Your settings carry over automatically on first launch.**"_ The cutover is
  a clean install by decision, and `migrate.rs` — the Rust code that made the Stackgrid carry-over
  true — has no Electron port. A user who reads this expects their settings to survive, and they
  will not.
- **Line 19's hero screenshot is stale** (`.github/assets/screenshot.png`, dated 2026-07-15), yet
  it is tagged `current`. It shows the deleted `WorkspaceSidebar` shape, predating every August
  redesign.
- Line 10's badge says `platform-macOS 10.15+`. Electron 43's floor is likely higher; verify
  rather than carry it over. `HYPOTHESIS`.

**The claim lives in five places across two locales, not one.** Beyond `README.md:101`, the
landing prototype carries it as a _proof point_: `marketing/landing-prototype/src/copy.js:67`
`proofNativeTitle: "Native Tauri 2, no Electron"` with `:68`
`proofNativeBody: "A lightweight native shell that stays out of your way."`, mirrored in Vietnamese
at `:149` / `:150` (_"Vỏ native gọn nhẹ, không choán tài nguyên máy"_ — literally "doesn't hog
machine resources"). Worse for a Windows-first release: `copy.js:6` `heroLabel`, `:10` the meta
description, `:76` the footer tagline, `marketing/landing-prototype/index.html:8,10` and
`marketing/video/src/copy.js:97` all say **"native macOS terminal"** — false twice over the moment
Windows leads.

**A caution on the replacement copy.** "No Electron" was sold as a virtue — small, native, not a
browser. Honest replacement copy should claim what is still true (local-only, no telemetry, no
accounts, real PTYs, many agents side by side) and must **not** claim bundle size or memory
without a measurement. The measurement that exists points the wrong way: the packaged `app.asar`
is 141 MB.

**The D8 anchor death toll, counted.** Relative markdown anchors pointing into `src-tauri/`:

| Document                  | Anchors |
| ------------------------- | ------- |
| `docs/CONTEXT.md`         | 25      |
| `docs/ARCHITECTURE.md`    | 18      |
| `README.md`               | 5       |
| `AGENTS.md`               | 0       |
| `docs/DESIGN-LANGUAGE.md` | 0       |
| **Total**                 | **48**  |

Some have a direct Electron equivalent to re-anchor to (`src-tauri/src/links.rs` → `electron/links.ts`,
`pty.rs` → `electron/pty/`, `info.rs` → `electron/platform/classify.ts`). The ones that do **not** —
principally `platform/windows/job_object.rs` and `process_snapshot.rs` — are parity gaps hiding
inside the documentation: a dead anchor with no replacement is the doc telling you the port is
missing.

**Licensing genuinely changes, and the gap is confirmed on disk rather than argued.** A Tauri app
links the OS webview; an Electron app **redistributes Chromium and Node.js**, which carries
third-party notice obligations the Tauri build did not have. Searching the real packaged output —
`dist-electron-app/mac-arm64/Deck Electron.app/` — for any licence file returns exactly two:

```
…/app.asar.unpacked/node_modules/node-pty/LICENSE
…/app.asar.unpacked/node_modules/node-pty/deps/winpty/LICENSE
```

**No Electron `LICENSE` and no `LICENSES.chromium.html` anywhere in the package** — even though
both sit in `node_modules/electron/dist/` ready to be copied. This is electron-builder issue #1495
reproducing in this exact configuration, not a theoretical obligation. electron-builder generates
no npm-dependency notices by default either. What must ship: Electron/Chromium/Node notices plus
`node-pty`, `monaco-editor`, `@xterm/*`, `@phosphor-icons/react`, `three`, `ogl`, `preact` —
generated from the **shipped tree**, not a hand-written list, because `react`/`react-dom` alias to
`preact/compat` and a hand list will get that wrong.
`src/ui/settings/sections/about-section.tsx` already exists and is the natural in-app mount.

**Windows installer metadata has no source.** Measured from `package.json`:

```
name: "spacevibe-deck"    productName: undefined   description: undefined
author: undefined         homepage: undefined      license: undefined
repository: undefined     private: true            version: "0.12.3"
```

electron-builder derives the installer's publisher and copyright from `author`, and the exe's
Properties → Details strings from `description` / `productName` / `version`. With `author` absent,
there is no publisher name to show in the SmartScreen dialog, Add/Remove Programs or the exe
properties — and the publisher string is also what Authenticode reputation accrues against, so it
must be chosen once and then never drift (the repo already has this exact trap documented for
Tauri's `bundle.publisher`).

Tauri sources all of it and Electron sources none of it. `src-tauri/tauri.conf.json` carries
`productName` "SpaceVibe Deck" (`:3`), identifier `dev.spacevibe.deck` (`:5`), publisher "mxrsv"
(`:31`), copyright "© 2026 mxrsv" (`:32`), a short and long description (`:34`, `:35` — the long
one itself says "built with Tauri 2") and a homepage (`:36`). Both existing electron-builder
identities are code-commented as deliberately **not** the shipping identity. No production
Electron appId or publisher has been decided anywhere in the repo.

**A sequencing risk the migration-notice spec names and accepts — surfaced here because it has a
date attached.** Its §10 records that the banner **ships enabled by default**, so its sentence
"this build no longer updates itself" becomes **false** on any Tauri hotfix tagged before the
Electron build is actually downloadable. Two conditions attach and neither is automated: the
landing page must say something true before the next Tauri tag, and any interim hotfix must flip
the constant to `false` by hand. **That landing page does not exist yet** — it is the banner's own
link target (`https://deck.spacevibe.dev/`) and is separately required by migration design §5 as
the place the old store path is documented. It is worth a CI lint rather than memory.

`scripts/generate-release-notes.mjs`'s `WINDOWS_PREVIEW_WARNING` (lines 54-60) tells users an
update "requires Deck's Tauri signature" — the wrong trust root for an Electron build, which has
no Minisign involvement at all.

**There is no `CHANGELOG.md`,** and `scripts/generate-release-notes.mjs` hard-allowlists the channel
to `stable` / `windows-preview` — it has no concept of a host change. The cutover release note needs
a shape this generator cannot produce: what the app now is, that it is a **clean install**, exactly
what does not carry over (settings, presets, custom-agent commands, theme files), where the old data
lives so it can be copied by hand, that agent conversations are untouched and still resumable, and
that SmartScreen will warn.

**The docs work list, in dependency order.**

| #   | Item                                                         | Size         | Note                                                                                                                                                       |
| --- | ------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The cutover plan document                                    | ~half a day  | **Does not exist.** The 2026-08-16 plan says outright the cutover "belongs to a separate cutover plan that does not exist yet". Sequences everything below |
| 2   | Landing-page migration/clean-install explainer               | ~half a day  | **Does not exist**, and it blocks item 3 — it is the banner's link target and migration design §5's home for the old store path                            |
| 3   | Migration-notice banner implementation (+ DL §30)            | small–medium | Design decided today, zero code, awaiting owner approval                                                                                                   |
| 4   | `package.json` identity fields                               | ~15 min      | Do it early; the publisher string must not drift later                                                                                                     |
| 5   | Production `electron-builder.yml` `win:` / `nsis:` block     | medium–large | Gated on the identity decision                                                                                                                             |
| 6   | `README.md` rewrite                                          | ~2h          | The table above                                                                                                                                            |
| 7   | `marketing/**/copy.js`, EN + VI                              | small–medium | ~10 strings, both locales                                                                                                                                  |
| 8   | `docs/ARCHITECTURE.md` (18) + `docs/CONTEXT.md` (25) anchors | ~4h          | Re-anchor per file, not as a block                                                                                                                         |
| 9   | `AGENTS.md` direction + drift table                          | ~1h          | Ongoing                                                                                                                                                    |
| 10  | Third-party notices generation + About-panel surface         | ~half a day  | Generate from the shipped tree                                                                                                                             |
| 11  | Marketing video re-render                                    | large        | Owner-gated, do last — `marketing/stage/appwin.js:62-98` still hand-draws the deleted `WorkspaceSidebar`                                                   |

---

## Appendix A — Windows packaged acceptance checklist

**Equipment:** real physical Windows 10/11 hardware or a persistent (non-CI) VM — `windows-latest`
runners do not satisfy Gate C. Defender and SmartScreen left at defaults, not disabled. Admin
rights. Task Manager open. Sleep/resume-capable hardware. At least one authenticated agent CLI —
prefer `claude`, `codex` or `opencode`, which produce real rail sentences and resumable sessions;
`gemini` and `agy` are best-effort by design. A scratch git repo for the worktree flow. Two
published builds only if also proving the update cycle that day.

**Duration:** ~2.5–3.5 hours for steps 1–33, plus a separate 30–45 minute session for a real
update cycle.

**Hard precondition:** steps 6 onward cannot pass against `main` today. Run it once as a dry read
to confirm scope; run it for real only after C1 and C5's blockers close.

1. Download the installer from the release page, not copied out of a build directory. **PASS:** a
   versioned `.exe` downloads over HTTPS. ⚠ nothing to download yet — no Windows target exists.
2. Install the current Tauri build from `windows-preview` first, as the pre-cutover baseline.
   **PASS:** it launches and opens a shell pane.
3. Run the new installer over/alongside it. **PASS:** completes without touching the Tauri install;
   distinct Start Menu entries, install directories and userData folders. _(closes: "Deck ships the
   Electron host")_
4. Observe first launch without clicking through. Record the exact SmartScreen text, the publisher
   field, and whether Defender quarantines the binary. **PASS or honest FAIL:** unsigned shows
   "Windows protected your PC", no verified publisher.
5. Launch fresh with no prior userData. **PASS:** window opens within a few seconds, no crash
   dialog.
6. Open a pane. **PASS:** it paints and `dir` echoes real output. ⚠ **blocked by code today.**
7. From a fresh boot with no recents, click "Open project" and pick a folder. **PASS:** one click
   lands on a working pane — no Layout+Agent config screen. _(closes: "One click on the open board
   opens the workspace")_
8. Reopen the board; click the now-populated Recents row. **PASS:** reopens silently with the
   last-used preset and agent.
9. Press **Ctrl+T**. **PASS:** a modal opens with the destination config row on top
   (`folder · branch`) and agent chips as a column; a digit key opens that agent in the pane's live
   cwd. _(closes: "AgentQuickPicker's wired flow is native-verified")_
10. From the picker, choose a different worktree, then an agent. **PASS:** the pane opens in that
    worktree, tagged correctly, filed under the right rail row — the first real exercise against a
    live `git_repository` scan anywhere. _(closes: "The quick picker opens into a chosen worktree")_
11. Click the scrim outside the picker. **PASS:** closes with nothing opened. _(closes: "The
    blurred modal scrim is native-verified")_
12. Reopen it; press inside, drag outside, release. **PASS:** stays open.
13. Open two or three more panes across agent types. **PASS:** one chip shape ordered by open time,
    a brand glyph per agent, a 1px frame on the active chip and a faint wash on the rest. _(closes:
    "The unified tab strip is native-verified")_
14. Press **Ctrl+1..9**. **PASS:** digits count all chips in open order, including a document chip.
15. Read the agent rail. **PASS:** every row is one line — a real latest turn for
    claude/codex/opencode, the agent name otherwise, never blank. _(closes: "The rail row shows the
    agent's newest turn")_
16. Let an agent answer, then ask a yes/no question. **PASS:** the rail row and that pane's chip
    show the same sentence; the pane gains attention state while waiting.
17. Settings → appearance → theme gallery. **PASS:** thumbnail cards each painted in their own
    theme; picking one repaints live.
18. Import a theme file (Windows Terminal JSON / iTerm2 / Ghostty / Alacritty TOML). **PASS:** a new
    card appears; deleting the file removes it.
19. Open the docked panel's three tabs. **PASS:** explorer shows a real tree, directories first;
    usage shows this machine's real `~/.claude` and `~/.codex` totals without freezing the UI;
    history lists resumable past sessions. _(closes: "The side panel's three tabs work")_
20. Run the file-explorer spec's own 13-item pass verbatim (§11): deep-expand; click-preview and
    replace; double-click-promote with dirty dot; an agent rewriting a clean open file (silent
    reload, scroll held); an agent rewriting a dirty open file (conflict bar); save propagating to
    the agent; Ctrl+W / window close / Ctrl+Q each asking on a dirty tab; Ctrl+Q with busy **and**
    dirty giving one combined dialog; two windows on one file, last-save-wins; workspace switch
    swapping tree and tabs; both chrome layouts; a 10k-file directory not freezing; 50 MB and binary
    files refusing with a reason. ⚠ **the save step is expected to FAIL as shipped** — no Windows
    keybinding, no menu bar, no button. _(closes: "File explorer is available" + plan T35, run zero
    times before this)_
21. Drag the docked panel's edge past its floor. **PASS:** it closes to width 0; rail, frame row and
    seam collapse together. _(closes: "Sidebar collapse and drag-to-close are native-verified")_
22. Do the same on the sidebar's own seam. **PASS:** same collapse on the second, previously absent
    seam.
23. Restore it with SidebarToggle. **PASS:** returns to its last width, not a default.
24. Click the browser tab's globe chip and navigate to a real URL. **PASS:** its surface covers the
    stage the way the editor does; the page loads. _(closes: "The browser tab works everywhere Deck
    does" — first Windows attempt ever)_
25. Toggle Inspect and click an element. **PASS:** react-grab highlights it. Record whether the copy
    reaches a pane or stops at the clipboard — do not assume the doc note is current.
26. Drag `New` onto an existing pane's slot, then onto a zoomed pane. **PASS:** docks an agent pane
    there; the zoomed case collapses to one target rect. ⚠ the first real-hand exercise anywhere —
    every existing test synthesizes pointers over fabricated rects. _(closes: "Dragging New onto a
    pane docks an agent pane there")_
27. Open the collapsed toolbar's `More` in both chrome layouts. **PASS:** the pane group and the
    DL-28.4 rows share one popover cleanly. _(closes: "The collapsed feature toolbar is
    native-verified")_
28. Quit (Alt+F4 or the close button) with one pane busy **and** a file tab dirty. **PASS:** one
    dialog names both; Cancel preserves everything; Confirm flushes `settings.json` — check its
    mtime — before the process leaves Task Manager, not merely before the window closes.
29. Relaunch immediately. **PASS:** prior tabs reopen and each built-in-agent pane resumes at the
    same point. _(closes: "Session restore resumes agent conversations")_
30. Kill the app from Task Manager, then relaunch. **PASS:** the crash-loop marker is honoured, dead
    cwds are dropped, no ghost tabs.
31. Sleep the machine with an agent mid-turn; resume. **PASS:** the PTY is still alive and
    responsive. _(Windows-only; no prior ledger row)_
32. Close individual panes across two projects, checking Task Manager after each. **PASS:** the
    agent's OS process **and its children** disappear, not just the UI row. ⚠ **blocked by code
    today** — needs `terminateProcessGroups`. _(closes: Gate C itself)_
33. Settings → Check for Updates. **PASS or honest FAIL:** record whether this returns a real result
    or the stub's "up to date". Do not conflate with a full Gate A cycle, which needs two published
    versions.

---

## Open decisions for the owner

Collected from all criteria; agents were instructed to recommend, never resolve.

1. **Gate C's shape.** Port Windows kill-tree and process classification to pure Node, or invoke
   the migration spec §11 abort criterion and allow a native addon? Nobody has _attempted_ a
   pure-Node implementation — `windows.ts` is a stub, not a failed attempt. This is the single
   decision the whole Windows track hangs on.
2. **Does real Windows hardware exist?** Gate C has been hardware-blocked since 2026-08-11 in every
   document. The private `spacevibe-deck-windows-mirror` remote suggests a workflow existed once.
3. **Country of residence** — decides whether Azure Artifact Signing's Individual Developer path is
   available at all, and prunes the certificate decision tree.
4. **Real name or pseudonym on the installer.** IV and Azure-individual certificates print the legal
   name from a government ID; Certum's open-source certificate prints "Open Source Developer".
5. **Shipping identity for Windows** — reuse `dev.spacevibe.deck` / `SpaceVibe Deck` to replace the
   installed Tauri app in place, or a fresh identity that orphans it?
6. **`releases/latest`** — prerelease-first for Electron, or freeze/redirect the Tauri endpoint
   before any non-prerelease Electron release?
7. **The final Tauri release's branch point.** It must predate `5b9305f` (2026-08-11) or carry a
   `__deckHost` shim, or the migration banner will ship in a build that cannot open a pane.
8. **The three hidden-feature flags** — ship as-is, revert, or delete the parked code, decided
   together rather than one at a time.
9. **Provisioning order** — commit the notarization diff before or after the six Apple secrets
   exist?
10. **Version scheme** — a host replacement is a real 1.0 argument. `package.json` and
    `tauri.conf.json` are both `0.12.3`, kept in sync only by a runtime check with no static guard.
11. **Is Windows-first a formal decision?** Nothing in the repo reflects the pivot: the frozen spec
    locks "macOS public, Windows unsigned preview", and the 2026-08-16 plan says outright that
    Windows "does not block anything in this plan".

---

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention. This is a frozen dated review, not a
living document — the drift it records belongs to the documents it reviews.)_

| Claim                                                                | Intent    | Status               | Evidence                                                                                        |
| -------------------------------------------------------------------- | --------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| "A preset can be renamed or deleted"                                 | `current` | **false**            | Confirmed here: `renamePreset` / `deletePreset` still exported, zero callers repo-wide          |
| "Save a file with ⌘S / Ctrl+S"                                       | `current` | **false on Windows** | Newly found: `save-file` only in `MACOS_KEYMAP:180`; no menu bar on non-darwin; no Save control |
| "Renderer-only changes reach both hosts"                             | `current` | **contradicted**     | `bridge.ts` throws without `__deckHost`; only `electron/preload.ts` injects it                  |
| "Every release still builds Tauri" (AGENTS.md)                       | `current` | **misleading**       | True of the workflow, but such a build cannot open a pane                                       |
| `npm test` is red (audit baseline, 00:13)                            | —         | **superseded**       | Measured green at 17:38 today, 3024/3026                                                        |
| Audit P0-3 / P0-4 open                                               | —         | **superseded**       | Both fixed in the uncommitted tree; verified here                                               |
| "Your settings carry over automatically on first launch" (README:21) | `current` | **false at cutover** | Clean install by decision; `migrate.rs` has no Electron port                                    |
| The README hero screenshot is `current` (README:19)                  | `current` | **false**            | `.github/assets/screenshot.png` dated 2026-07-15, shows the deleted `WorkspaceSidebar`          |
| The packaged app ships its third-party licence notices               | —         | **false**            | Only `node-pty`'s and winpty's LICENSE are inside the built `.app`; no Electron/Chromium notice |
| `src/ui/sessions/` is an untracked copy of an unmerged branch        | —         | **false**            | Tracked on `main` via `7be6a04` and imported by `src/ui/app.tsx`                                |

Written 2026-08-17. Not committed — pending owner review (D14).
