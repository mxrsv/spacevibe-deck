# Windows Standard Text Paste Design

**Status:** Approved in conversation on 2026-08-10

## Problem

Deck currently leaves Windows `Ctrl+V` unbound, so the keystroke reaches the
active agent CLI. Codex interprets that chord as an image-paste request and
reports an empty or incompatible image clipboard when the user intended to
paste copied text such as a folder path.

## Decision

Deck owns these Windows text-paste chords:

- `Ctrl+V`
- `Ctrl+Shift+V`
- `Shift+Insert`

All three dispatch the existing `paste` action, which reads clipboard text and
passes it to xterm's `Terminal.paste()` path. `Alt+V` remains unbound by Deck so
agent CLIs can keep using it for image paste.

This is an exact keymap contract. Deck does not inspect clipboard content to
choose between agent image paste and terminal text paste.

## Scope

In scope:

- Windows keymap bindings and dispatch regression coverage.
- Documentation of the Windows shortcut contract.

Out of scope:

- `CF_HDROP` / Explorer file-list clipboard support.
- Agent-specific shortcut routing.
- Smart clipboard-content detection.
- macOS shortcut changes.
- Changes to the PTY, Tauri backend, dependencies, bundle, or design language.

## Failure modes

- `Ctrl+V` reaches Codex instead of Deck: prevented by a keymap assertion and a
  window-level dispatch test.
- `Alt+V` is captured by Deck: prevented by an explicit negative keymap test.
- Existing `Ctrl+Shift+V` regresses: retained in the same positive test matrix.
- `Shift+Insert` matches only by a layout-produced character: prevented by
  binding the physical `Insert` code and testing that code path.
- macOS accidentally gains Windows bindings: prevented by the existing macOS
  isolation test, expanded for the new chords.

## Done

- The three approved Windows chords invoke the existing `paste` action.
- `Alt+V` remains unbound.
- Clipboard bytes continue to flow through `Terminal.paste()`.
- Targeted tests, `npm test`, and `npm run build` pass.
- A real Windows desktop check remains required before claiming platform E2E
  verification.
