# Rail hierarchy and status marks: plan

Spec: [rail-hierarchy-status-marks](../specs/2026-11-06-rail-hierarchy-status-marks.md) (SR-1..SR-10).
Ledger: [decisions](../specs/2026-11-06-rail-hierarchy-status-marks-decisions.md) (RH-1..RH-25).
Mock (the visual target, read it before building): gallery section `mock · rail hierarchy`
(`src/gallery/sections/rail-hierarchy-*`, open it with `npm run prototype:gallery`, section
`rail-hierarchy`). Its CSS holds the measured numbers. Spec, ledger, this plan and the mock all ride
on branch `claude/rail-hierarchy-build`, which is local `main` plus the mock (built in worktree
`worktree-rail-marks-mock`) plus these documents; build on that branch or on a child of it.
Why a branch and not `main`: the rail tokens this build needs (`--type-rail`, `--row-40`,
`--row-28`) and the recipes work are in commits `origin/main` does not have yet.
The primary checkout holds other sessions' uncommitted `project-rail-*` edits; the owner reviews
the result from this branch.
Baseline for the end review: the first commit of the build on top of the branch tip that holds this plan.

## Operating contract

Once the owner approves this plan, run T0..T7 without asking again. This runs on a cloud session,
so pushing the build to its own branch (a child of `claude/rail-hierarchy-build`, for example
`claude/rail-hierarchy-build-impl`) is part of the job: the owner reviews from the remote. Never
push to `main`, never merge, never force-push. Stop only for: a merge or a push to `main`,
the owner's eye approval (T8, one batch after the last task), a fork this plan does not name, and
the stops in "Decisions to confirm" if the owner answers them differently. No Playwright launch of
the Deck app (memory 2026-10-24); the owner walks the running app. The gallery is a Vite page, so
headless captures of it are fine.

Expected forks, authorized by the spec once this plan is approved: the 11px and 10px type steps
(RH-12, DL-4); changing `--mark-slot`, `--mark-dot`, `--mark-ring`, `--mark-square` (DL-27.3 is a
pattern, rewritten with the code, AGENTS "Forks"). Not a fork: reusing `--row-32` (RH-11).

## Findings that shaped the tasks

- Real consumers of `AgentStateMark`: `project-rail-row.tsx` (2 sites, the live row and its rename
  field), `project-rail-header.tsx` (the folded roll-up), `project-rail-attention-pill.tsx` (the
  stage bar's "N need you", 2 sites), `src/terminal/pane-agent-header.tsx`. The mark's CSS is
  `src/styles/32-state-mark.css`, tokens at `src/styles/01-tokens.css:284-287`.
- The old cluster rail still reads `--mark-slot` (`src/styles/13-sessions.css:530`, asserted by
  `src/ui/agent-rail.test.tsx:1568`): changing the token moves that grid too (spec: out of scope
  beyond the shared mark).
- The strip tab (`src/ui/tab-strip.tsx`) and the dock do not import `AgentStateMark`; T0 finds what
  they draw for state today, because SR-7 says they take the new set.
- The shipped mark has an "inferred" form drawn hollow (`32-state-mark.css:53`,
  `project-rail-model.ts:21`); RH-3 forbids a hollow ring. See D1.
- DL text to rewrite with the code: DL-27.3 and its 14-slot paragraph (`DESIGN-LANGUAGE.md:1187-1208`),
  line 47-50, 697; `scripts/design-language.test.ts` reads those values.
- The rollup of a folded project (`group.rollup`) feeds the header mark; SR-5 drops it, so the
  `rollup` field may become unused in the view model (check before deleting, W3).

## Decisions to confirm (defaults apply if the owner does not object)

- **D1 inferred state.** Default: an inferred state draws the same shape at 55% of its ink, with no
  hollow form. Alternative: keep the hollow form for inferred states on the surfaces that keep a mark.
- **D2 "N need you" pill.** Default: it keeps its mark (the new needs-input shape) because it is a
  stage-bar control, not a rail row or a folded header (SR-3 names those two).
- **D3 strip tab and dock.** Default: whatever state cue they draw today is replaced by the new
  set at a token size chosen in T2 and reviewed in T8.

## Tasks

| #   | Task | Owns | Spec | Wave | Status |
| --- | ---- | ---- | ---- | ---- | ------ |
| T0  | Read-only sweep (W21): list every consumer of `AgentStateMark`, `.state-mark`, `--mark-*`, `--row-40`/`--row-44` in rail code and what the strip tab and dock draw for state; record "N sites" here | this plan | SR-7, SR-10 | 1 | done (see "T0 sweep") |
| T1  | Tokens: add the 11px / 10px rail text steps and leadings (`01-tokens.css`), the logo box, the new mark sizes; keep `--row-32`; update the ratchets that read tokens (`scripts/`, `src/styles/` suites); DL-4 note | `src/styles/01-tokens.css`, `scripts/*.test.ts`, `docs/DESIGN-LANGUAGE.md` | SR-1, SR-2 | 1 | done 2026-11-05 (`f0111c5`) |
| T2  | Mark: the new shape set in `32-state-mark.css` and `agent-state-mark.tsx` (spinner, dot + radiating ring, dot, done circle + check, ✕, square, dash; D1 for inferred); size by token per surface; apply to `pane-agent-header.tsx`, the pill, and the strip tab and dock sites found in T0 | `src/styles/32-state-mark.css`, `src/ui/blocks/agent-state-mark.tsx`, `src/terminal/pane-agent-header.tsx`, `project-rail-attention-pill.tsx`, strip/dock files | SR-7 | 2 | done 2026-11-05 (`f0111c5`); strip tab and dock: no site (see T0 sweep) |
| T3  | Rail rows: no mark, 32px, pad 8, 16 logo box / 12 glyph, text 8 after logo (x equals the name's), 11px / 10px, status ink on branch icon and text, tint only for needs-input, working shimmer and dots, "folder only", remembered rows; the rename field keeps the same geometry | `project-rail-row.tsx`, `remembered-row.tsx`, a new `src/styles/33-rail-working.css` imported in `styles.css` | SR-1, SR-2, SR-4, SR-6 | 2 | done 2026-11-05 (`478303a`, `197eb4d`) |
| T4  | Header: sticky, no indent, logo-to-name line, 13px fallback folder, corner count when folded, no per-status circle or roll-up mark, empty workspace one line (drop "No sessions"), name in `--text-primary` 12px 600 | `project-rail-header.tsx`, `project-rail-sections.tsx`, `project-rail.tsx` | SR-3, SR-5 | 2 | done 2026-11-05 (`478303a`, `197eb4d`) |
| T5  | Tests that assert behaviour (R10): a row has no mark and the right ink per status; folded header shows the count and nothing per status; "folder only"; row height 32; the working row's dots; accessible names (SR-8); update the tests the token and DL changes break | `*.test.tsx` beside each file | SR-1..SR-8 | 3 | done 2026-11-05 (`478303a`) |
| T6  | Docs: DL-27.3 and neighbours, `docs/internals/agent-rail.md`, edit `2026-11-06-rail-type-scale-decisions.md` (SR-9, RL-2 and RL-5 for agent rows), CHANGELOG line | docs | SR-9 | 3 | done 2026-11-05 (`5ee0221`) |
| T7  | Review: `review-change` on the range; fix findings; W21 "changed N of M" and delete the gallery mock section `mock · rail hierarchy` only after T8 approval (W8) | review | SR-10 | 4 | review run; findings below (fix pending) |
| T8  | Owner eye approval, one batch after T7: the real rail in the owner's dev app (their `electron:dev`, older instance stopped, W22) in both themes against the mock, plus the pane header, pill, strip tab and dock marks | none (owner) | SR-10 | 5 | todo |

## T0 sweep (2026-11-05, read-only)

- `AgentStateMark`: 6 production sites. Rail: `project-rail-row.tsx` x2 (live row, rename field),
  `project-rail-header.tsx` x1 (folded roll-up). Other surfaces: `project-rail-attention-pill.tsx` x2
  (stage-bar chip, button), `src/terminal/pane-agent-header.tsx` x1. Tests: `braille-spinner.test.tsx`.
- `.state-mark` is styled only by `src/styles/32-state-mark.css`; `ROW_LEAD` is used by the live row and
  `remembered-row.tsx` (empty slot).
- `--mark-slot` also feeds `src/styles/13-sessions.css:530` (`.recent-session-activity__row`, whose state
  cell holds the old rail's `.asr-row__mark`, a different component), asserted by `agent-rail.test.tsx:1568`
  and `scripts/design-language.test.ts:440`. `--mark-dot`, `--mark-ring`, `--mark-square` are read only by
  `32-state-mark.css`. `--row-40` is read only by `ROW_LAYOUT`; `--row-44` by non-rail surfaces.
- **The strip tab and the dock draw no state mark today.** `tab-strip.tsx` has no state cue (DL-18.10
  removed the chip's dot on 2026-08-16; `.tab__attn` is a leftover for the unused `AgentAttentionMark`,
  which no production file mounts), and the dock tab chips and `agent-dock` import neither
  `AgentStateMark` nor `RailStatusMark`. `RailStatusMark` (`.asr-row__mark`) belongs to the old cluster rail,
  the Agent Board card and Recent activity: out of scope (spec "Out of scope").
- So D3 resolves to: the strip tab and the dock take no mark in this build (adding one would reverse
  DL-18.10, not replace a cue). Reported in the final handoff for the owner to overrule.
- `group.rollup` is read only by `project-rail-header.tsx` (plus `rail-view-model.test.ts`), so SR-5 leaves it
  unused.

## Verification

Per commit: tests beside the changed files, `scripts/check-changed.sh`. Before a push (owner's
call): the pre-push hook runs the tests beside the changed files, lint, `scripts/` and `src/styles/`
(AGENTS "Main stays green"); from a clean worktree. `npm run build` and `electron:build` stay CI's
job unless asked. Report what actually ran. E2E gate: skipped, this is styling and a refactor of an
existing surface, and the owner's no-Playwright-app rule stands.

Known red at the baseline (2026-11-06, also red on local `main` without the mock; the owner allowed
the first push of this branch with `--no-verify` for that reason): `scripts/ui-preset-boundary.test.ts`
(chrome markup names a utility the preset also generates), `scripts/ui-raw-controls.test.ts`
(`src/terminal/pane-header-action-buttons.tsx`, 2 raw buttons), `src/styles/composition-rules.test.ts`
(`src/terminal/pane-agent-header.css`, `gap: 1px`). List them under Evidence as pre-existing and do
not chase them; a build task that touches those files (T2 touches the pane header) must not add to
them.

Measurable checks per requirement are in the spec's traceability table. In the running app measure
with the same script shape used on the mock: computed row height, font sizes and weights, the x of
the workspace name and of the title (equal), and the absence of any `.state-mark` in a rail row.

## Handoff

(Nothing built yet. Update this section at each stop: checkout, branch, commits, what ran and its
result, what is left, blockers.)

/goal Build docs/specs/2026-11-06-rail-hierarchy-status-marks.md (SR-1..SR-9) on branch claude/rail-hierarchy-build (or a child of it), matching the gallery mock `mock · rail hierarchy` that the branch carries: rail rows with no status mark, 32px, 11px/10px text, status ink on the branch line, working shimmer and dots, "folder only" for non-git, sticky header with a corner count when folded, and the new mark set on the pane header, pill, strip tab and dock; verified by the tests beside each changed file, scripts/check-changed.sh, and measured sizes and x positions; push the result to its own branch and stop before merge and the owner's eye approval (T8).
