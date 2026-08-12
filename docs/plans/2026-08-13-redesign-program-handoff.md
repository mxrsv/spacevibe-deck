# Redesign program — handoff

Date: 2026-08-13 · Written to hand the remaining phases to a session that does not share the
context in which phase 0 ran.

Phase 0 of the [consolidation plan](2026-08-12-redesign-consolidation.md) `current` is done.
This document records where the tree stands, what is still open, and what each remaining phase
needs before it can start. Read it before touching anything; several of the items below cost
this program hours to find and are invisible from the code.

## 1. Where the tree stands

| Ref                          | State                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `main`                       | `3a939bc`, clean, **50 commits ahead of `origin/main`, nothing pushed**     |
| `electron-migration`         | `05d4f73`, dirty with `docs/ARCHITECTURE.md` only; fully merged into `main` |
| `parked/settings-fullbleed`  | `30bb717`, one commit, local only                                           |
| `feat/token-usage-dashboard` | `bf6e1dd`, **worktree dirty**, not merged                                   |
| `feat/workspace-reorder`     | `0972508`, clean, not merged                                                |

`main` now carries the complete Deck **including its Electron host**. It holds both `electron/`
and `src-tauri/`. This is not the release cutover: the tag workflow still builds Tauri, and
moving the release path is blocked on an Apple Developer ID (Gate A).

**To run it:**

```bash
npm install
chmod +x node_modules/node-pty/prebuilds/*/spawn-helper   # see §3.1 — mandatory
npm run build && npm run electron:build
npx electron dist-electron/electron/main.cjs
```

## 2. What phase 0 actually changed

Eight packages landed on `main` from a working tree that had carried months of uncommitted
work, then `electron-migration` merged in. The two changes that matter beyond bookkeeping:

- **The design language has one numbering again.** Three branches had each claimed §15 and
  §16 for different rules. This branch's set moved to §17 Shortcut rows, §18 Command-row frame
  and §19 Docked side panels **before** any merge, leaving §15/§16 a reserved gap that
  `feat/token-usage-dashboard` fills with its own rules unchanged. §20–§22 are reserved stubs
  for the 2026-08-12 visual review's proposals and carry no rules yet. §18 had never been
  written despite five code citations; it was transcribed from its call sites.
- **`scripts/design-language.test.ts` is a new gate.** It fails the suite when a cited rule
  number has no declared rule, when a section number is declared twice, or when its scan
  returns nothing. It reads `src`, `electron` and `scripts`, never `docs/` — see §3.5.

Nothing user-visible changed. The Electron swap replaces the host beneath an unchanged
renderer; `docs/CONTEXT.md` already said it "buys nothing a user can see". **The visual
redesign has not started.** The direction the owner reviewed at `127.0.0.1:5175` is
gallery-only.

## 3. Open items

Ordered by what will bite soonest.

### 3.1 `node-pty`'s `spawn-helper` has no exec bit — every fresh install breaks

`npm install` writes `node_modules/node-pty/prebuilds/*/spawn-helper` at mode `0644`, because
node-pty's own postinstall chmods `build/Release/` and never `prebuilds/`. The only symptom is
`posix_spawnp failed` on the first shell spawn, with nothing said about permissions. The app
paints, the terminal never starts.

The 2026-08-11 spike recorded this and said "a postinstall step must do that for real". It was
never written. **The repository has no `postinstall` script.** Until it does, every clone and
every `npm install` reproduces it.

Fix: add a `postinstall` that chmods both prebuild directories, and a test that fails when the
mode is wrong rather than when a shell fails to spawn.

### 3.2 Nothing is pushed

`main` is 50 ahead of `origin/main`. `parked/settings-fullbleed` exists only in this checkout —
it holds the unapproved Settings full-bleed change that was extracted from the seam commit, and
it was parked in git precisely so it would survive. Right now it survives only as long as this
working copy does.

### 3.3 `scripts/ipc-contract.test.ts` is red at 17 violations

Pre-existing, not caused by the merge: the same 17 appear on `electron-migration` at `05d4f73`.
The cause is structural — `src/host/` facades name Electron IPC channels that have no
`#[tauri::command]` counterpart, and the test still assumes a single host.

This matters more than a red test usually would. It is the only gate in the repository that
crosses the IPC boundary, and it is the gate that caught the `open_pane_window` argument
mismatch after four other gates had passed it. Red here means that coverage is absent, not that
an assertion is stale. Resolving it is an R6 decision.

### 3.4 `electron/fs/read.test.ts` fails on macOS

`listDir > flags a symlink resolving out of the root` expects `/var/...` and receives
`/private/var/...`. The fixture builds under `os.tmpdir()` and macOS symlinks `/var` to
`/private/var`, so `listDir`'s realpath answer and the test's joined path are two spellings of
one location. A test bug, not a product bug, owned by the explorer work that introduced it in
`e0b5cc2`. It blocks any claim that the tree passes `npm test`.

### 3.5 A citation trap the gate cannot see

`docs/specs/2026-08-12-file-explorer-design.md` and `docs/plans/2026-08-12-file-explorer.md`
cite `DL-15.1`–`DL-15.6`. Those numbers are that spec's **own proposal**, which shipped into the
rulebook as §17 with different text; the spec was never updated. They were deliberately left
alone, because rewriting them to §19 would produce citations that look live and land on text
they do not match — worse than a visibly stale number.

**The moment `feat/token-usage-dashboard` merges**, its §15 "Read-only data tables" arrives and
those citations start resolving to data-table rules, through nobody's edit. The citation gate
scans `src`, `electron` and `scripts`, never `docs/`, and widening it to `docs/` would make it
fire on every frozen review that quotes a rule number. **Only this record catches it.** Fixing
it means new text in both documents and needs owner approval.

### 3.6 A declared agent can still impersonate a built-in, on disk

`labelProblem` now rejects a label spelled exactly like a built-in id, so the create and rename
paths are closed. A label **already written to `settings.json`**, or hand-edited there, still
reaches `agentProcessMatchers` unchecked, and a user whose agent is labelled `claude` gets
Claude's dot colour and passes `isPromptAgentId` — Claude's prompt snippets injected into an
unrelated CLI. Judged non-blocking because the feature is new to this branch and the Electron
cutover is a clean install, so no user path reaches it yet. The durable fix is one line:
reject `agent ∈ AGENT_BY_BINARY` inside `validateAgentProcessMatchers`.

### 3.7 Smaller, recorded so they are not rediscovered

- `AGENTS.md` still says "do not install Electron/native dependencies into the primary Tauri
  checkout". The owner's merge decision superseded that rule; it now contradicts the tree.
- `AGENTS.md` line ~48 claims the token usage dashboard is unmerged work held back by the Tauri
  freeze. True today, false the moment §5 lands.
- `main` tracks `docs/plans/2026-08-12-file-explorer.md`, a document the branch that owns it
  does not track. It arrived through the electron merge as a pre-amendment snapshot, so main's
  copy is **older** than the live one. Worth sweeping for other frozen plans in the same state.
- Seven broken documentation anchors span `README.md:33`, `docs/ARCHITECTURE.md` and
  `docs/CONTEXT.md`, all pointing at Windows-desktop spec headings. Pre-existing.
- Dead weight left rather than removed mid-merge: ~180 `SEED_WORKBENCH` lines in
  `src/gallery/seed-data.ts`, orphaned `.gx-workbench*` CSS, and a stale doc comment atop
  `src/gallery/sections/chrome-section.tsx`.
- Nothing in the token usage dashboard's acceptance table has ever been observed running.
- `docs/ARCHITECTURE.md` is dirty on `electron-migration`, holding an unapproved +11-line note
  describing the Electron pane-status contract.

## 4. The remaining phases

Owner decisions already taken. Do not reopen them.

1. Consolidate code first, spec the redesign after.
2. The gallery is the decision surface; no external screenshots are awaited.
3. The ChatGPT-direction ramp ships **rebuilt from `--bg`/`--tone`**, not as fixed hex. Chrome
   keeps following the terminal theme and `deriveChromeColors` keeps its contrast floors.
4. The repository → worktree rail is a real product feature, not a restyled workspace list.
5. Electron merges into `main`; this is not the release cutover.

| Phase | Deliverable                                                                | Blocked on                                                                                  |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1     | Repository/worktree navigation model                                       | its own design spec; Deck knows nothing about git today                                     |
| 2     | Electron chrome redesign — the gallery direction rebuilt from theme tokens | phase 1, because the redesign's left region is that rail                                    |
| 3     | Feature toolbar shipping pass                                              | phase 2                                                                                     |
| 4     | File explorer surface                                                      | phase 2; the merged tree has `src/files/` model and host layers but **no** explorer surface |
| 5     | Usage dashboard and Browser productization                                 | phase 2; §3.5 and §3.7 land with the usage merge                                            |

### What phase 2 must resolve first

`src/gallery/chatgpt-direction.css` declares nine fixed hex values — a neutral surface ramp, one
selection state, one border role. Shipping them as-is would retire `DL-2.1`/§3 and make the four
theme presets affect only the terminal canvas. The owner chose instead to keep the
**relationships** and rebuild them from `--bg`/`--tone`, so chrome still follows the terminal
theme. That rebuild is phase 2's first task, and the gallery's `state matrix` section exists to
prove it across four themes and five states — it is parked in
`src/gallery/sections/matrix-section.tsx`, out of the registry, waiting for exactly this.

## 5. Traps worth knowing before you start

Each of these cost real time in phase 0.

- **A count is not a content check.** A hunk filter that excluded one package and kept the rest
  matched its predicted hunk count exactly and still committed a third package's work into a
  commit whose message promised something else. Select hunks by what they **are**, print what
  was dropped, and read what was staged.
- **`git apply --index` refuses on a partially-staged file**, which is the normal state of every
  file this program split. Use `--cached`, or apply to the worktree separately.
- **Hunk counts move** with the context width and with what has already been committed. Judge a
  filter by which selectors survived, never by the number.
- **A session formatter hook rewrites markdown on save.** It reformatted headings inside a
  frozen review mid-edit. When moving a document that must not change, diff the body afterwards.
- **Do not invent provenance.** A review document here names no author; the honest header says
  so rather than inferring one from a filename.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                          | Intent    | Status         | Evidence                                                                                        |
| ------------------------------ | --------- | -------------- | ----------------------------------------------------------------------------------------------- |
| The tree passes `npm test`     | `current` | `contradicted` | Two failures stand: §3.4's `/var` symlink case and §3.3's `ipc-contract` at 17 violations       |
| `AGENTS.md` describes the tree | `current` | `contradicted` | Its Electron-dependency rule and its token-dashboard claim are both false against `main` — §3.7 |
| Phase 0's work is durable      | `current` | `contradicted` | Nothing is pushed; `parked/settings-fullbleed` exists in one checkout — §3.2                    |
