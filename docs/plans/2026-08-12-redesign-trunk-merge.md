# Redesign Trunk Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `main`, `feat/token-usage-dashboard` and `feat/workspace-reorder` into a new
`redesign-trunk` branched from `electron-migration`, then reconcile the gallery registry and
the living documents so one tree describes one product.

**Architecture:** Merge in dependency order onto a fresh worktree, resolving each expected
conflict by a policy written down in advance rather than decided under pressure. The
design-language renumber has already happened upstream, so `feat/token-usage-dashboard`'s
`DL-15.*` and `DL-16.*` land in free numbers and the citation gate stays green through every
merge.

**Tech Stack:** git worktrees, Vitest, TypeScript, Vite, Preact, Electron 43, node-pty.

## Prerequisite

[Redesign consolidation plan](2026-08-12-redesign-consolidation.md) `building` must be
complete: `main` and `electron-migration` clean, green and pushed, the design-language
sections renumbered to §17–§19, and `scripts/design-language.test.ts` passing. Starting this
plan on a dirty tree makes every merge conflict ambiguous.

## Global Constraints

- **R1.** English only for strings, comments, docs and commit messages.
- **R2.** Design language is executable policy; a numbered rule change is a fork that needs
  owner approval. Code comments cite rules by id.
- **R7.** Gallery imports flow app → gallery only. No shipping module imports `src/gallery/`.
- **D14.** Never `git commit` documentation before the owner has approved its content.
- **Branching.** A new branch always gets its own worktree under
  `~/Documents/Development/spacevibe-deck-worktrees/`.
- **Minimum gate.** `npm test && npm run build && npm run generate:menu:check`.
- **Tauri freeze.** Nothing in this plan changes shipping Tauri behaviour.

---

## Phase D — Build the integration trunk

### Task D1: Create the trunk worktree

- [ ] **Step 1: Branch from `electron-migration` and give it a worktree**

```bash
cd /Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck
git worktree add -b redesign-trunk \
  ~/Documents/Development/spacevibe-deck-worktrees/redesign-trunk electron-migration
cd ~/Documents/Development/spacevibe-deck-worktrees/redesign-trunk
npm ci
```

- [ ] **Step 2: Prove the starting point is green**

```bash
npm test && npm run build
```

Expected: green. This is the baseline every later merge is measured against.

### Task D2: Merge `main`

Expected conflicts: `docs/DESIGN-LANGUAGE.md`, `src/styles.css`, `src/gallery/gallery.css`,
`src/gallery/section-registry.ts`, `src/lib/derive-colors.ts`, `AGENTS.md`,
`docs/CONTEXT.md`.

- [ ] **Step 1: Merge**

```bash
git merge main
```

- [ ] **Step 2: Resolve with these policies**

| File                                                | Policy                                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/derive-colors.ts`, `src/lib/theme-vars.ts` | Take `main`'s seam tokens whole. The branch has no competing version.                                                                                                |
| `src/styles.css`                                    | Keep both: the branch's DL-18 command-row frame and `main`'s seam call sites. They edit different selectors; a conflict here is textual proximity, not disagreement. |
| `docs/DESIGN-LANGUAGE.md`                           | Keep the branch's §17–§22 and add `main`'s DL-2.3 seam rule. Numbers below §15 are identical on both sides.                                                          |
| `src/gallery/section-registry.ts`                   | Take the branch's narrowed registry. `main`'s `seams` and `toolbar` entries are re-added in Task E2, deliberately, not by merge.                                     |
| `src/gallery/gallery.css`                           | Keep both blocks; they are disjoint selector families (`gx-seam*`, `gx-bar*`, `gx-chat-*`).                                                                          |
| `AGENTS.md`, `docs/CONTEXT.md`                      | Hold for Task E3. Do not hand-merge prose in the middle of a code merge. Take the branch's version now and rewrite it once at the end.                               |

- [ ] **Step 3: Apply the seam tokens to the command-row frame**

`main`'s seam decision landed before the branch's DL-18 collapsed title-bar/tab-bar frame
existed, so that frame still draws its boundary with `--hair`. Change its boundary to
`--seam-recessed`, which is what DL-2.3 requires of a shell boundary.

```bash
grep -n "hair" src/styles.css | sed -n '1,40p'
```

- [ ] **Step 4: Verify**

```bash
npm test && npm run build && npx vitest run scripts/design-language.test.ts
```

- [ ] **Step 5: Commit the merge**

```bash
git commit -m "Merge main into redesign-trunk"
```

### Task D3: Merge `feat/token-usage-dashboard`

Its `DL-15.*` and `DL-16.*` citations now land in free numbers. Expected conflicts:
`docs/DESIGN-LANGUAGE.md` (§11 heading), `src/terminal/action-registry.ts`,
`src/ui/app.tsx`, `src/styles.css`.

- [ ] **Step 1: Land that branch's own dirty tree first**

Its worktree holds uncommitted `AGENTS.md` and `docs/CONTEXT.md` edits plus two untracked
documents — its own spec and plan, which are the record of what the ten commits did.
Merging the branch would leave all four behind.

```bash
cd ~/Documents/Development/spacevibe-deck-worktrees/token-usage-dashboard
git status --short
git diff AGENTS.md docs/CONTEXT.md
```

Show the owner the diff, then commit under D14:

```bash
git add AGENTS.md docs/CONTEXT.md docs/specs/2026-08-10-token-usage-dashboard-design.md \
        docs/plans/2026-08-10-token-usage-dashboard.md
git commit -m "docs(usage): record the dashboard design, plan and direction

Release-Note: skip"
```

Expected afterwards: `git status --short` prints nothing but the ignored `.claude/` entry.

- [ ] **Step 2: Merge**

```bash
cd ~/Documents/Development/spacevibe-deck-worktrees/redesign-trunk
git merge feat/token-usage-dashboard
```

- [ ] **Step 3: Resolve the §11 rename**

The branch renames `## 11. Settings shell` to `## 11. Full-window screens` because Usage is
a second full-window screen. Take the rename — it is a superset, and Settings is one of the
screens it covers. Check its body still describes the settings rail.

- [ ] **Step 4: Resolve the action registry**

`toggle-usage` must coexist with the branch's rebindable-shortcuts work. Confirm the
generated menu still regenerates:

```bash
npm run generate:menu && npm run generate:menu:check
```

Expected: exit 0, and `git status` shows no unexpected regeneration diff.

- [ ] **Step 5: Verify and commit**

```bash
npm test && npm run build && npx vitest run scripts/design-language.test.ts
git commit -m "Merge feat/token-usage-dashboard into redesign-trunk"
```

### Task D4: Merge `feat/workspace-reorder`

It carries no `DL-` citations, so it cannot collide with the rulebook. Expected conflicts:
`src/ui/workspace-sidebar.tsx`, `src/open-board/open-board.tsx`, `src/styles.css`.

Note for the resolver: this branch is based on a vendored icon-system tree
(`5e0c317 chore(base): vendor the in-flight icon-system tree`), so its diff may re-introduce
older versions of icon files. Prefer the trunk's side for anything under
`src/ui/controls/deck-icon.tsx` and the icon map.

- [ ] **Step 1: Merge and resolve**

```bash
git merge feat/workspace-reorder
```

- [ ] **Step 2: Verify the icon gate specifically**

```bash
npx vitest run scripts/icon-system.test.ts
```

Expected: PASS. A failure here means the vendored base re-introduced an authored `<svg>` or
a retired glyph.

- [ ] **Step 3: Verify and commit**

```bash
npm test && npm run build
git commit -m "Merge feat/workspace-reorder into redesign-trunk"
```

---

## Phase E — Reconcile the surface and the record

### Task E1: Prove the merged trunk against the full gate

- [ ] **Step 1: Run every gate the repository has**

```bash
npm test && npm run build && npm run generate:menu:check
npx vitest run scripts/ipc-contract.test.ts scripts/icon-system.test.ts \
  scripts/gallery-entry.test.ts scripts/design-language.test.ts
```

Expected: all green. Record the test count — it should be at or above the sum of the
branches' individual counts minus duplicates.

- [ ] **Step 2: Run the Electron smoke test**

```bash
npm run electron:smoke
```

Expected: 10/10. This is the only check that proves a pane actually paints; the unit suite
mocks the host.

### Task E2: Settle the gallery registry

**Files:**

- Modify: `src/gallery/section-registry.ts`
- Delete: `src/gallery/sections/workbench-specimen.tsx`

- [ ] **Step 1: Retire the three workbench compositions**

Owner decision 7: the composition question is answered by the direction now on the review
surface, so the three candidates are removed from the registry and their file deleted. Git
history keeps them at `f2cdf3f`.

- [ ] **Step 2: Decide each surviving section against one question — does it still compare
      something undecided?**

| Section                                             | Keep?  | Reason                                                                                                                                     |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `direction tokens`                                  | keep   | the contract phase 2 rebuilds from                                                                                                         |
| `config rows`, `popovers`, `overlays`, `open board` | keep   | real component states                                                                                                                      |
| `window chrome`                                     | keep   | the selected composition                                                                                                                   |
| `feature toolbar`                                   | keep   | phase 3's demo surface, states not yet shipped                                                                                             |
| `seam system`                                       | keep   | A/B/C study, kept deliberately per its review §4                                                                                           |
| `state matrix`                                      | re-add | four themes × five states; phase 2 needs it to prove the theme-derived rebuild, and it is exactly the evidence the visual review asked for |
| `workbench compositions`                            | remove | decided                                                                                                                                    |

- [ ] **Step 3: Verify the gallery runs with no unhandled IPC**

```bash
npm run prototype:gallery
```

Open `http://127.0.0.1:5175/gallery.html`, visit every section, and read the footer.
Expected: the footer reports no unhandled host calls, and no section throws.

- [ ] **Step 4: Screenshot for the owner**

Capture the full gallery at 1440×900 and hand the images to the owner. Rendered UI changes
need eye approval; an automated gate cannot give it.

- [ ] **Step 5: Commit**

```bash
git add src/gallery/
git commit -m "refactor(gallery): retire the decided comparisons, restore the state matrix

Release-Note: skip"
```

### Task E3: Rewrite the living documents once — OWNER GATE

**Files:**

- Modify: `AGENTS.md`, `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Write what is now true**

`AGENTS.md` "Current direction" must say: `redesign-trunk` is where redesign and feature
work lands; `electron-migration` is the fallback; `main` is Tauri-frozen. The fork queue
gains the resolved forks from this plan, each with one line of reason.

`docs/CONTEXT.md` gains one section dated 2026-08-12 recording: the four-branch
consolidation, the DL renumber map and why the cheaper citation set moved, the new citation
gate, and the two defects it caught (a §16 cited from five places but never written, and a
duplicate section number).

- [ ] **Step 2: Update the drift ledgers**

Every `Chưa khớp thực tế` table in the three documents is re-checked against the merged
tree. A claim that the merge made true is removed; a claim it made false is added.

- [ ] **Step 3: Run the documentation gates**

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

Expected: both exit 0. A broken anchor here means the merge moved a file a document points
at.

- [ ] **Step 4: Owner reads, then commit**

```bash
git add AGENTS.md docs/
git commit -m "docs(deck): record the consolidation, the renumber and the new gate

Release-Note: skip"
```

### Task E4: Clean up

- [ ] **Step 1: Remove the prunable worktree**

```bash
git worktree prune
git worktree list
```

Expected: the stale `/private/tmp/.../pr-11` entry is gone; five worktrees remain.

- [ ] **Step 2: Decide the fate of the merged feature branches with the owner**

`feat/token-usage-dashboard` and `feat/workspace-reorder` are fully merged into
`redesign-trunk` and have no remote. Ask before deleting either branch or its worktree —
they are the only copies.

- [ ] **Step 3: Push**

```bash
git push -u origin redesign-trunk
git push origin main electron-migration
```

---

## Definition of done

- `main` and `electron-migration` are clean, green, and pushed.
- `redesign-trunk` exists as a worktree, contains all four branches, and passes
  `npm test && npm run build && npm run generate:menu:check`, the four scripted gates, and
  `npm run electron:smoke` 10/10.
- `docs/DESIGN-LANGUAGE.md` declares each section number once, §16 is written rather than
  only cited, and `scripts/design-language.test.ts` resolves every citation in the tree.
- The gallery renders every registered section with no unhandled host call, and the owner
  has seen and approved the screenshots.
- `AGENTS.md`, `docs/CONTEXT.md` and `docs/ARCHITECTURE.md` describe the trunk that now
  exists, with their drift ledgers re-checked.

## Explicitly not in this plan

- Rebuilding the ChatGPT-direction ramp from theme tokens — phase 2.
- The repository/worktree navigation model — phase 1, and it needs its own design first.
- Shipping the feature toolbar, the explorer surface, the usage screen or the browser panel
  into the app — phases 3–5.
- Adopting §20–§22. They are reserved headings with no rules; adopting them is an R2 fork.
- Any change to shipping Tauri behaviour.
- Deleting `feat/token-usage-dashboard` or `feat/workspace-reorder` without the owner
  saying so.
