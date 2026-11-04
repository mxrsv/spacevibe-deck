# UI recipes and ratchet — plan

Spec: [docs/specs/2026-11-05-ui-recipes-ratchet.md](../specs/2026-11-05-ui-recipes-ratchet.md) (RCP-1..32,
AC-1..6). Parent: [docs/specs/2026-11-03-ui-composition.md](../specs/2026-11-03-ui-composition.md).

**Visual standard:** the owner approved it by eye on 2026-11-05. It is a multi-file static mock under
[`src/gallery/layout-mocks/ui-recipes/`](../../src/gallery/layout-mocks/ui-recipes/index.html), and it
ships with this track's PR, so the standard lands on `main` beside the code it governs:
- `index.html` plus nine tabs: window, launcher, rail, stage, dock, overlays, settings, notices, rules;
- `tokens.css`, `chrome.css` and `app.js`;
- `DECISIONS.md`, the record of every decision. If the spec is silent, DECISIONS.md decides.

Open `src/gallery/layout-mocks/ui-recipes/index.html` in a browser, with `?theme=dark` or
`?theme=light`. The gallery is never bundled (R7), so the mock costs the app nothing. Decision 5
below already applies to it: its dims are opacity and a colour scrim, with no `filter`.

Status: approved for a cloud build (owner, 2026-11-05).

## Operating contract

Built in a cloud session on branch `claude/ui-recipes-full`, cut from `mock/ui-recipes` so the mock
stays in the tree for the whole run and lands on `main` with the PR.

- **Work:** one branch for the whole track. Commit each stage below with `git commit -- <paths>` when its checks pass. Push the branch after each stage, and open one draft PR against `main` after stage 0.
- **Merge:** do not merge. The owner merges after the final eye review (stage 7). This repo's rule: a UI change is not merged before the owner's eye approval.
- **No Electron, no Playwright:** never launch Electron or drive the app with Playwright; the owner's rule. Gallery state sheets are the visual evidence. Capture them headless if the sandbox has Chromium; otherwise let [`pr-shots.yml`](../../.github/workflows/pr-shots.yml) take them on the PR.
- **Stop only for:**
  - a fork under `AGENTS.md` Forks that this plan does not name;
  - a red policy suite you cannot attribute;
  - the final eye review.
- **Named forks, authorized with this plan:** the DL changes the spec's "Design-language changes" table lists as approved. They are DL-1.3, DL-20.5, the new §20 row and weight scales, the new §21 pressed rule, DL-27.3 and DL-14.1. Rewrite each in `docs/DESIGN-LANGUAGE.md` in the commit that ships it.

## Decisions (owner, answered 2026-11-05)

The owner approved all six recommendations. Each is now a named fork, authorized like the ones
above.

1. **DL-1.2:** approved. The braille loop runs on the rail row, the strip tab and the pane header,
   and holds ⠹ under reduced motion.
2. **DL-1.3 / DL-1.6:** approved. Preset popups use `--elev-*` instead of `shadow-md` and `ring-1`,
   the preset's weight 500 goes, and an `RCP-n` value wins over the preset's own.
3. **DL-4.4:** approved. The legacy type ladder gains the 16 rung (`--type-dialog`).
4. **DL-21.7:** approved. A panel footer and the avatar get the 3% resting wash.
5. **Remembered-row dim:** approved. DL forbids `filter`, so the logo dims by opacity 0.5 alone and
   a backdrop dims under a colour scrim; the mock was updated to match.
6. **Unplaced surfaces:** approved. The browser toolbar ships with stage 3; notices, launcher forms
   and the usage page ship with stage 5.

## Stages

| Stage | Covers | Work | Checks |
| --- | --- | --- | --- |
| 0 Tokens and ratchet | RCP-1..23 tokens; RCP-24..29 | **Tokens.** Add the missing tokens to `src/styles/01-tokens.css`, plus `src/lib/derive-colors.ts` for per-theme values, under the spec's names: `--space-*`, `--row-24/32/44`, `--control-h-*`, `--elev-1/2/3`, `--state-pressed-bg`, the status inks, scrollbar and selection.<br>**Ratchet.** Extend `src/styles/composition-rules.test.ts` (CSS) and `scripts/ui-composition-gate.test.ts` (`.tsx`) with every check the spec names. Seed a per-file debt ledger with today's counts, so the suite is green on day one. Add the `ui-scale: <reason>` exception.<br>**Icons.** Type `DeckIcon`'s `size` prop as 16 \| 14 \| 12. | The policy suites pass. A seeded off-scale value of each kind fails, and the same value with `ui-scale:` passes (AC-4). |
| 1 CMP-20 leak | RCP-29 | Move the live classes (`rail-create`, `nt-primary-action`, `dock-panel`, `file-panel`, `file-tree-shell__status`, and any others the move finds) out of the exempt partials `04a–04f`, `14-dock.css` and `19-agent-board.css` into the live surface's stylesheet. | The tests beside the changed files, and the policy suites. |
| 2 Rail | RCP for rail, rows 44, leading mark, braille | The project rail and remembered rows reach the mock's rail tab. Debt for their files goes to 0, and DL-27.3 is rewritten. | Ledger rows for rail files are gone; rail tests pass; gallery sheet. |
| 3 Stage bar and pane header | stage, toolbar, browser toolbar | Tab strip, chips, toolbar and split buttons, pane header and divider. | Same. |
| 4 Dock | dock | Strip, file tabs, breadcrumb band, Changes stack, tree, Usage, History, Files. | Same. |
| 5 Overlays | menus, popovers, tooltips, modals, forms, notices, usage page | Preset popups adopt `--elev-*` (decision 2). | Same. |
| 6 Command Settings | settings | Frame plus row patterns. | Same. |
| 7 Owner eye review | AC-2, AC-3 | **Gallery sheets.** One gallery section per surface from the real components (`src/gallery/force-states.ts`), in graphite and Deck Light, beside the mock. Show every state: rest, hover, focus, selected, selected+focus, pressed, disabled, drag-over, needs you.<br>**Review.** The owner reviews by eye once, then runs the real app once. | The owner's yes. |

**Every stage:**
- run the tests beside the changed files;
- run `npx prettier --check` and `npx oxlint` on the changed files;
- run `npx vitest run scripts/ src/styles/ --exclude '.claude/**'`;
- run `npx tsc --noEmit -p tsconfig.json`.

The full suite and builds are CI's job. A suite red on the clean clone before any change is pre-existing: list it, do not chase it.

## Progress

- 2026-11-05: intent, grilling (Q1–Q31) and mock approved; shadow mid and the braille working mark picked. Spec `3e64b007`. Mock pushed to `mock/ui-recipes`.

## Handoff

Nothing built yet.

`/goal` Ship docs/specs/2026-11-05-ui-recipes-ratchet.md per docs/plans/2026-11-05-ui-recipes-ratchet.md: stage 0's tokens and ratchet with a seeded ledger, the CMP-20 leak moved, then rail, stage, dock, overlays and Command Settings each at zero debt with their tests and policy suites green (AC-1, AC-4–AC-6), then gallery state sheets in graphite and Deck Light and the owner's eye approval (AC-2, AC-3) before merge.
