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
| T7  | Review: `review-change` on the range; fix findings; W21 "changed N of M" and delete the gallery mock section `mock · rail hierarchy` only after T8 approval (W8) | review | SR-10 | 4 | done 2026-11-05; mock section kept until T8 (W8) |
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

## T7 review and W21 sweep (2026-11-05)

`review-change` over `3d78fcc..5ee0221`: `correctness` and `tests` ran; `security-code` skipped (CSS and
TSX only: no auth, input boundary, env, secret, dependency, shell, CI, permission, URL or path change).
No blocker. Fixed in the follow-up commit:

- sticky header could hide a keyboard-focused row: `scroll-padding-top: var(--row-28)` on
  `.asr-rail__list` and `scrollIntoView({ block: "nearest" })` after the arrow-key `focus()`;
- a folded workspace with no agents drew a "0" count (RH-15): the circle needs `count > 0`;
- coverage the review found missing or lost: the mark's seven statuses, `surface` and `confidence`
  props, the pane header and pill sizes, the Priority rank order (the roll-up tests had carried it),
  done/ended/idle ink and the faint date, the 9/10 count boundary, the 13px fallback folder, a
  remembered row's logo and text lining up with a live row's, and a policy test that every loop of the
  mark and the working row sits inside `prefers-reduced-motion: no-preference`;
- a remembered row of a folder git does not know now says "folder only" too (SR-6, RH-24 "never a
  blank second line"); an unknown path keeps a blank line.

Not done, on purpose: no unit test pins the sticky pinning or the opaque ground (jsdom has no layout); the
gallery measurement below and T8 cover them. The old `src/gallery/layout-mocks/ui-recipes` keeps its own
`--mark-*` tokens in its own `tokens.css` and is untouched.

W21, changed N of M: `AgentStateMark` 6 of 6 sites (rail row x2 and header x1 removed; pill x2 and pane
header x1 take a `surface`); `ROW_LEAD` 2 of 2 removed; `--mark-dot`, `--mark-ring`, `--mark-square` 3 of 3
removed as tokens (`.state-mark` keeps a local `--mark-dot`); `--mark-slot` 1 of 2 consumers changed (the
old rail's Recent activity grid keeps 14); `--row-40` 1 of 1; `--type-rail` 3 of 5 (header name, agent
title and remembered title moved; the checkout line and the search field stay on 13).

Measured in a real Chromium on the gallery section `mock · rail hierarchy`, whose "before" column draws
the real header and row and whose "after" column is the mock, both themes: row height 32 on all 22 rows;
title 11px/400, 600 on needs-you and unread; meta 10px; workspace name 12px/600 in `--text-primary`; the
name's x equals the title's x (40 from the frame, 32 from the row edge); logo box 16 holding a 12 glyph;
0 `.state-mark` or `[data-state]` in the rail; folded counts 8, 4, 3; 8 shimmering branches and 8 dot
triplets on the working rows; 3 "folder only" rows; header and row tops equal to the mock's to the pixel
after the section fix; after scrolling both frames by 140px one header is pinned at the frame's top and
the others sit where the mock's do. The seven marks match the mock's glyph for glyph (same box and ink
sizes). Reduced motion was only checked by the policy test and by the reviewer in Chrome; there is no
Playwright run of the Deck app (owner's rule).

## Verification run

Policy suites (`scripts/`, `src/styles/`): the same 3 failures as the baseline, with the same
messages (`ui-preset-boundary`, `ui-raw-controls`, `composition-rules`: `pane-agent-header.css` `gap: 1px`),
and nothing else. `src/ui`, `src/terminal`, `src/gallery`: all pass. `tsc`, oxlint and prettier on every
changed file: clean. `npm run build` and `electron:build` not run (CI's job). E2E gate skipped (plan).

## Handoff

- Checkout `/home/user/spacevibe-deck`, branch `claude/rail-hierarchy-build-impl`, a child of
  `claude/rail-hierarchy-build` (`3d78fcc`). Commits T0..T6 plus the T7 fixes sit on it.
- **Push:** the repo's `pre-push` hook blocks it, on the 3 baseline failures above only (it also needed
  `origin/main`, now fetched). The session may not use `--no-verify` without the owner's word, so see the
  state of the remote branch in the final report.
- Left: T8, the owner's eye review in the owner's dev app, both themes, against the mock: the real rail,
  the pane header, the pill; then delete the gallery section `mock · rail hierarchy` (W8) and mark the
  plan historical.
- Decisions taken without asking, reversible, for the owner to overrule: D1 inferred state = same shape
  at 55% ink; D2 the pill keeps its mark; D3 the strip tab and dock take no mark (they draw none today,
  DL-18.10); the working row's shimmer paints `background-position` (DL-1.2 lists transform and opacity
  only; recorded as an exception in DL-1.2); the count digit is 8px (`--type-rail-count`), a third step
  below 12 beside the 11 and 10; a remembered plain folder says "folder only".

/goal Build docs/specs/2026-11-06-rail-hierarchy-status-marks.md (SR-1..SR-9) on branch claude/rail-hierarchy-build (or a child of it), matching the gallery mock `mock · rail hierarchy` that the branch carries: rail rows with no status mark, 32px, 11px/10px text, status ink on the branch line, working shimmer and dots, "folder only" for non-git, sticky header with a corner count when folded, and the new mark set on the pane header, pill, strip tab and dock; verified by the tests beside each changed file, scripts/check-changed.sh, and measured sizes and x positions; push the result to its own branch and stop before merge and the owner's eye approval (T8).
