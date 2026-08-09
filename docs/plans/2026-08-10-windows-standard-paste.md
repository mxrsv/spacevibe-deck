# Windows Standard Text Paste Implementation Plan

**Spec**: [2026-08-10-windows-standard-paste-design.md](../specs/2026-08-10-windows-standard-paste-design.md)
**Goal**: Make Windows text paste follow standard desktop shortcuts without taking the agent image-paste chord.
**Architecture**: Extend only `WINDOWS_KEYMAP`; all approved chords reuse the existing `paste` action and clipboard-to-xterm path. Lock the contract at the pure keymap layer and the capture-phase window dispatch layer, then update the public and living documentation.

## 1. Expected outcomes

- `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` resolve to `paste` on Windows — verify with `npm test -- src/terminal/keymap.test.ts`.
- `Alt+V` remains unbound by Deck — verify with test `leaves Alt+V to the active agent`.
- Every approved chord reaches the active pane's existing `paste()` dispatch target — verify with `npm test -- src/terminal/tab-manager.test.ts`.
- The complete frontend suite and production build remain green — verify with `npm test` and `npm run build`.

## 2. Source of truth

**Canonical data**: `WINDOWS_KEYMAP` defines which Windows keyboard events Deck owns.

**Derived from**: the approved contract in the spec and the existing `paste` action path.

**Not derived from**: clipboard contents or detected agent identity, because either would make shortcut ownership stateful and unpredictable.

## 3. Business rules and invariants

- **Standard text paste**: all three approved Windows chords map to the same `paste` action — verify with the `WINDOWS_KEYMAP` table test.
- **Agent image paste**: `Alt+V` never matches a Deck action — verify with an explicit negative keymap test.
- **Existing data path**: no new clipboard or PTY implementation is introduced — verify with `git diff -- src/terminal/terminal-clipboard.ts src/terminal/pane.ts src-tauri` returning no task-owned changes.
- **Platform isolation**: macOS does not acquire the Windows-only bindings — verify with the macOS negative test in `keymap.test.ts`.

## 4. Scope

**In scope**:

- Windows keymap entries.
- Pure keymap and window-dispatch tests.
- README and living architecture/context documentation.

**Out of scope**:

- Explorer `CF_HDROP` file-list paste.
- Smart clipboard routing or agent-specific keymaps.
- `src-tauri`, dependency, bundle, menu, and design-language changes.

## 5. Global constraints

- `Ctrl+V`, `Ctrl+Shift+V`, and physical `Shift+Insert` must dispatch `paste` on Windows.
- `Alt+V` must remain unbound by Deck.
- Paste must continue through the existing `Terminal.paste()` path.
- Tests must be written and observed failing for the expected missing bindings before production code changes.
- Existing unrelated worktree changes must not be reverted, reformatted, staged, or committed.

## 6. Tasks

### Task 1: Implement the Windows paste contract with TDD

**File(s)**:

- [keymap.test.ts](../../src/terminal/keymap.test.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)
- [action-registry.ts](../../src/terminal/action-registry.ts)

**Decision**: Test all three text-paste chords and the `Alt+V` non-binding before adding the two missing bindings.

**Build**:

- Add `Ctrl+V` and physical `Shift+Insert` to the Windows keymap test matrix while retaining `Ctrl+Shift+V`.
- Add an explicit assertion that `Alt+V` returns no action.
- Expand the window-level clipboard dispatch test to send all three paste events and expect three `paste()` calls.
- Expand macOS isolation coverage for the newly added Windows-only chords.
- Run the targeted tests and preserve the expected RED output before editing production code.
- Add `{ key: "v", ctrl: true, action: "paste" }` and `{ code: "Insert", shift: true, action: "paste" }` to `WINDOWS_KEYMAP`.
- Adjust the local keymap comment to describe standard Windows paste while preserving bare terminal control sequences other than the deliberately owned `Ctrl+V`.

**Verify**:

- RED: `npm test -- src/terminal/keymap.test.ts src/terminal/tab-manager.test.ts` → fails only because `Ctrl+V` and `Shift+Insert` are not yet bound.
- GREEN: rerun the same command after the keymap edit → both test files pass.

---

### Task 2: Update the public and living shortcut contract

**File(s)**:

- [README.md](../../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [CONTEXT.md](../CONTEXT.md)

**Depends on**: Task 1

**Decision**: Document the three text-paste chords, the retained `Alt+V` pass-through, and the lack of `CF_HDROP` support.

**Build**:

- Before editing, copy the current three files into the plan-scoped SDD scratch workspace so the task-owned documentation hunks can be separated from pre-existing icon-system edits.
- Update the README shortcut narrative and Windows table.
- Update the architecture keymap decision without changing unrelated architecture claims.
- Add the resolved root cause, implemented boundary, and unverified real-Windows gate to the current context.

**Verify**:

- Compare each edited file with its plan-scoped baseline copy → only the intended Windows paste paragraphs/table rows changed relative to the pre-task state.
- Inspect the rendered shortcut contract → `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` explicitly map to text paste; `Alt+V` explicitly remains agent-owned; `CF_HDROP` is explicitly unsupported; living-document source links retain `current` intent labels; both living docs retain their `Chưa khớp thực tế` ledgers.

---

### Task 3: Run full verification

**Depends on**: Tasks 1–2

**Decision**: Use the repository's mandatory test and production-build gates; do not claim Windows E2E from macOS automation.

**Build**:

- Run the full Vitest suite once after the final source and documentation state.
- Run the production build, which includes TypeScript checking.
- Inspect the source/test diff plus the plan-scoped documentation comparisons for scope, then run a separate whitespace check.

**Verify**:

- `npm test` → all tests pass.
- `npm run build` → TypeScript and Vite production build exit 0.
- Review `git diff -- src/terminal/action-registry.ts src/terminal/keymap.test.ts src/terminal/tab-manager.test.ts` together with the three plan-scoped documentation comparisons → no implementation or documentation hunk exceeds this plan.
- `git diff --check -- README.md docs/ARCHITECTURE.md docs/CONTEXT.md docs/specs/2026-08-10-windows-standard-paste-design.md docs/plans/2026-08-10-windows-standard-paste.md src/terminal/action-registry.ts src/terminal/keymap.test.ts src/terminal/tab-manager.test.ts` → no whitespace errors.
