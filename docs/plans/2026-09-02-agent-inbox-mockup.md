# Agent Inbox Mockup Implementation Plan

**Spec**: [2026-09-02-agent-inbox-redesign-design.md](../specs/2026-09-02-agent-inbox-redesign-design.md)
**Goal**: Build one self-contained HTML decision surface for comparing three Agent Inbox treatments without changing production Deck code.
**Architecture**: A single document owns its fixture, CSS, and small interaction script so it opens directly from disk with no server or network. All treatments render the same project, worktree, agent, tab, and pane identities; only CSS presentation changes between treatments.

## 1. Expected outcomes

- The mockup opens directly from [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html) with no external asset request — verify with `rg -n 'https?://|<link[^>]+href=|<script[^>]+src=' docs/mockups/2026-09-02-agent-inbox.html`, which must return no matches.
- Three treatments show the same two-project, eight-agent fixture — verify by confirming `data-treatment="signal-ledger"`, `data-treatment="project-bands"`, and `data-treatment="quiet-index"` controls and exactly eight unique `data-agent-id` values.
- Selecting an agent synchronizes the selected row, active terminal layout, and focused pane — verify each agent control's `data-tab-id` and `data-pane-id` resolves to one matching pane and by owner click review.
- Wide and compact frames preserve the hierarchy without page-level horizontal overflow — verify both viewport controls by owner eye review at the mockup's fixed review frames.
- Browser and editor are absent from primary navigation — verify `rg -ni 'open browser|file editor|explorer dock|browser tab' docs/mockups/2026-09-02-agent-inbox.html`, which must return no matches.

## 2. Canonical data

**Canonical data**: The mockup's fixed fixture mirrors the identities and relationships documented in the approved spec; production behavior remains owned by [tab-manager.ts](../../src/terminal/tab-manager.ts), [tabs-store.ts](../../src/terminal/tabs-store.ts), [agent-rail-model.ts](../../src/ui/agent-rail-model.ts), and [session-tail-store.ts](../../src/terminal/session-tail-store.ts).

**Taken from**: The approved spec's hierarchy, state vocabulary, split-pane rule, and existing Deck semantic roles.

**Not taken from**: Orca-specific UI, parked Gallery candidates, live repository state, user settings, host IPC, network responses, or a duplicate production store.

## 3. Business rules and invariants

- **Shared fixture**: Treatment changes may alter CSS only; agent identity, order, state, message, tab, and pane mapping remain unchanged — verify by one shared fixture markup tree under the treatment root.
- **Exact focus**: One selected agent maps to one active tab and one focused pane; sibling panes in that tab remain mounted — verify every `data-agent-id` has one `data-tab-id` and `data-pane-id`, and click each split-tab agent during owner review.
- **Truthful silence**: An agent without a recent response retains identity and state without fabricated conversation text — verify the quiet fixture row has an empty message element and a visible identity.
- **Attention survives compression**: Compact mode may hide model, age, and response text but not identity, selection, or needs-attention/failed status — verify computed visibility by eye in the compact frame.
- **Isolated artifact**: The mockup has no production import, Vite entry, persistence, fetch, or external asset — verify static searches plus direct `file://` opening.
- **Keyboard access**: Treatment, viewport, and agent controls use native buttons with visible `:focus-visible` treatment — verify Tab, Shift+Tab, Enter, and Space during owner review.

## 4. Scope / Out of scope

**In scope**:

- Create one HTML file under `docs/mockups/` with inline CSS, fixture markup, and interaction script.
- Render three visually distinct Agent Inbox treatments over one shared fixture.
- Add wide/compact review controls and synchronized agent-to-pane selection.
- Add reduced-motion handling, visible keyboard focus, overflow containment, and links to the approved spec and this plan.
- Open the local file for owner eye review after static verification.

**Out of scope**:

- Any change under `src/`, `electron/`, `src-tauri/`, root HTML entries, `package.json`, or the existing Gallery.
- Production browser/editor access decisions or removal of their code.
- Changes to PTY, tab, pane, session, attention, worktree, or launch behavior.
- Tauri redesign, a new theme system, a task manager, automation, file exploration, accounts, or remote runtimes.
- Claiming production or native acceptance from the mockup.

## 5. Tasks

### Task 1: Create the isolated review document and shared fixture

**File(s)**:

- [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html)

**Decision**: One self-contained document holds one shared two-project, eight-agent fixture and links back to the approved spec and plan.

**Build**:

- Add semantic review controls, the app frame, Agent Inbox groups, stage context, terminal layouts, and eight stable agent-to-tab-to-pane mappings.
- Include working, needs-attention, failed, completed, and quiet states; include a plain non-Git project and at least one tab with multiple panes.
- Keep browser, editor, explorer, and secondary-product navigation out of the app frame.

**Verify**:

- Parse the document with the installed HTML5 `parse5` parser and collect `onParseError` results → exit `0` with `HTML5 parse errors: 0`.
- `rg -n 'https?://|<link[^>]+href=|<script[^>]+src=' docs/mockups/2026-09-02-agent-inbox.html` → no output.
- `rg -o 'data-agent-id="[^"]+"' docs/mockups/2026-09-02-agent-inbox.html | sort -u | wc -l` → output `8`.

---

### Task 2: Build the three Agent Inbox treatments

**File(s)**:

- [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html)

**Dependencies**: Task 1

**Decision**: Treatments share structure and content but differ materially in hierarchy, density, selection, and surface treatment.

**Build**:

- Add `Signal ledger`: a dense two-line agent ledger with explicit attention marks and the clearest operational scan.
- Add `Project bands`: stronger project/worktree bands with quieter agent rows and a more architectural rail rhythm.
- Add `Quiet index`: reduced chrome, more whitespace, and selective emphasis only on the chosen or actionable agents.
- Preserve Deck's neutral theme-derived chrome, deep terminal plane, sans-serif UI, monospace terminal, and semantic status color across all three.

**Verify**:

- `rg -o 'data-treatment="[^"]+"' docs/mockups/2026-09-02-agent-inbox.html | sort -u | wc -l` → output `3`.
- Switching treatments leaves the selected `data-agent-id`, `data-tab-id`, and `data-pane-id` unchanged during owner review.
- No treatment uses nested rounded cards for every project/worktree/agent level.

---

### Task 3: Add synchronized selection and review controls

**File(s)**:

- [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html)

**Dependencies**: Task 1

**Decision**: Native buttons drive treatment, viewport, and agent selection; agent selection activates its tab and focuses its exact pane without removing sibling panes.

**Build**:

- Add immutable fixture lookup and render-state replacement for treatment, viewport, selected agent, active tab, and focused pane.
- Update `aria-pressed`, selected-row state, stage context, active terminal layout, and focused-pane state from one selected agent identity.
- Preserve the selected agent when treatment or viewport changes.

**Verify**:

- Extract the inline script to a `mktemp` scratch file and run `node --check <scratch-file>` → exit `0`.
- Click every agent row: exactly one row is selected, one tab layout is active, and one pane is focused; split siblings remain visible.
- Tab to every control and activate it with Enter and Space; focus remains visible.

---

### Task 4: Lock compact behavior and accessibility safeguards

**File(s)**:

- [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html)

**Dependencies**: Tasks 2 and 3

**Decision**: Compact mode removes secondary metadata before identity, status, selection, or terminal content and never overlays the rail on the stage.

**Build**:

- Add fixed wide and compact review-frame dimensions, container-scoped compact rules, text truncation, and overflow containment.
- Add `prefers-reduced-motion`, visible `:focus-visible`, semantic labels, and contrast-safe attention/failure states.
- Keep the document itself responsive so the fixed app frame can be inspected on a smaller browser without creating horizontal page overflow.

**Verify**:

- Wide and compact owner review → no clipped controls, page-level horizontal scroll, rail overlay, or hidden attention/failure state.
- Reduced-motion emulation → no decorative animation continues.
- HTML5 `parse5` validation → `HTML5 parse errors: 0`.

---

### Task 5: Run static gates and hand the mockup to owner eye review

**File(s)**:

- [2026-09-02-agent-inbox.html](../mockups/2026-09-02-agent-inbox.html)
- [2026-09-02-agent-inbox-redesign-design.md](../specs/2026-09-02-agent-inbox-redesign-design.md)
- [2026-09-02-agent-inbox-mockup.md](2026-09-02-agent-inbox-mockup.md)

**Dependencies**: Tasks 1–4

**Decision**: Static correctness is necessary but owner eye review selects or rejects the visual treatment; the mockup never proves native Electron acceptance.

**Build**:

- Confirm the mockup links to the approved spec and plan and that neither planning document claims production completion.
- Open the local HTML file directly for the owner; do not start Vite, a development server, or Playwright.
- Record the selected treatment or requested revision in conversation before any production plan begins.

**Verify**:

- `git diff --no-index --check /dev/null <new-file>` for the spec, plan, and mockup → no whitespace-error output; exit `1` is expected because each file is new.
- HTML5 `parse5` validation → `HTML5 parse errors: 0`.
- Static network/import searches → no output; unique agent count → `8`; unique treatment count → `3`.
- Owner eye review → explicit selection, rejection, or revision request; no production-complete claim before that response.
