# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app — unrelated to the SpaceVibe web/backend repos, no shared DB or API.
> Never edit sibling repos from this session. Workspace map: [`../AGENTS.md`](../AGENTS.md) `current`.

A minimal macOS terminal for running many AI agent CLIs side by side. Formerly Stackgrid. Stack: Tauri 2 + Rust backend, Preact + xterm.js frontend, Vite 6, Vitest. All strings, comments and docs in this repo are **English only**.

## Direction & forks

**Where this is going.** A minimal macOS terminal for running many agent CLIs side by
side. Standalone desktop app — no shared DB, no API, no dependency on the web repos.

**In flight — already decided, do not reopen:**

- v0.10.0 shipped 2026-08-04 (macOS stable + unsigned Windows preview). The tag is
  what CI builds from, and `validate-source` rejects a tag whose `package.json`,
  `Cargo.toml` and `tauri.conf.json` versions disagree.
- v0.11.0 shipped 2026-08-05 — the hardened-updater release, and the gate that
  blocked everything else is closed. `releases/latest` and the first-ever
  `windows-preview-channel` both serve it. What it changed and what was verified
  now lives in [`docs/CONTEXT.md`](docs/CONTEXT.md) `current` and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) `current`; the plan it came from
  is frozen at
  [hardened-updater release plan](docs/plans/2026-08-04-hardened-updater-release.md) `current`.
- The updater fork is [`mxrsv/plugins-workspace`](https://github.com/mxrsv/plugins-workspace),
  branch `fix/updater-macos-transactional-swap`, based on upstream `v2` commit
  `622f02bf` (the `ShellExecuteW` fix, PR #3516). Deck pins the exact revision
  `71df1a095d007fb94f0eb07940b0a78e57ac984e` in
  [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) `current` — an exact commit and
  not the branch, because a moving ref would change what ships without changing
  the tree. Base is `622f02bf` rather than `v2` HEAD so the pin carries only the
  three needed fixes: `v2` HEAD adds the `system-proxy` feature, which drags new
  dependencies into the bundle. Unpin once upstream releases a version
  containing #3505, #3506 and #3516.
- The updater that runs during an upgrade is the one inside the OLD build. So
  the hardening in 0.11.0 cannot protect the 0.10.0 → 0.11.0 hop itself: users on
  0.10.0 either bootstrap manually one last time or accept the unhardened
  updater for exactly that one transition. From 0.11.0 onward the guarantee holds.
- Verification before release required two hardened release candidates
  (`0.11.0-rc.1` → `0.11.0-rc.2`) upgraded for real on macOS AND Windows, plus a
  tampered-signature case and failure injection. **What actually ran (2026-08-05):**
  macOS upgraded for real end to end — discover, verify signature, download,
  install, relaunch — and the installed bundle kept mode `0755` instead of the
  extraction directory's `0700`, which is issue #3506 proven fixed at runtime and
  not only in tests. The tampered-signature case passed: a manifest advertising a
  non-existent `0.11.0-rc.3` with one flipped signature byte was downloaded and
  refused, with no install and no bundle touched. **Windows E2E was deliberately
  skipped** (decided 2026-08-05) — accepted because `windows-preview-channel` did
  not exist before 0.11.0, so no Windows user could receive an update through it
  and none can lose an app. The cost is the same trap this release exists to
  escape: the updater that runs an upgrade lives in the OLD build, so if the
  Windows updater is broken in 0.11.0 it cannot be patched retroactively and
  Windows users bootstrap by hand once more at 0.12.0. `ShellExecuteW` (#3516) is
  therefore in the shipped binary but never observed running. Failure injection
  was skipped too: the swap takes seconds, so killing it at the right instant is
  not reproducible; the breadcrumb logic carries 11 unit tests and the
  lose-the-app failure is covered by the fork's rollback tests.
- A refused signature reads as a network problem. The tampered-signature run
  surfaced it: verification happens inside Tauri's download step, so the UI lands
  on `download-failed` and
  [tells the user the download failed](src/updater/update-action.tsx#L24) `current`
  when the download in fact succeeded and the signature did not verify. Those are
  a flaky connection and a tampered update — the second deserves to stop the user,
  not invite another Retry. Left out of 0.11.0 because that release admits no UI
  work; it needs its own task.
- The GitHub release list has no convention, and 0.11.0 made that visible
  (raised 2026-08-05). Channel releases are **pointers, not versions** — each
  holds one `latest.json` — yet they sit in the list looking exactly like
  something to download, and every version costs two rows because the Windows
  preview is a separate release. Decided: finish 0.11.0 first, then collapse to
  one release per version with the Windows installer as an asset inside it, and
  write the rule down here. Not started. The prerelease flag itself stays — it is
  what keeps `releases/latest` from serving a test build to real users, not
  decoration.
- Landing download links resolve from the releases API at load (2026-08-01): the
  hand-bumped Windows prerelease pin is gone — publishing a release is the act
  that points the landing at it, so links never rot between releases.
- The `deck.spacevibe.dev` landing has no host chosen yet (domain parked).
- Four code comments still cite `FR-`/`ADR` against the claim in `docs/CONTEXT.md`
  (`agents.rs`, `open-board.tsx`, `migrate.rs`) — logged in that file's drift ledger,
  awaiting a human call: strip the comments or soften the claim.
- The marketing video renders from the DOM stage shared with the app — breaking app
  components silently breaks the video.
- Cross-platform auto-update for macOS and Windows is approved (2026-08-02), with
  the no-fee B2 Windows preview channel chosen on 2026-08-03: use free Tauri updater
  signing and GitHub Releases; auto-check only, then expose an explicit chrome
  `Update` → `Install & Relaunch` action beside Settings. Windows remains an unsigned,
  separately labelled prerelease until paid Authenticode signing is chosen later.
- Production builds minify with Terser, not esbuild (PR #9, merged 2026-08-04): esbuild
  0.25 drops xterm 6's function-local enum in `InputHandler.requestMode` but keeps a
  renamed reference, so the DECRQM query OpenCode sends at startup throws and stops
  xterm's write queue for good — a blank pane. `scripts/vite-config.test.ts` locks it.
- User-declared agents (`M2`) are approved (2026-08-04): an agent is a label plus a full
  command line, declared in a new Settings category, and `AgentChoice` stays a string id
  whose built-in ids equal their binary names — so every `lastAgent` already on disk
  keeps resolving and no migration exists to get wrong. The editable list needs a new
  design-language rule (§12), approved with it. See
  [spec](docs/specs/2026-08-04-user-declared-agents-design.md) `decided`.
- Antigravity CLI (`agy`) is the fifth built-in agent, decided and shipped
  2026-08-07. Google cut Gemini CLI off from free, AI Pro and Ultra users on
  2026-06-18 in favour of `agy`, so a Deck user on the new CLI got a pane with
  no dot color, no agent label and no chip. Four calls, each with its reason:
  **Gemini CLI stays** alongside it — paid Code Assist licences still reach the
  service, and a built-in id equals its binary name, so removing `gemini`
  would strand every `lastAgent` already on disk. **Label is "Antigravity"**,
  not "Antigravity CLI" — it fits the chip. **The dot shares Gemini's
  `--cyan`** rather than taking a new token: a fifth agent color does not
  exist in the eight the theme injects, and the `brightBlue` token first
  chosen was dropped on evidence — it equals `blue` in three of the four
  presets, and `--accent` _is_ the theme's blue, so the dot would have read as
  the accent color. **The row is ordered by reach, not history** — Claude,
  Codex, OpenCode, Antigravity, Gemini — which moves the digit keys people
  already know; accepted knowingly so the row leads with what gets used. The
  brand mark is the first raster one in `AGENT_LOGOS`, since Google publishes
  the icon as PNG. Deliberately left open: `agy`'s OSC 9;4 behaviour is
  unobserved because nobody here has it installed. Detail in
  [`docs/CONTEXT.md`](docs/CONTEXT.md) `current`.

**Forks → STOP and ask before writing code.** Collect them into ONE round at the start
of the task; if there are none, say "no forks" and just go.

- The load-bearing `src-tauri` seams: PTY, window coordinator, tab materialize, layout
  engine, close coordinator (R4).
- Bundle, signing, release or version config.
- Changes to the design language rules in `docs/DESIGN-LANGUAGE.md` (R2).
- Adding a dependency, or anything that changes what ships in the app bundle.

Not a fork: renaming internals, adding tests, styling within the existing DL rules,
editing the menu registry (never the generated output — R3).

**Write the answer down.** When the user resolves a fork, it MUST be recorded in the
"In flight" list within the same task, with a one-line reason; until it is written, the
work is not done. This list is a QUEUE, not an archive: once a thread closes, move the
decision down into `docs/ARCHITECTURE.md`.

**Prove it with commands** (L5/W4 — no output, no "done"): `npm test` ·
`npm run build` (this is `tsc && vite build`, so it covers typecheck). No separate
`lint` script in this repo. Note this repo uses **npm**, not pnpm like the web repos.

## Common commands

| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server (web-only preview)                                  |
| `npm run tauri dev`     | full desktop app                                                    |
| `npm test`              | Vitest unit tests                                                   |
| `npm run build`         | typecheck + production build                                        |
| `npm run generate:menu` | regenerate menu from registry — never hand-edit generated menu code |
| `npm run video:render`  | render the marketing video from the DOM stage                       |

## Layout

```
src/                 # Preact UI
├─ chrome/           #   window chrome, tabs
├─ terminal/         #   xterm.js panes
├─ open-board/       #   workspace board (open/recents)
├─ presets/          #   layout presets
├─ settings/         #   settings UI + stores
└─ lib/              #   pure helpers
src-tauri/src/       # Rust: pty, window coordinator, menu, migrate…
marketing/           # marketing video stage (shares components with the app)
docs/                # DESIGN-LANGUAGE.md (DL rulebook), CONTEXT.md, specs/, plans/, review/
```

## Repo rules (R-rules — delta from the global standard)

- **R1.** English only for every string, comment and doc — no Vietnamese in this repo.
- **R2.** Chrome UI styling follows `docs/DESIGN-LANGUAGE.md`; rules are numbered (`DL-3.2`) and cited from code comments. Fix a violation → update the ledger at the bottom of that doc.
- **R3.** Menu code is generated (`npm run generate:menu`, checked by `generate:menu:check` in CI) — edit the registry, not the output.
- **R4.** The Rust PTY/window coordinator, tab materialize, layout engine and close-coordinator paths are load-bearing seams — treat `src-tauri` module boundaries as in-flight when planning changes there.
- **R5.** State is Preact signals; module stores are window-scoped.

## Known traps

- The ADR pipeline (`docs/decisions/`, PIPELINE.lock, derived docs) was removed on 2026-07-27 — old plans/reviews still reference it; they are point-in-time records, leave them as written.
- Marketing video renders from the DOM through a virtual clock and shares the app stage — breaking app components can silently break the video.

## Language

- Docs/comments: **English only**. Commit messages: English, conventional commits.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

Empty as of 2026-08-04: the v0.8.0 row was cleared when v0.10.0 became the
release in flight. Do not remove this section (D7).
