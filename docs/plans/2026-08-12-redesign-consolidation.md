# Redesign Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn four divergent branches and two dirty working trees into one integration
branch whose design-language rulebook has a single, enforced numbering, so the Electron
redesign and the five queued features are built once rather than three times.

**Architecture:** Land every dirty change as reviewable commits on the branch that owns it,
then renumber the design-language sections on `electron-migration` **before** any merge, so
the numbers `§15`/`§16` are free when `feat/token-usage-dashboard` arrives. A new scripted
gate asserts that every `DL-x.y` cited in code exists as a rule in the rulebook, which is
what keeps the renumber honest and stops the collision recurring. The merges themselves are
the [trunk merge plan](2026-08-12-redesign-trunk-merge.md) `building`, which starts where
this one ends.

**Tech Stack:** git worktrees, Vitest, TypeScript, Vite, Preact, Electron 43, node-pty.

## Global Constraints

- **R1.** English only for strings, comments, docs and commit messages.
- **R2.** Design language is executable policy; a numbered rule change is a fork that needs
  owner approval. Code comments cite rules by id.
- **R7.** Gallery imports flow app → gallery only. No shipping module imports `src/gallery/`.
- **D4.** Specs live at `docs/specs/YYYY-MM-DD-<topic>-design.md`, plans at
  `docs/plans/YYYY-MM-DD-<topic>.md`, reviews at `docs/review/YYYY-MM-DD-<topic>.md`.
- **D14.** Never `git commit` documentation before the owner has approved its content.
- **W5.** Conventional commits with a scope; one commit is one complete piece of work.
- **Branching.** A new branch always gets its own worktree under
  `~/Documents/Development/spacevibe-deck-worktrees/`.
- **Minimum gate.** `npm test && npm run build && npm run generate:menu:check`.
- **Tauri freeze.** Nothing in this plan changes shipping Tauri behaviour. `src-tauri/` is
  touched only where a merge forces it.
- Baseline measured 2026-08-12 on `main` with its dirty tree: `npm test` 1278 passed across
  109 files, exit 0.

---

## Program map

This plan is phase 0 of six. The later phases each get their own spec and plan; they are
listed here only so the consolidation is done in a way that serves them.

| Phase | Deliverable                                                                | Depends on |
| ----- | -------------------------------------------------------------------------- | ---------- |
| 0     | This plan — one trunk, one rulebook, one gate                              | —          |
| 1     | Repository/worktree navigation model (spec + implementation)               | 0          |
| 2     | Electron chrome redesign — the gallery direction rebuilt from theme tokens | 0, 1       |
| 3     | Feature toolbar shipping pass                                              | 2          |
| 4     | File explorer surface                                                      | 2          |
| 5     | Usage dashboard integration and Browser productization                     | 2          |

Owner decisions already taken, not to be reopened by an implementer:

1. Consolidate code first, spec the redesign after.
2. Merge `feat/token-usage-dashboard` and `feat/workspace-reorder` in this pass.
3. The gallery is the decision surface; no external screenshots are awaited.
4. The ChatGPT-direction ramp ships **rebuilt from `--bg`/`--tone`**, not as fixed hex.
   Chrome keeps following the terminal theme, and `deriveChromeColors` keeps its contrast
   floors. Phase 2 owns that rebuild; phase 0 only preserves the direction as gallery-only.
5. The repository → worktree rail is a real product feature, not a restyled workspace list.
   It sequences ahead of the redesign because the redesign's left region depends on it.
6. Integration happens on a new `redesign-trunk`; `electron-migration` stays as the fallback.
7. The three workbench compositions from `f2cdf3f` are retired from the gallery registry
   once the trunk exists. Git history keeps them.

## Starting inventory

| Tree / branch                                    | State                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `spacevibe-deck` (`main`)                        | 1 commit ahead of `origin/main`; dirty: 15 modified, 7 untracked paths                         |
| `spacevibe-deck-worktrees/electron-migration`    | 1 commit ahead of `origin/electron-migration`; dirty: 31 modified, 1 deleted, 2 untracked      |
| `spacevibe-deck-worktrees/token-usage-dashboard` | 10 commits ahead of `main`; no remote; dirty: `AGENTS.md`, `docs/CONTEXT.md`, 2 untracked docs |
| `spacevibe-deck-worktrees/workspace-reorder`     | 6 commits ahead of `main`; no remote; clean                                                    |

## Design-language collision

Three branches claim the same section numbers with different meanings.

| Section | `electron-migration`                      | `feat/token-usage-dashboard`            |
| ------- | ----------------------------------------- | --------------------------------------- |
| §11     | Settings shell                            | Full-window screens (renamed, superset) |
| §15     | Shortcut rows                             | Read-only data tables                   |
| §16     | Command-row frame (cited, heading absent) | The display figure                      |
| §17     | Docked side panels                        | —                                       |

Citation counts in code decide who moves: `token-usage` carries ~75 citations of its
`DL-15.*` / `DL-16.*`, `electron-migration` carries 22. The cheaper set moves.

**Agreed map:**

| Rule id before                | Rule id after                | Meaning                                                                                                                               |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DL-15.*` (token-usage)       | unchanged                    | Read-only data tables                                                                                                                 |
| `DL-16.*` (token-usage)       | unchanged                    | The display figure                                                                                                                    |
| `DL-15.*` (electron)          | `DL-17.*`                    | Shortcut rows                                                                                                                         |
| `DL-16` (electron)            | `DL-18`                      | Command-row frame                                                                                                                     |
| `DL-17`, `DL-17.2` (electron) | `DL-19`, `DL-19.2`           | Docked side panels                                                                                                                    |
| —                             | `§20`, `§21`, `§22` reserved | Numeric scales, Interaction states, Surface genres (proposed by the 2026-08-12 visual review; unwritten until an owner-approved fork) |

---

## File structure

**Created by this plan:**

- `scripts/design-language.test.ts` — the citation gate. Parses `docs/DESIGN-LANGUAGE.md`
  for declared rule ids, scans `src/**` and `electron/**` for cited ids, and fails on a
  citation with no rule, on a scan that returned nothing, and on a duplicated section
  number. Sits beside `icon-system.test.ts` and `ipc-contract.test.ts`, which are the
  repository's existing filesystem-scanning gates.
- `docs/review/2026-08-12-worktree-loading-ring.md` — the misfiled review currently at
  `docs/plans/perform-a-read-only-code-noble-riddle.md`, moved to its correct folder and
  name under D3/D4.

**Modified across the plan:** `docs/DESIGN-LANGUAGE.md` (one merged rulebook),
`docs/CONTEXT.md`, `AGENTS.md`, `src/styles.css`, `src/gallery/section-registry.ts`,
`src/gallery/gallery.css`, and the nine files carrying `electron-migration`'s `DL-15/16/17`
citations.

**Deleted:** `landing-hero-windows.png` (a 906 KB orphan at the repository root; F4 puts
working images in the session scratchpad).

---

## Phase A — Land the dirty tree on `main`

Work in the primary checkout `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`.

### Task A1: Quarantine the strays

Three dirty paths are not work and must not enter history as if they were.

**Files:**

- Revert: `marketing/landing-prototype/src/directions/a.js`
- Delete: `landing-hero-windows.png`
- Modify: `.gitignore`

- [ ] **Step 1: Confirm the landing diff is formatting only**

`git diff -w` is not sufficient here: `-w` ignores whitespace _within_ a line but counts a
multi-line call collapsed onto one line as a real change, and a collapse also drops the
trailing comma the multi-line form required. Both are formatter output with no effect on
the parsed program. Compare the two versions with whitespace and trailing commas removed:

```bash
python3 - <<'PY'
import re, subprocess
F = "marketing/landing-prototype/src/directions/a.js"
head = subprocess.run(["git", "show", f"HEAD:{F}"], capture_output=True, text=True).stdout
work = open(F).read()
norm = lambda s: re.sub(r",(?=[)\]}])", "", re.sub(r"\s+", "", s))
print("formatting only:", norm(head) == norm(work))
PY
```

Expected: `formatting only: True`. That is the proof the 88/103 line churn carries no
authored change — every difference is line wrapping, indentation, or a trailing comma.

If it prints `False`, STOP and ask the owner. Do not guess which lines were intended.

Measured 2026-08-12: `True`. The repository has no `.prettierrc`, `.editorconfig` or
formatter entry in `package.json`, so neither shape is enforced and reverting cannot fight
a checked-in config.

- [ ] **Step 2: Revert it**

```bash
git checkout -- marketing/landing-prototype/src/directions/a.js
```

- [ ] **Step 3: Remove the orphan hero image**

```bash
rm landing-hero-windows.png
```

It is untracked, 906 KB, dated 2026-08-01, and referenced by nothing:

```bash
grep -rn "landing-hero-windows" --include="*.js" --include="*.ts" --include="*.tsx" --include="*.html" . | grep -v node_modules
```

Expected: no output. If it prints a reference, keep the file and move it under
`marketing/landing-prototype/` instead of deleting it.

`.md` is deliberately not searched. Deleting an untracked file is irreversible — it is not
in git and `rm` does not use the Trash — so the guard has to fire on a **product**
reference, and a plan or review that merely mentions the filename is not one.
`docs/plans/2026-08-09-unified-icon-system.md` line 54 names this file, `a.js` and
`.claude/` together in a scope fence telling that plan's implementer to leave all three
alone; it says nothing about the asset's value. Searching `.md` makes the guard fire on
exactly that line every time, and an implementer then has to override a written
instruction — which is how a guard turns into noise.

- [ ] **Step 4: Ignore the local agent directory**

Append to `.gitignore`:

```gitignore
# Local agent configuration and worktree bookkeeping, per-machine.
.claude/
```

- [ ] **Step 5: Verify the tree lost exactly three entries**

```bash
git status --short
```

Expected: `marketing/landing-prototype/src/directions/a.js`, `landing-hero-windows.png` and
`.claude/` are gone from the listing; everything else remains.

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore(repo): ignore the local agent directory"
```

### Task A2: Commit the release-notes gate

**Files:**

- Modify: `.github/workflows/release.yml`, `scripts/release-workflow.test.ts`
- Create: `scripts/generate-release-notes.mjs`, `scripts/generate-release-notes.test.ts`

This work is already described as shipped in `docs/CONTEXT.md` under "Cross-platform
auto-update"; only the commit is missing.

- [ ] **Step 1: Run its own tests**

```bash
npx vitest run scripts/generate-release-notes.test.ts scripts/release-workflow.test.ts
```

Expected: PASS. If it fails, fix before committing — this gate guards a release path.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml scripts/generate-release-notes.mjs \
        scripts/generate-release-notes.test.ts scripts/release-workflow.test.ts
git commit -m "feat(release): require a Release-Note trailer on every user-facing commit

Release-Note: skip"
```

### Task A3: Commit the seam system

**Files:**

- Modify: `src/lib/derive-colors.ts`, `src/lib/derive-colors.test.ts`,
  `src/lib/theme-vars.ts`, `src/styles.css` (seam hunks only),
  `src/gallery/gallery.css` (seam-study hunk only)
- Create: `src/gallery/sections/seam-section.tsx`

`src/styles.css`, `src/gallery/gallery.css` and `src/gallery/section-registry.ts` each carry
hunks belonging to two different packages, so they are staged hunk-by-hunk. `git add -p` is
interactive and unavailable here; use `git apply --cached` on a filtered patch instead.

- [ ] **Step 1: Stage the seam hunks of `src/styles.css`**

The seam hunks are the token block near line 24 and the four `--seam-recessed` boundary
call sites; the single large hunk that adds `.ftoolbar`, `.action-tooltip` and
`.toolbar-menu` belongs to Task A5.

Select by what a hunk **is**, never by what it is not. `src/styles.css` carries three
packages, not two, so an exclude-the-toolbar filter keeps the third one by accident:

```bash
git diff -U3 src/styles.css > /tmp/styles.patch
# Keep only hunks that declare or consume a seam token.
npx --yes -- node -e '
const fs = require("fs");
const text = fs.readFileSync("/tmp/styles.patch", "utf8");
const [head, ...hunks] = text.split(/(?=^@@ )/m);
const keep = hunks.filter((h) => /--seam-(recessed|divider|raised)|--chrome-[12]:/.test(h));
const dropped = hunks.filter((h) => !keep.includes(h));
fs.writeFileSync("/tmp/styles-seam.patch", head + keep.join(""));
console.log("kept", keep.length, "of", hunks.length, "hunks");
for (const h of dropped) console.log("DROPPED:", h.split("\n")[0]);
'
git apply --cached --check /tmp/styles-seam.patch && git apply --cached /tmp/styles-seam.patch
```

Read every `DROPPED:` line before continuing. Each one must be recognisable as another
task's package. A dropped hunk you cannot place belongs to nobody and needs a decision, not
a default.

A count is not a content check. The first run of this task matched its predicted count
exactly and still committed a `.settings-screen` hunk — full-bleed Settings, an unshipped
chrome-redesign change the seam review itself lists as not shipped — because the filter
excluded one package instead of including one. Before committing, read what was actually
staged:

```bash
git diff --cached src/styles.css | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" | grep -vE "seam|chrome-[12]"
```

Expected: only lines that are context or comments belonging to a seam call site. Any
selector or declaration you cannot tie to a seam boundary is a leaked hunk — unstage and
re-filter rather than explaining it away.

- [ ] **Step 2: Stage the seam hunk of `src/gallery/gallery.css`**

```bash
git diff -U3 src/gallery/gallery.css > /tmp/gallery.patch
npx --yes -- node -e '
const fs = require("fs");
const text = fs.readFileSync("/tmp/gallery.patch", "utf8");
const [head, ...hunks] = text.split(/(?=^@@ )/m);
const keep = hunks.filter((h) => h.includes("Seam study") || h.includes("gx-seam"));
fs.writeFileSync("/tmp/gallery-seam.patch", head + keep.join(""));
console.log("kept", keep.length, "of", hunks.length, "hunks");
'
git apply --cached /tmp/gallery-seam.patch
```

- [ ] **Step 3: Stage the rest of the package**

```bash
git add src/lib/derive-colors.ts src/lib/derive-colors.test.ts src/lib/theme-vars.ts \
        src/gallery/sections/seam-section.tsx docs/review/2026-08-12-seam-system-codex.md
```

`docs/review/2026-08-12-seam-system-codex.md` is documentation. Under D14 it may only be
staged after the owner has read it. If the owner has not, hold it back for Task A6.

- [ ] **Step 4: Prove the seam relationship holds**

```bash
npx vitest run src/lib/derive-colors.test.ts
```

Expected: PASS — the seam relationship (`step louder than seam`, `seam below the surface`)
holds for every bundled preset.

Run this on the dirty tree, not on a stashed subset. `--keep-index` plus `pop` conflicts on
exactly the half-staged file this task creates, and the test reads no CSS, so a
staged-subset run would prove nothing the dirty run does not. Task A6 Step 3 runs the full
gate on the clean tree; that is the real proof.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(theme): sink the shell seams below the surfaces they edge

Release-Note: Window seams now read as recessed edges instead of drawn lines."
```

### Task A4: Commit the workbench specimen update

**Files:**

- Modify: `src/gallery/sections/workbench-specimen.tsx`,
  `src/gallery/gallery.css` (workbench hunks only)

The three compositions are retired from the registry in the next plan's Task E2, but the
work is committed first so the retirement is a reviewable decision rather than a silent
loss.

This task runs **before** the toolbar task because `gallery.css` carries hunks for both,
and the toolbar task ends by staging whatever is left in that file. Reversing the order
would fold the workbench styles into the toolbar commit and split one piece of work across
two commits, against W5.

- [ ] **Step 1: Stage the workbench hunks of `src/gallery/gallery.css`**

```bash
git diff -U3 src/gallery/gallery.css > /tmp/gallery.patch
npx --yes -- node -e '
const fs = require("fs");
const text = fs.readFileSync("/tmp/gallery.patch", "utf8");
const [head, ...hunks] = text.split(/(?=^@@ )/m);
const keep = hunks.filter((h) => h.includes("gx-workbench"));
fs.writeFileSync("/tmp/gallery-workbench.patch", head + keep.join(""));
console.log("kept", keep.length, "of", hunks.length, "hunks");
'
git apply --cached /tmp/gallery-workbench.patch
```

Expected: `kept 3 of 4 hunks` when Task A3 has already been committed, `3 of 5` if it has
not — A3's seam hunk leaves the working diff the moment it lands, and the denominator moves
with it. The context width moves it too. So judge the result by which selectors survived,
never by the number: every hunk adding `.gx-workbench__paneltoggle`, `.is-navhidden` or
`.is-dockhidden` is kept, and the toolbar harness hunk (`gx-bar`, `gx-pick`) is not. Prove
the patch before trusting it:

```bash
git apply --cached --check /tmp/gallery-workbench.patch && echo applies cleanly
```

- [ ] **Step 2: Commit**

```bash
git add src/gallery/sections/workbench-specimen.tsx
git commit -m "feat(gallery): add collapse toggles to the workbench compositions

Release-Note: skip"
```

### Task A5: Commit the feature toolbar gallery pass

**Files:**

- Create: `src/ui/toolbar/toolbar-item.ts`, `src/ui/toolbar/toolbar-overflow.ts`,
  `src/ui/toolbar/toolbar-overflow.test.ts`, `src/ui/toolbar/feature-toolbar.tsx`,
  `src/ui/toolbar/feature-toolbar.test.tsx`,
  `src/ui/toolbar/toolbar-overflow-menu.tsx`,
  `src/ui/controls/action-tooltip.tsx`,
  `src/gallery/sections/toolbar-section.tsx`
- Modify: `src/lib/shortcut-label.ts`, `src/lib/shortcut-label.test.ts`,
  `src/styles.css` (remaining hunk), `src/gallery/gallery.css` (remaining hunks),
  `src/gallery/section-registry.ts`

- [ ] **Step 1: Stage the two shared files, filtering `styles.css`**

`src/gallery/gallery.css` and `src/gallery/section-registry.ts` may be staged whole — after
Tasks A3 and A4 the only change left in `gallery.css` is the toolbar harness.
`section-registry.ts` adds the `seams` and `toolbar` entries in interleaved lines; it is a
four-line change, not worth splitting, and it lands here.

`src/styles.css` may NOT. It still carries two changes: this task's toolbar block, and the
`.settings-screen` full-bleed hunk that Task A3 committed by mistake and then returned to
the working tree. That hunk is unshipped chrome-redesign work awaiting a deliberate
decision; committing it here would repeat A3's defect one task later.

```bash
git diff -U3 src/styles.css > /tmp/a5-styles.patch
npx --yes -- node -e '
const fs = require("fs");
const text = fs.readFileSync("/tmp/a5-styles.patch", "utf8");
const [head, ...hunks] = text.split(/(?=^@@ )/m);
const keep = hunks.filter((h) => !h.includes(".settings-screen"));
const dropped = hunks.filter((h) => h.includes(".settings-screen"));
fs.writeFileSync("/tmp/a5-styles-toolbar.patch", head + keep.join(""));
console.log("kept", keep.length, "of", hunks.length, "hunks");
for (const h of dropped) console.log("DROPPED:", h.split("\n")[0]);
'
git apply --cached --check /tmp/a5-styles-toolbar.patch && git apply --cached /tmp/a5-styles-toolbar.patch
git add src/gallery/gallery.css src/gallery/section-registry.ts
```

Expected, measured 2026-08-12: `kept 1 of 2 hunks`, and one `DROPPED:` line for the hunk at
`.settings-screen`. Confirm the parked hunk survived as an uncommitted change:

```bash
git diff src/styles.css | grep -c "settings-screen"    # must be non-zero after the commit
```

- [ ] **Step 2: Stage the rest**

```bash
git add src/ui/toolbar src/ui/controls/action-tooltip.tsx src/lib/shortcut-label.ts \
        src/lib/shortcut-label.test.ts src/gallery/sections/toolbar-section.tsx
```

- [ ] **Step 3: Run the package's tests**

```bash
npx vitest run src/ui/toolbar src/lib/shortcut-label.test.ts
```

Expected: PASS.

- [ ] **Step 4: Prove no gallery module reached the app bundle**

```bash
npm run build && npx vitest run scripts/gallery-entry.test.ts
```

Expected: build clean, gallery-entry gate PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(toolbar): build the feature toolbar and preview it in the gallery

Release-Note: skip"
```

### Task A6: Commit the documentation package — OWNER GATE

**Files:**

- Modify: `AGENTS.md` (−493/+114), `docs/DESIGN-LANGUAGE.md`, `docs/CONTEXT.md`
- Create: `docs/review/2026-08-12-seam-system-codex.md`,
  `docs/specs/2026-08-12-feature-toolbar-design.md`,
  `docs/plans/2026-08-12-feature-toolbar-gallery.md`,
  `docs/plans/2026-08-12-redesign-consolidation.md`,
  `docs/plans/2026-08-12-redesign-trunk-merge.md`

The last two are this plan and its successor. They are listed because they are untracked in
the same tree and would otherwise ride along in this commit without being named.

- [ ] **Step 1: Show the owner the diff, and wait**

```bash
git diff AGENTS.md docs/DESIGN-LANGUAGE.md docs/CONTEXT.md
```

D14 forbids committing these before the owner approves the content. `AGENTS.md` loses 493
lines here; that is a rewrite, not an edit, and it must be read rather than skimmed.

- [ ] **Step 2: Commit only after approval**

```bash
git add AGENTS.md docs/CONTEXT.md docs/DESIGN-LANGUAGE.md \
        docs/review/2026-08-12-seam-system-codex.md \
        docs/specs/2026-08-12-feature-toolbar-design.md \
        docs/plans/2026-08-12-feature-toolbar-gallery.md \
        docs/plans/2026-08-12-redesign-consolidation.md \
        docs/plans/2026-08-12-redesign-trunk-merge.md
git commit -m "docs(deck): record the seam decision, the toolbar design and a shorter AGENTS

Release-Note: skip"
```

Stage the files by name. A bare `git add docs/` would sweep whatever else is untracked in
that tree into a commit whose message does not mention it.

Pre-existing and **not** this task's job to fix: `bash ~/.claude/scripts/docs-anchors.sh`
reports 7 broken anchors in `docs/ARCHITECTURE.md` and `docs/CONTEXT.md`, all pointing at
headings in the Windows desktop spec and at a `CONTEXT.md` section. They predate this plan.
Record them for the owner; repairing them inside a consolidation commit would mix unrelated
work into it.

- [ ] **Step 3: Park the Settings full-bleed hunk on its own branch**

After the docs commit the only dirty path left is `src/styles.css`, carrying the
`.settings-screen` hunk Task A3 committed by mistake and then returned to the tree. It is
unshipped chrome-redesign work — making a full-window screen flush and square is a DL-11
change and therefore an R2 fork, not a styling tweak. The owner ruled on 2026-08-12: park it
in git rather than carrying it through a branch merge or discarding it.

```bash
git checkout -b parked/settings-fullbleed
git commit -am "feat(settings): make the settings screen full-bleed

Parked, not approved. This is chrome-redesign work: a full-window screen that
is flush and square rather than a floating card. It reached main by accident
inside the seam commit, was extracted, and is held here until the redesign
phase decides on it. Cherry-pick from this branch; do not merge it.

Release-Note: skip"
git checkout main
```

Expected afterwards: `git status --short` on `main` prints nothing, and
`git log --oneline -1 parked/settings-fullbleed` shows the parked commit sitting on top of
`main`'s head. The branch gets no worktree — nothing will be built from it until phase 2
cherry-picks it.

- [ ] **Step 4: Prove `main` is clean and green**

```bash
git status --short && npm test && npm run build && npm run generate:menu:check
```

Expected: empty status; 1278+ tests passing; build clean; menu check exit 0.

---

## Phase B — Land the dirty tree on `electron-migration`

Work in `/Users/kyantran/Documents/Development/spacevibe-deck-worktrees/electron-migration`.

### Task B1: Commit the custom-agent process classification

**Files:**

- Modify: `electron/main.ts`, `electron/platform/classify.ts`,
  `electron/platform/classify.test.ts`, `electron/pty/info.ts`, `electron/pty/info.test.ts`,
  `electron/smoke.ts`, `src/lib/agent-catalog.ts`, `src/lib/agent-catalog.test.ts`,
  `src/lib/process-info.ts`, `src/prompts/inject.ts`, `src/prompts/inject.test.ts`,
  `src/terminal/pane-info.ts`, `src/terminal/pane-info-poller.ts`,
  `src/terminal/pane-info-poller.test.ts`, `src/terminal/pty-client.ts`,
  `src/terminal/tab-manager.ts`, `src/terminal/tab-manager.test.ts`, `src/ui/app.tsx`
- Modify (owner gate): `docs/ARCHITECTURE.md`

This package widens `PaneAgent` from a five-member union to `string`, adds
`agentProcessMatchers()` so user-declared agents are classified from the measured command
line, serializes renderer polls, and shares each in-flight process-table read across
windows.

- [ ] **Step 1: Read the diff before staging it**

```bash
git diff src/lib/agent-catalog.ts src/terminal/pane-info-poller.ts electron/pty/info.ts
```

`PaneAgent` becoming `string` removes a compile-time guarantee. Confirm every switch or
map over agent ids still has a default branch:

```bash
grep -rn "PaneAgent" src/ electron/ | grep -v test
```

- [ ] **Step 2: Run the affected tests**

```bash
npx vitest run src/lib/agent-catalog.test.ts src/prompts/inject.test.ts \
  src/terminal/pane-info-poller.test.ts src/terminal/tab-manager.test.ts \
  electron/platform/classify.test.ts electron/pty/info.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the code**

```bash
git add electron/ src/lib/agent-catalog.ts src/lib/agent-catalog.test.ts \
        src/lib/process-info.ts src/prompts/inject.ts src/prompts/inject.test.ts \
        src/terminal/ src/ui/app.tsx
git commit -m "feat(agents): classify declared agents from the measured command line

Release-Note: Agents you declare yourself now get the same status dot, label and attention state as the built-in five."
```

- [ ] **Step 4: Commit the architecture note after owner approval**

```bash
git diff docs/ARCHITECTURE.md
# owner reads, then:
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): record the Electron pane-status contract

Release-Note: skip"
```

### Task B2: Commit the gallery direction narrowing

**Files:**

- Modify: `src/gallery/chrome-fixtures.tsx`, `src/gallery/gallery.css`,
  `src/gallery/gallery.tsx`, `src/gallery/main.tsx`, `src/gallery/section-registry.ts`,
  `src/gallery/sections/*.tsx`
- Create: `src/gallery/chatgpt-direction.css`
- Delete: `src/gallery/radius-system-direction.css`

This commit removes the direction switcher, the theme switcher and the `state matrix`
entry, leaving one visual language on the review surface. That is what the owner is
reviewing at `127.0.0.1:5175`, so it is committed as-is; phase 2 rebuilds its ramp from
theme tokens.

- [ ] **Step 1: Record the constraint in the file's own header**

`src/gallery/chatgpt-direction.css` declares nine fixed hex values. Its header must say
that this is gallery-only and that the shipping rebuild is theme-derived, so the next
reader does not copy the literals into `styles.css`. Confirm the wording:

```bash
head -8 src/gallery/chatgpt-direction.css
```

Expected: a comment stating it never enters `styles.css` or the shipped bundle. If it is
absent, add it before committing.

- [ ] **Step 2: Prove the theme switcher removal did not orphan `applyThemeVars`**

```bash
grep -rn "applyThemeVars" src/ | grep -v test
```

Expected: still referenced from the app (`src/ui/app.tsx` or its theme module). If the only
remaining reference was the gallery, STOP — the shipping theme path would have been
deleted by accident.

- [ ] **Step 3: Commit**

```bash
git add src/gallery/
git commit -m "feat(gallery): narrow the review surface to one selected direction

Release-Note: skip"
```

### Task B3: Refile the stray review document

**Files:**

- Delete: `docs/plans/perform-a-read-only-code-noble-riddle.md`
- Create: `docs/review/2026-08-12-worktree-loading-ring.md`

The file is a read-only code review of the worktree loading ring, filed as a plan under a
name that matches no convention. D3 limits `docs/` subfolders and D4 fixes the naming.

- [ ] **Step 1: Move and rename**

```bash
git mv docs/plans/perform-a-read-only-code-noble-riddle.md \
       docs/review/2026-08-12-worktree-loading-ring.md 2>/dev/null || \
  mv docs/plans/perform-a-read-only-code-noble-riddle.md \
     docs/review/2026-08-12-worktree-loading-ring.md
```

- [ ] **Step 2: Give it the review heading its content already has**

Its first line is `# Code review (read-only): worktree loading ring`. Add the two lines the
other review documents carry — reviewer identity and the point-in-time notice — matching
the format of `docs/review/2026-08-12-seam-system-codex.md`.

- [ ] **Step 3: Commit after owner approval**

```bash
git add docs/review/2026-08-12-worktree-loading-ring.md docs/plans/
git commit -m "docs(review): refile the worktree loading-ring review

Release-Note: skip"
```

- [ ] **Step 4: Prove the branch is clean and green**

```bash
git status --short && npm test && npm run build
```

Expected: empty status; tests passing; build clean.

---

## Phase C — Renumber the design language before any merge

Still in the `electron-migration` worktree. Doing this **before** merging
`feat/token-usage-dashboard` is what makes the sweep unambiguous: afterwards, a global
search for `DL-15` would match two different rules.

### Task C1: Write the citation gate, and watch it fail

**Files:**

- Create: `scripts/design-language.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const RULEBOOK = join(ROOT, "docs/DESIGN-LANGUAGE.md");
const SCANNED_DIRS = ["src", "electron", "scripts"];
const SCANNED_EXT = /\.(ts|tsx|css)$/;
const SECTION = /^## (\d+)\. (.+)$/gm;
const RULE = /\*\*DL-(\d+)\.(\d+)\*\*/g;
const CITATION = /DL-(\d+)(?:\.(\d+))?/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    // The gate's own regex literals are not citations.
    if (entry === "design-language.test.ts") return [];
    if (statSync(path).isDirectory()) return walk(path);
    return SCANNED_EXT.test(entry) ? [path] : [];
  });
}

function declared(): { sections: Set<string>; rules: Set<string> } {
  const text = readFileSync(RULEBOOK, "utf8");
  const sections = new Set<string>();
  for (const match of text.matchAll(SECTION)) sections.add(match[1]);
  const rules = new Set<string>();
  for (const match of text.matchAll(RULE)) rules.add(`${match[1]}.${match[2]}`);
  return { sections, rules };
}

describe("design-language citations", () => {
  it("declares every section number exactly once", () => {
    const text = readFileSync(RULEBOOK, "utf8");
    const numbers = [...text.matchAll(SECTION)].map((m) => m[1]);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });

  it("scans a non-empty set of files", () => {
    const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(100);
  });

  it("resolves every cited rule to a declared rule or section", () => {
    const { sections, rules } = declared();
    const unresolved: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(CITATION)) {
          const id = match[2] ? `${match[1]}.${match[2]}` : match[1];
          const ok = match[2] ? rules.has(id) : sections.has(id);
          if (!ok) unresolved.push(`${file.replace(ROOT, "")}: DL-${id}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
npx vitest run scripts/design-language.test.ts
```

Expected: the third test FAILS, listing `DL-16` citations in `src/styles.css`,
`src/ui/app.tsx`, `src/ui/app.test.tsx`, `src/ui/tab-bar.tsx` and
`src/gallery/sections/matrix-section.tsx` — because `§16` has no heading in the rulebook on
this branch, only citations. That failure is the bug this gate exists to catch, and it is
already present before any merge.

If the first test fails instead, a section number is duplicated inside one file; fix that
first.

- [ ] **Step 3: Commit the gate, red**

Do not commit a red test into a green suite. Instead hold this file staged and commit it
together with Task C2, which turns it green. Stage it now:

```bash
git add scripts/design-language.test.ts
```

### Task C2: Perform the renumber

**Files:**

- Modify: `docs/DESIGN-LANGUAGE.md`, `src/styles.css`, `src/ui/app.tsx`,
  `src/ui/app.test.tsx`, `src/ui/tab-bar.tsx`,
  `src/ui/settings/sections/shortcuts-section.tsx`,
  `src/ui/settings/sections/shortcuts-section.test.tsx`,
  `src/ui/controls/shortcut-capture.tsx`, `src/browser/browser-panel.tsx`,
  `src/gallery/sections/matrix-section.tsx`, plus the branch's own docs

- [ ] **Step 1: Sweep code and the rulebook, in descending order**

The sweep covers code plus `docs/DESIGN-LANGUAGE.md` and nothing else under `docs/`. A
`grep -rEl "DL-1[567]" docs` would also catch documents whose `DL-15`/`DL-16` carry the
**other** branch's meaning, and frozen reviews that must stay as written. Those get
per-file decisions in Step 2.

Order matters. Rewriting `15 → 17` first would then be caught by `17 → 19` and moved twice.

```bash
FILES="$(grep -rEl 'DL-1[567]' src electron scripts 2>/dev/null) docs/DESIGN-LANGUAGE.md"
# 17 → 19, then 16 → 18, then 15 → 17.
perl -pi -e 's/\bDL-17\b/DL-19/g; s/\bDL-17\.(\d+)/DL-19.$1/g' $FILES
perl -pi -e 's/\bDL-16\b/DL-18/g; s/\bDL-16\.(\d+)/DL-18.$1/g' $FILES
perl -pi -e 's/\bDL-15\b/DL-17/g; s/\bDL-15\.(\d+)/DL-17.$1/g' $FILES
```

- [ ] **Step 2: Decide the remaining documents one at a time**

```bash
grep -rEl "DL-1[567]" docs | grep -v DESIGN-LANGUAGE
```

Expected list, and the decision for each — read the citation before rewriting it, because
the number alone does not say which rule it meant:

| Document                                               | Decision                                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/specs/2026-08-12-file-explorer-design.md`        | **Sweep.** Its `§17` citations mean docked side panels, which is the moving set, and the spec is `decided` — still steering phase 4.                                                                     |
| `docs/plans/2026-08-12-file-explorer.md`               | **Sweep.** Same rule, same reason.                                                                                                                                                                       |
| `docs/plans/2026-08-10-token-usage-dashboard.md`       | **Leave.** Its `DL-15`/`DL-16` mean read-only data tables and the display figure — the set that keeps its numbers. Sweeping would point them at shortcut rows and the command-row frame.                 |
| `docs/review/2026-08-12-visual-system-codex-review.md` | **Leave.** A frozen point-in-time record, and its `DL-16.x`/`DL-17.x`/`DL-18.x` are the reviewer's own proposal numbering. Rewriting half of it would leave two meanings of `DL-18` inside one document. |

If the grep returns a document not in this table, stop and decide it with the owner rather
than sweeping it. The citation gate scans only `src`, `electron` and `scripts`, so a wrong
call here goes unnoticed forever.

- [ ] **Step 3: Renumber the headings the sweep did not touch**

Section headings read `## 15. Shortcut rows`, not `DL-15`, so they move by hand in
`docs/DESIGN-LANGUAGE.md`:

- `## 15. Shortcut rows` → `## 17. Shortcut rows`
- `## 17. Docked side panels` → `## 19. Docked side panels`
- add the missing `## 18. Command-row frame`, written from the four `DL-18` call sites in
  `src/styles.css` and the one in `src/ui/app.tsx` — the rule is cited from five places and
  has never been written down. That is the second defect this phase closes.

- [ ] **Step 4: Reserve the three numbers the visual review proposes**

At the end of the rulebook, before the drift ledger, add:

```markdown
## 20. Numeric scales

_Reserved. Proposed by [the 2026-08-12 visual review](review/2026-08-12-visual-system-codex-review.md); not adopted. Adopting it is an R2 fork._

## 21. Interaction states

_Reserved. Same source, same status._

## 22. Surface genres

_Reserved. Same source, same status._
```

Reserving costs nothing and stops the next branch from claiming §20 for something else.

- [ ] **Step 5: Run the gate and watch it pass**

```bash
npx vitest run scripts/design-language.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
npm test && npm run build
```

Expected: green. A renumber touches only comments and one CSS file's comments, so any test
failure here means the sweep hit a string that was not a citation — check
`git diff` for changes inside quoted strings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs(dl): move shortcut rows, the command-row frame and docked panels to 17-19

Release-Note: skip"
```

---

## Definition of done

- `main` is clean: `git status --short` prints nothing, and its history carries five
  commits — the ignore rule, the release-notes gate, the seam system, the workbench
  specimen, the feature toolbar — plus one documentation commit the owner approved.
- `electron-migration` is clean: the custom-agent classification, the narrowed gallery
  direction, the refiled review, and the renumber each landed as their own commit.
- `landing-hero-windows.png` is gone, `marketing/landing-prototype/src/directions/a.js` is
  unchanged against `HEAD`, and `.claude/` is ignored.
- `docs/DESIGN-LANGUAGE.md` on `electron-migration` declares §17 Shortcut rows, §18
  Command-row frame — written, not only cited — §19 Docked side panels, and reserves
  §20–§22.
- `scripts/design-language.test.ts` exists on `electron-migration` and passes there. It was
  seen failing first, on the `DL-16` citations with no §16 heading. `main` does not carry
  the file yet; it arrives there through the merge in the next plan.
- Both branches pass `npm test && npm run build && npm run generate:menu:check`.

## Next

Continue with the [trunk merge plan](2026-08-12-redesign-trunk-merge.md) `building`. Do not
start it while either branch is dirty — every conflict it resolves is ambiguous if
uncommitted work is still in the tree.

## Explicitly not in this plan

- Creating or merging into `redesign-trunk` — the next plan.
- Rebuilding the ChatGPT-direction ramp from theme tokens — phase 2.
- The repository/worktree navigation model — phase 1, which needs its own design first.
- Adopting §20–§22. They are reserved headings with no rules; adopting them is an R2 fork.
- Any change to shipping Tauri behaviour.
