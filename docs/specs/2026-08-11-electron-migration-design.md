# Electron Migration — Design

Date: 2026-08-11 · Status: decided, pending user approval
Source plan: [electron migration prep](../plans/2026-08-11-electron-migration-prep.md)
`current` · Prep tasks 1 and 3–4 run alongside this document; nothing here is
implemented.

## Goal

Replace Deck's Tauri 2 / Rust host with an Electron host written in
TypeScript, keeping the Preact + xterm renderer, and keeping every product
guarantee a user can currently observe: a real PTY per pane, auto-update with
an explicit **Install & Relaunch**, local-first with no accounts and no
telemetry, macOS public and Windows an unsigned preview.

Non-goals for this document: an implementation plan (that is
`docs/plans/2026-08-11-electron-mvp.md`, written only after the gates in §11
clear); any change to CI, channels, or shipping config; deleting
[`src-tauri`](../../src-tauri); the landing and README copy edit.

**Scale.** [`src-tauri/src`](../../src-tauri/src) is 10,504 lines of Rust
across 30 IPC commands and 10 emitted events. That is the size of the thing
being rewritten, and it is stated up front because "swap the shell" reads
much smaller than it is.

## 1. Motivation, and what it does not buy

The motivation is **ship speed and developer experience**: one language across
main and renderer, a Node ecosystem for the host seams, no Rust build in the
edit loop, no `cargo` toolchain to keep current on two platforms.

It is worth writing down plainly that this buys the user nothing. Tauri is not
failing: the seams are correct, the hardened updater works, pane-detach Phase A
landed. What the user gets from this migration is **worse on three axes at
once** — a larger binary, more RAM, and a one-time loss of every stored
setting (§5). The whole justification is the maintainer's velocity, and that
velocity has never been measured in hours or in build minutes. Anyone
reviewing this later should hold it to that standard rather than to a
technical defect that does not exist.

Accepted knowingly: **binary size goes up by roughly 15×.** Tauri uses the
system WebView; Electron ships Chromium. Measured by the spike on 2026-08-11,
both universal (x86_64 + arm64): the packaged Electron `.app` is **502 MB**
(486 MB of it Chromium in `Contents/Frameworks`, 16 MB app code) against the
installed Tauri build's **33 MB**. RAM was not measured and remains an open
item. The size number is stated here rather than left vague because it is the
concrete price of a decision whose entire benefit is the maintainer's velocity.

## 2. Rejected alternatives

- **Rust NAPI module or a Rust sidecar under Electron.** Would preserve the
  audited Windows code ([`job_object.rs`](../../src-tauri/src/platform/windows/job_object.rs),
  [`process_snapshot.rs`](../../src-tauri/src/platform/windows/process_snapshot.rs))
  and the PTY layer. Rejected because it keeps the Rust toolchain, the
  cross-compile problem, and the two-language debugging story — that is,
  everything the migration exists to remove. Keeping Rust and adding Electron
  is strictly worse than either alone.
- **A long-lived dual runtime** (ship both, migrate gradually). Rejected: two
  hosts means two updaters, two release pipelines, and two places every bug
  can live, at a moment when the reason to move is that one host already feels
  slow to work in.
- **Staying on Tauri.** Not rejected on merit — it is the option this
  migration must beat, and §11's abort criteria are how it gets to win by
  default if the gates fail.

## 3. Target stack

| Layer     | Choice                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| Host      | Electron main process, TypeScript                                                    |
| PTY       | `node-pty`                                                                           |
| Renderer  | unchanged — Preact + signals + xterm.js, built by Vite                               |
| Store     | `electron-store` or plain app-data JSON (decided at MVP, not here)                   |
| Updater   | `electron-updater`                                                                   |
| Packaging | `electron-builder` or equivalent, with notarization                                  |
| IPC       | `ipcMain.handle` ↔ `ipcRenderer.invoke`, `contextIsolation` on, no `nodeIntegration` |

`node-pty` is the one native dependency and the reason Gate B exists. The
spike ran against Electron 43.3.0 and `node-pty` 1.1.0 and found the addon is
pure N-API, so the version pairing is not the fragile thing it looked like —
the packaging config is (§11).

## 4. Decisions locked

1. **Why:** ship speed and DX (§1).
2. **Host:** full rewrite in Node/TS. Rust NAPI, sidecar and dual runtime
   rejected (§2).
3. **Cutover policy:** Tauri features are frozen from 2026-08-11. Hotfixes
   still ship to `releases/latest` and the Windows preview. The token usage
   dashboard and pane-detach Phase B land on Electron only.
4. **Product constraints that survive the move:** a real PTY per pane;
   auto-update with an explicit Install & Relaunch action; local-first, no
   accounts, no telemetry; macOS public, Windows unsigned preview until
   Authenticode. A migration that cannot hold all four is a failed migration,
   not a compromise to negotiate later.
5. **Git isolation:** a dedicated branch **and** worktree, `electron-migration`
   under `~/Documents/Development/spacevibe-deck-worktrees/`. Electron and
   `node-pty` pull native binaries that fight `npm install` in the checkout
   that has to stay ready for a Tauri hotfix. Docs may be edited on the
   primary checkout; anything adding an Electron dependency runs only in the
   worktree.
6. **Apple Developer Program is bought, and macOS builds are signed and
   notarized.** See §6 — this is a hard prerequisite, not a polish item.
7. **Cutover is a clean install; app data is not migrated.** See §5.
8. **A final-notice Tauri release ships before the channels retire.** See §5.

**Sunk, deliberately not ported as-is:** the hardened Tauri updater fork pin
(exact revision `71df1a09…` of `mxrsv/plugins-workspace`) and the pane-detach
Phase A Rust coordinator. Their _behavior_ is re-implemented in TypeScript;
their code has no path forward.

**Answers to the prep plan's §5 open questions (2026-08-11):**

- **The "no Electron" proof point is replaced**, not merely deleted. The lead
  becomes "no accounts, no telemetry" and "made for agent CLIs" is promoted
  beside it — agent detection, attention state, prompt board, presets. It is
  deliberately **not** replaced with a performance claim: Electron would make
  one false, and a claim a competitor can disprove is worse than no claim.
  [`README.md`](../../README.md) and
  [`marketing/landing-prototype/src/copy.js`](../../marketing/landing-prototype/src/copy.js)
  are **not edited by this migration's prep or MVP** — they stay true while
  Tauri is what ships. The edit belongs to the cutover plan.
- **The freeze ends on gates, not on a date.** The prep plan proposed one week
  for the spike and six weeks to MVP parity; both are replaced by "each of
  gates A, B and C has reached a conclusion — pass or abort". A calendar
  deadline enforced against a motivation that has never been measured would be
  a guess with teeth. The cost is accepted and named: **a hanging gate hangs
  the freeze**, and Gate C is hardware-blocked today, so this is a live risk
  rather than a hypothetical one. The mitigation is that an abort is an
  acceptable conclusion — a gate that cannot be met is meant to end the
  migration, not to wait for better conditions.

## 5. Clean install: no data migration

Existing users download the Electron build by hand and start from an empty
profile. **Settings, workspaces, presets, prompt templates and `customAgents`
do not come across.**

What that deletes from the work: Minisign key reuse, a handoff release, a
[`migrate.rs`](../../src-tauri/src/migrate.rs) equivalent, and export/import UI
on either side.

What it costs, stated rather than buried: a user with a configured prompt
board and several declared agents rebuilds all of it by hand, and has a
genuine reason never to move. Two cheap mitigations, both required:

- **A final Tauri release (or a final `latest.json`)** whose notes say the next
  version must be downloaded by hand, shipped _before_ the channels retire.
  Without it, everyone on 0.12.x sits on a build that silently stops updating
  forever and never learns why.
- **A doc page naming the old store path**, so anyone who wants their config
  back can copy the values across by hand.

Neither is code, and neither is optional.

## 6. Signing and notarization — a hard prerequisite

Deck ships **unsigned** on macOS today.
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) carries
only `TAURI_SIGNING_PRIVATE_KEY` (Minisign) and no Apple identity, and the
Tauri updater works anyway because it verifies its own Minisign signature
rather than asking the OS.

`electron-updater` removes that option. On macOS it goes through Squirrel.Mac,
which refuses to update an app that is not `Developer ID Application` signed
and notarized. **Without a paid Apple identity there is no macOS auto-update at
all**, which breaks decision 4 outright.

Therefore, before the updater phase can ship:

- Buy the Apple Developer Program; obtain a `Developer ID Application`
  certificate. **Not bought as of 2026-08-11 — this blocks Gate A.**
- Sign, notarize and staple in the release job.
- Add the CI secrets that do not exist yet: `CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Do not reuse the Tauri Minisign public key.** Field Tauri binaries keep the
  old channels and the old key until cutover; the two update systems must not
  share trust material.

Windows stays an unsigned, separately labelled preview (the existing B2
decision). Whether `electron-updater` can update an unsigned NSIS build **is a
spike question, not an assumption** — if it cannot, Windows preview users lose
auto-update entirely and that is a decision to take explicitly.

Signing the _final Tauri_ build with the newly bought identity is worth doing —
it removes the Gatekeeper warning on the last build users download by hand —
but it is a release-config fork and belongs to the cutover plan.

## 7. Ship phases

### Phase 1 — MVP, single window

**Done when:** a single Electron window runs multiple panes with real PTYs;
splits, tabs, presets, workspaces, settings, agent detection, prompt board,
links, shell integration and the native menu all work; the app quits cleanly
with a busy pane guarded.

**Not done:** multi-window, pane transfer, auto-update, signed release, Windows
verification.

### Phase 2 — Multi-window and pane transfer

**Done when:** peer windows, per-window close, the quit/close census, and the
pane transfer transaction all behave as Phase A does on Tauri today —
including the resolved fork that ⌘⇧M from a **window** holding exactly one pane
is a no-op with a message.

**Not done:** cross-window drag (Phase B on Tauri was never implemented and
stays gated on Windows pointer-capture evidence that no machine exists to
gather).

### Phase 3 — Updater, channels, cutover

**Done when:** a signed, notarized macOS build completes discover → verify →
download → install → relaunch for real; the channel layout is migrated or
replaced; the landing points at Electron artifacts; the final-notice Tauri
release has shipped.

**Not done:** Windows Authenticode.

### Prep (this document's scope)

**Done when:** the forks are recorded, this spec is approved, the branch and
worktree exist, and the spike has reported on all three gates.
**Not done:** anything that adds an Electron dependency to the product
`package.json`, or any renderer refactor — the prep plan's Task 6 is gated on
the spike passing.

## 8. Host IPC surface

The renderer currently imports `@tauri-apps/*` in **44 files** (23 on
`@tauri-apps/api`, 15 `plugin-store`, 14 `plugin-dialog`, 4 `plugin-opener`,
2 `plugin-notification`, and one each of `plugin-updater`, `plugin-process`,
`plugin-clipboard-manager`), plus `data-tauri-drag-region` in 2 files.

The target is that only adapter modules under `src/host/` know which host is
underneath: `PtyHost`, `WindowHost`, `StoreHost`, `DialogHost`, `UpdaterHost`,
`MenuHost`. Existing seeds to extend rather than duplicate:
[`pty-client.ts`](../../src/terminal/pty-client.ts),
[`transfer-client.ts`](../../src/terminal/transfer-client.ts),
[`tauri-updater-adapter.ts`](../../src/updater/tauri-updater-adapter.ts).

The 10 events the host emits (`pty:output`, `pty:exit`, `pty:prompt-ready`,
`menu:action`, `menu:move-pane-to-window`, `transfer:offer`,
`transfer:settled`, `quit-requested`, `window:close-requested`,
`settings:merged`) keep their names and payloads across the move, so the
renderer's listeners are host-agnostic by construction.

**The IPC contract gate carries over.**
[`scripts/ipc-contract.test.ts`](../../scripts/ipc-contract.test.ts) is the
only gate in this repo that crosses the IPC boundary, and it exists because
`open_pane_window` shipped with a parameter-shape mismatch that `npm test`,
`npm run build`, `cargo test` and `generate:menu:check` were all green
through. An `ipcMain.handle` ↔ `ipcRenderer.invoke` equivalent is required
**from the MVP onward**, not added later — the class of bug it catches is
exactly the class a host rewrite produces most.

`data-tauri-drag-region` has no Electron equivalent and is replaced by the
Electron title-bar style, not ported.

## 9. Failure modes

These are the places where a wrong port is silent rather than loud.

**Quit and close census.** Rust owns the census today
([`quit_flow.rs`](../../src-tauri/src/quit_flow.rs),
[`pane_census.rs`](../../src-tauri/src/pane_census.rs),
[`window_close.rs`](../../src-tauri/src/window_close.rs)) precisely because a
wedged webview must not be able to make ⌘Q unanswerable. That ownership moves
to the main process and **must not drift back into the renderer** — the reason
it sits in the host is a failure mode, not a layering preference.

**Windows kill-tree.** [`job_object.rs`](../../src-tauri/src/platform/windows/job_object.rs)
creates a Job Object with kill-on-close and assigns the PID, which is how a
grandchild process cannot outlive its pane. Node has no binding for this. The
candidates are a native addon, `taskkill /T /F`, or relying on ConPTY
behavior — and the first one triggers the abort criterion in §11.

**Windows process classification.**
[`process_snapshot.rs`](../../src-tauri/src/platform/windows/process_snapshot.rs)
is 682 lines that classify a process tree into `IdleShell` / `Agent` / `Busy`.
That output feeds attention state and the quit census, so **a wrong answer is
not a cosmetic bug**: it either lets ⌘Q kill a working agent or leaves the user
unable to quit.

**Transfer fail-safe.** The pane transfer transaction must keep the property
Phase A established: a move may **fail safely** after its boundary deadline
rather than corrupt the TUI, and if both owners are gone the PTY is killed
rather than leaked. Transfer IDs stay process-local integers — no `uuid`
dependency was approved and none is needed.

**The updater trap repeats.** The updater that runs an upgrade lives in the
**old** build. That is the entire reason v0.11.0 existed. Switching updater
implementations re-enters that trap with code this project has never operated,
which is why Gate A demands a real end-to-end run on a real signed build and
not a passing unit test.

**Login-shell PATH parity.** [`agents.rs`](../../src-tauri/src/agents.rs)
detects agents through a login shell with a 3 s timeout, and every pane runs
`$SHELL -l` — that is a public promise on the landing. A `child_process` port
that quietly uses a non-login shell breaks agent detection for anyone whose
PATH lives in `.zprofile`, and it breaks it invisibly.

## 10. Parity matrix

Each row: seam → today → Electron target → phase → risk.

| Seam                                   | Today                                                                                                                         | Electron target                                                                             | Phase | Risk                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----- | --------------------------------------- |
| PTY spawn/read/write/resize/kill       | `portable-pty` / [`pty.rs`](../../src-tauri/src/pty.rs) (870 LOC)                                                             | `node-pty`, owned by main                                                                   | 1     | 🟡                                      |
| Process inspect / agent detect         | [`info.rs`](../../src-tauri/src/info.rs), platform modules                                                                    | Node process helpers                                                                        | 1     | 🟡                                      |
| Login-shell agent detect               | [`agents.rs`](../../src-tauri/src/agents.rs) + [`macos.rs`](../../src-tauri/src/platform/macos.rs), `command -v`, 3 s timeout | `child_process` login shell, same timeout                                                   | 1     | 🟡                                      |
| Store                                  | `@tauri-apps/plugin-store`                                                                                                    | `electron-store` or app-data JSON                                                           | 1     | 🟢 no migration (§5)                    |
| Dialog / clipboard / notify / open URL | Tauri plugins                                                                                                                 | `dialog`, `clipboard`, `Notification`, `shell.openExternal`                                 | 1     | 🟢                                      |
| Native menu + action registry          | generated [`menu_registry.rs`](../../src-tauri/src/menu_registry.rs)                                                          | `Menu.buildFromTemplate` from [`action-registry.ts`](../../src/terminal/action-registry.ts) | 1     | 🟡                                      |
| Quit/close census                      | Rust flights ([`quit_flow.rs`](../../src-tauri/src/quit_flow.rs), [`pane_census.rs`](../../src-tauri/src/pane_census.rs))     | main-process flights                                                                        | 1     | 🟡 depends on the Windows rows          |
| Shell integration                      | [`shell_integration.rs`](../../src-tauri/src/shell_integration.rs) — OSC 133 parser, 128 KB pending cap                       | pure TS port                                                                                | 1     | 🟢 logic-only, ports 1:1                |
| Link resolve                           | [`links.rs`](../../src-tauri/src/links.rs) (993 LOC, Windows branch)                                                          | TS + `shell.openExternal`                                                                   | 1     | 🟡 volume                               |
| Prompt assets scan                     | [`prompt_assets.rs`](../../src-tauri/src/prompt_assets.rs) (692 LOC)                                                          | `fs` in main                                                                                | 1     | 🟢                                      |
| Logo / images                          | [`images.rs`](../../src-tauri/src/images.rs) — data URL, 1 MB cap                                                             | `fs` + base64                                                                               | 1     | 🟢                                      |
| **Windows kill-tree**                  | [`job_object.rs`](../../src-tauri/src/platform/windows/job_object.rs) (428 LOC) — Job Object, kill-on-close, assign PID       | no Node binding exists; native addon, `taskkill /T /F`, or ConPTY behavior                  | 1     | 🔴 abort criterion §11                  |
| **Windows process snapshot**           | [`process_snapshot.rs`](../../src-tauri/src/platform/windows/process_snapshot.rs) (682 LOC) — `IdleShell`/`Agent`/`Busy`      | `ps-list` / PowerShell / native                                                             | 1     | 🔴 wrong output breaks attention and ⌘Q |
| Multi-window transfer                  | [`coordinator.rs`](../../src-tauri/src/coordinator.rs) (1,824 LOC)                                                            | main-process TS coordinator                                                                 | 2     | 🟡                                      |
| Window lifecycle                       | [`window_lifecycle.rs`](../../src-tauri/src/window_lifecycle.rs) (623 LOC) — label alloc, MRU, pending adoption               | main-process TS, same contract                                                              | 2     | 🟡                                      |
| Updater                                | forked Tauri updater + channels                                                                                               | `electron-updater` + new channel layout                                                     | 3     | 🟡 gated on signing (§6)                |
| Single-flight update + busy guard      | [`update_flight.rs`](../../src-tauri/src/update_flight.rs)                                                                    | main-process port of the same intent                                                        | 3     | 🟡                                      |
| Release CI                             | `tauri-action`                                                                                                                | `electron-builder` (or equivalent) + notarize                                               | 3     | 🟡                                      |

**Explicitly not carried over:** the updater fork pin, `tauri.conf`
capabilities, the WebView2 hardening, `data-tauri-drag-region`, and
[`migrate.rs`](../../src-tauri/src/migrate.rs).

## 11. Gates and abort criteria

The spike (prep plan Task 4) runs in the `electron-migration` worktree, never
wired into a shipping entrypoint. It exists to answer the questions that can
kill the migration — not to prove that a shell renders.

**Gate A — updater.** `electron-updater` completes discover → verify →
download → install → relaunch on a **signed and notarized** macOS build, by
hand, the same class of proof v0.11.0 required. Also record what
`electron-updater` does with an unsigned Windows NSIS build.
**Blocked 2026-08-11: the Apple Developer Program is not bought yet.**

**Gate B — native build in CI.** `node-pty` builds for a universal macOS
binary (arm64 + x64) inside GitHub Actions.
**Partial as of 2026-08-11 — everything except the CI run is done.** The spike
produced a universal `.app` locally with `electron-builder` (`file` confirms
both slices) and the packaged bundle passes the full PTY script 7/7. The
feared part of this gate turned out not to exist: `node-pty` 1.1.0 is pure
N-API (38 `napi_*` imports, zero `v8::`/`node::` symbols), so its prebuilds are
ABI-stable across Electron versions and there is no per-Electron rebuild
problem. What remains is packaging config, now known:

- `mac.x64ArchFiles` must cover `**/node_modules/node-pty/prebuilds/**`, or
  `@electron/universal` refuses the merge — it rejects single-arch Mach-O files
  that are identical in both arch builds, which per-arch prebuild directories
  always are.
- `asarUnpack` must cover `node-pty`. `unixTerminal.js` rewrites `app.asar` →
  `app.asar.unpacked` for the `spawn-helper` path, so the module cannot run
  from inside an asar.
- A postinstall step must `chmod +x` the prebuilt `spawn-helper`. The npm
  tarball ships it `0644` and node-pty's own postinstall only chmods
  `build/Release/`, never `prebuilds/`. The only symptom is
  `posix_spawnp failed`, with nothing pointing at permissions — the same
  file-mode failure family as the Tauri updater's issue #3506.

The gate is **not cleared** until one GitHub Actions run produces it, because
"builds on the maintainer's arm64 Mac" and "builds on a CI runner" are not the
same claim.

**Gate C — Windows process semantics.** Decide whether kill-tree and process
inspection have a pure-Node path.
**Blocked on hardware: no Windows machine is available.** Said out loud here
rather than softened into a note, because it is the top risk in the migration.

**Written abort criterion.** If Gate C can only be met with a native addon,
**decision 2 was wrong and must be reopened explicitly.** Adding the addon
quietly and carrying on is the failure this criterion exists to prevent: it
would delete most of the DX argument that motivates the migration while
leaving the migration in flight.

**Freeze end condition.** The Tauri feature freeze lifts when all three gates
have reached a conclusion. An abort is a conclusion. If the migration aborts,
Tauri unfreezes and the token usage dashboard resumes.

## 12. Testing

- Unit tests move with the logic they cover; the pure-logic ports (shell
  integration, links, prompt assets, settings merge) should arrive with their
  Rust test cases translated, not re-invented.
- **`npm test` and `npm run build` are weak evidence for the adapter work.**
  The suite mocks `@tauri-apps/*`, so swapping imports for facades keeps it
  green by construction. Adapter changes need a manual pass under
  `npm run tauri dev`: open a pane, split, switch preset, open settings, open
  the prompt board, ⌘⇧M detach, and quit with a busy pane.
- The IPC contract test (§8) is required from the MVP onward.
- Gate A cannot be replaced by a unit test, by design.

## 13. Assumptions and open items

- **Confirmed 2026-08-11:** a Vite-built Preact + xterm renderer loads from
  `file://` under `contextIsolation` with `nodeIntegration` off, and reaches
  the PTY only through a preload bridge. That is the facade shape §8 asks for,
  proven rather than assumed.
- **Confirmed 2026-08-11:** `node-pty` matches `portable-pty` closely enough
  on spawn, stream, resize and kill for the pane lifecycle to be unchanged.
  Resize was verified by reading `tput cols` back from the shell, not by
  trusting the return value, so SIGWINCH is proven to arrive.
- **Confirmed 2026-08-11:** login-shell agent detection ports directly.
  `$SHELL -ilc "command -v …"` under `child_process.execFile` with a 3 s
  timeout found all five built-in agents in 0.8–1.2 s, matching
  [`agents.rs`](../../src-tauri/src/agents.rs). The interactive flag (`-ilc`,
  not `-lc`) must carry over — it is deliberate, because PATH commonly lives
  in `.zshrc`.
- **Open:** `electron-store` versus plain app-data JSON — decided at MVP.
- **Open:** RAM. Not measured; only binary size was (§1).
- **Open:** whether `electron-updater` updates an unsigned Windows NSIS build
  (§6). If not, Windows preview loses auto-update and that becomes an explicit
  decision.
- **Open:** the GitHub release list convention. An in-flight decision already
  wants one release per version with the Windows installer as an asset inside
  it; the channel rework in Phase 3 overlaps it directly and the two should be
  designed together rather than twice.
