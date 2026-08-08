# Spec — Prompt Board

Status: approved in conversation 2026-08-08; revised same day after an external
Codex review (2 blockers, 6 majors — all accepted, fixes folded in below).

## 1. Problem

Deck runs agent CLIs, but every prompt is typed from scratch. Recurring prompts
(review this, fix that, write tests) live in the user's head or in scattered
notes. Meanwhile the machine already knows which skills and subagents each CLI
has installed — Deck just never reads them.

One surface: a board of reusable prompt templates. One click pastes a template
into the agent session already running in the focused pane; before injecting,
the user may pick a detected skill and/or subagent to reference in the prompt.

## 2. Decisions already made (user-resolved forks, 2026-08-08)

| Fork             | Decision                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Detection scope  | Claude Code AND Codex from v1. Codex custom prompts (`~/.codex/prompts`) deferred — see §5.4.                     |
| Inject semantics | Paste via xterm's bracketed-paste path. Each template carries its own `autoSend` flag; submit is triple-gated §7. |
| Storage          | Templates live in the settings store beside `customAgents`, same validation discipline.                           |
| UI surface       | A popover anchored to a new chrome button, overlaying the focused pane.                                           |
| Composition      | "Composer": footer pickers (skill ▾ / subagent ▾) append reference lines to the template body.                    |
| DL fork          | New DESIGN-LANGUAGE §13 for the popover surface + multi-line editor (drafted in §10).                             |

## 3. Goals (v1)

- Declare templates (label + multi-line body + auto-send flag) and manage them
  in the popover itself: add, edit in place, delete.
- One click pastes body (+ optional skill/subagent reference lines) into the
  focused pane's input through the bracketed-paste path — multi-line bodies
  land in the agent TUI's composer as one block, never line-by-line.
- Skills/subagents are detected from disk for the pane's agent (Claude, Codex),
  including project-level and installed-plugin sources for Claude.
- `autoSend` submits only when it is provably still safe to submit (§7); it
  degrades to paste-only, never to a wrong Enter.
- Detection is read-only: no shell is ever spawned by this feature.

## 4. Non-goals (later, not never)

- `{{slot}}` variables inside bodies (composer covers v1; slots need syntax,
  fill-in UI and validation).
- Codex custom prompts as insertables — they are standalone slash commands,
  not references one can embed in a larger prompt. Revisit as "insert as whole
  command" later.
- Detection for Gemini / OpenCode / Antigravity (scanner stays per-CLI
  extensible; nobody here has their asset layouts to verify against).
- Per-workspace template sets, import/export, reordering, sharing.
- Fixing the pre-existing gap that Restore Defaults silently wipes
  `customAgents` (surfaced during review; §8 fixes the dialog copy for both,
  but preserving data through reset is its own task).

## 5. Current source facts

Verified against `97bdacb`.

| Fact                                                                                                                                           | Where                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Pane.paste()` routes the clipboard through xterm's `paste()` (bracketed paste, `\n→\r`); writing PTY bytes directly skips both                | [`pane.ts`](../../src/terminal/pane.ts), [`terminal-clipboard.ts`](../../src/terminal/terminal-clipboard.ts)                         |
| Pane keystrokes reach the PTY via `onData → pty.writePty(...)`, fire-and-forget — two writes have no ordering guarantee                        | [`pane-lifecycle.ts`](../../src/terminal/pane-lifecycle.ts)                                                                          |
| `terminal-manager` already exposes `pasteIntoActive()` / `activePaneId()` — the precedent for injecting into the active pane                   | [`terminal-manager.ts`](../../src/terminal/terminal-manager.ts)                                                                      |
| `pty_info` reports per-pane `{cwd, process, kind, agent}`; `freshPaneInfo` is the non-polled variant for decision points                       | [`pane-info.ts`](../../src/terminal/pane-info.ts), [`process-info.ts`](../../src/lib/process-info.ts)                                |
| TabManager is the sole owner of the Agent Attention tracker; `snapshot(id)` yields `{phase, attention, ...}` per pane                          | [`tab-manager.ts`](../../src/terminal/tab-manager.ts), [`agent-attention.ts`](../../src/terminal/agent-attention.ts)                 |
| Settings persist through one validated schema; malformed entries are dropped, not repaired (`validateCustomAgents`)                            | [`settings-schema.ts`](../../src/settings/settings-schema.ts)                                                                        |
| `resetSettings()` replaces the whole settings object; the confirm dialog names only "theme, font, colors and behavior"                         | [`settings-store.ts`](../../src/settings/settings-store.ts), [`reset-section.tsx`](../../src/ui/settings/sections/reset-section.tsx) |
| Every shortcut/menu action is one registry entry; menu code is generated from it (R3)                                                          | [`action-registry.ts`](../../src/terminal/action-registry.ts)                                                                        |
| Active plugin installs are listed in `~/.claude/plugins/installed_plugins.json` (`installPath` per plugin); the cache dir keeps stale versions | verified on-disk 2026-08-08                                                                                                          |

Asset layouts verified on-disk 2026-08-08:

- Claude skills: `~/.claude/skills/<name>/SKILL.md`, `<project>/.claude/skills/<name>/SKILL.md`,
  `<installPath>/skills/<name>/SKILL.md` (frontmatter `name:` / `description:`; some
  use folded scalars `description: >`).
- Claude subagents: `~/.claude/agents/<name>.md`, `<project>/.claude/agents/<name>.md`.
- Codex skills: `~/.codex/skills/<name>/SKILL.md`. Codex agents: `~/.codex/agents/<name>.toml`.

## 6. Data model

```ts
export interface PromptTemplate {
  /** Stable `tpl:<slug>` id. Generated once from the label, never re-derived. */
  readonly id: string;
  readonly label: string;
  /** Multi-line prompt body, injected verbatim (plus composer lines). */
  readonly body: string;
  /** Submit after paste — subject to the triple gate in §7, never unconditional. */
  readonly autoSend: boolean;
}
```

`Settings` gains `promptTemplates: readonly PromptTemplate[]`, default `[]`,
validated like `customAgents`: malformed entry dropped, malformed array → `[]`,
duplicate ids deduped. Constants: `TEMPLATE_LABEL_MAX = 48`,
`TEMPLATE_BODY_MAX = 20_000`. Id generation mirrors `createCustomAgentId`
(slug + numeric suffix, frozen across rename).

**Restore Defaults copy.** Because templates now live in the settings object,
`resetSettings()` wipes them. The reset dialog sentence becomes: "Theme, font,
colors, behavior, declared agents and prompt templates all go back to their
defaults. This can't be undone." (It already wiped `customAgents` without
saying so — pre-existing; rewriting the sentence makes it true for both. Data
preservation through reset stays out of scope, §4.)

Detected assets (not persisted — fetched per popover open):

```ts
export type PromptAssetKind = "skill" | "subagent";
export interface PromptAsset {
  readonly kind: PromptAssetKind;
  /** Qualified name as the CLI would address it, e.g. `superpowers:brainstorming`. */
  readonly name: string;
  readonly description: string; // may be ""
  readonly source: "global" | "project" | "plugin";
}
```

## 7. Injection pipeline — the part that can go wrong

The external review found both blockers here; this section is the fix.

**Target capture.** Opening the popover snapshots `{paneId, agent, cwd}` of the
active pane (fresh `pty_info`, not the 2s poll cache). Every later action —
scan, inject, submit — uses that snapshot's `paneId`. If that pane exits or its
tab closes while the popover is open, the popover closes; it never re-targets
whatever became active.

**Ordered writes.** `pane-lifecycle` gains a per-pane FIFO write queue: `onData`
and injection both enqueue; each write starts only after the previous
`writePty` promise settles, and the queue drops writes for exited panes (the
existing `exited` guard). This makes "paste frame, then `\r`" structural, not
timed. No arbitrary delays.

**Paste.** `Pane` gains `pasteText(text)` — `term.paste(text)`, the same
bracketed-paste + `\n→\r` path the clipboard uses. Pasting is allowed even when
the pane runs a bare shell (it is exactly a Cmd+V, and bracketed paste means a
modern shell inserts without executing).

**Submit (the triple gate).** When the template has `autoSend`, after enqueueing
the paste Deck re-checks, immediately before enqueueing `\r`:

1. fresh `pty_info`: the target pane still reports `kind === "agent"` **and**
   the same `agent` captured at popover open;
2. attention snapshot (`TabManager.paneAttention(paneId)`, a thin passthrough
   to the tracker): `phase === "idle"` **and** attention is `none` or
   `completed` — a latched `requested`/`warning`/`error`, or `working`, means
   the TUI may be showing a dialog whose highlighted option Enter would accept;
3. the pane is still alive in the layout.

Any gate fails → the paste stands, `\r` is skipped, and a chrome toast says
"Pasted — not sent". Residual risk, accepted and documented: a TUI dialog that
emits no OSC signal is invisible to gate 2; the user chose per-template
`autoSend` knowing submit-time state cannot be proven perfectly.

**Composed text.** `body` + one line per picked asset, phrasing from one pure
table in `snippet-format.ts`:

| CLI    | skill                   | subagent                        |
| ------ | ----------------------- | ------------------------------- |
| claude | `Use the <name> skill.` | `Use the <name> subagent.`      |
| codex  | `Use the <name> skill.` | `Delegate to the <name> agent.` |

## 8. Detection (Rust)

New module `src-tauri/src/prompt_assets.rs`, one command
`list_prompt_assets(agent: String, cwd: Option<String>) -> PromptAssets`
(`{skills: Vec<PromptAsset>, subagents: Vec<PromptAsset>}`). Read-only
filesystem walk — no shell, no PTY, not one of the R4 load-bearing seams.

- **Roots.** claude: user dirs, project dirs, plus plugin skills resolved from
  `installed_plugins.json` `installPath`s (never a wildcard over the cache —
  the cache keeps stale versions of the same plugin). codex: user dirs only.
  Unknown `agent` value or missing dirs → empty lists, not an error.
- **Project root.** `cwd` is not the project root: walk ancestors of `cwd` to
  the nearest directory containing `.claude` or `.git` (first hit wins,
  filesystem root stops the walk). Project entries shadow global ones of the
  same name; plugin skills keep their qualified `plugin:skill` name and are
  never deduped against bare names.
- **Parsing.** Head-bounded reads (first 16 KiB), symlinks skipped (dirs and
  files), per-kind result cap 200, one bad file skips that file only. SKILL.md
  and agent `.md`: frontmatter block only; `name:`/`description:` plain
  scalars, folded/literal scalars (`>`, `|`) join their indented continuation
  lines; description clamped to 256 chars. Codex `.toml`: name = file stem,
  description = a top-level `description = "..."` line if present. No YAML/TOML
  crate — zero new dependencies, so no fork.

## 9. UI — the popover

New chrome icon button (`◇ prompts`, hand-drawn inline SVG per DL-11.3) in
[`chrome-actions.tsx`](../../src/ui/chrome-actions.tsx), plus action-registry
entry `toggle-prompts` (menu item comes from the registry — R3; the exact
key binding is chosen in the plan against the existing keymaps). Scope/tier
follows the tab popover precedent: pane-level overlay, dismissed by Esc,
outside click, or injecting.

Inside, per §12 editable-list rules plus the §13 draft below:

```
┌─ prompts ────────────────────────┐
│ fix bug                      ↩   │   row key = label; pill ↩ = inject
│ review PR               auto ↩   │   faint "auto" tag marks autoSend
│ write tests                  ↩   │
│   [expanded editor when the      │
│    label is clicked]             │
│ + new template                   │   DL-12.3 add row
│──────────────────────────────────│
│ skill      none ▾                │   native <select> (DL-1.4), only when
│ subagent   none ▾                │   the captured pane runs a known agent
└──────────────────────────────────┘
```

- Row click targets: the **pill** injects (and closes the popover, returning
  focus to the target pane); the **label** expands the inline editor under the
  row — body textarea, `autoSend` toggle row, delete `×` (DL-12.2). One row
  expanded at a time.
- The body textarea is a `CommitTextarea` — same contract as `CommitInput`
  (DL-6.3): local draft, commit on blur / Cmd+Enter, Esc reverts. Never a
  store-bound value.
- Pickers reset to "none" every open; their option lists come from
  `list_prompt_assets` fetched at open with the captured `{agent, cwd}`.
  No agent in the pane → pickers hidden; templates still inject (paste-only).
- Scan failure → templates still shown; picker area shows one faint line
  ("skills unavailable"), not an error state.

## 10. Design-language addition — §13 Anchored popovers (draft)

Approved as a fork 2026-08-08 (R2). To be added to `DESIGN-LANGUAGE.md` in the
implementation task, with the §10 migration table gaining no entry (no existing
popover violates it; the tab popover is reworked separately per its §10 row).

- **DL-13.1** A popover is a `--chrome-2` surface with a 1px `--hair-strong`
  inset hairline, radius 8px, anchored to its trigger. No blurred shadow
  (DL-1.3); depth comes from the background step.
- **DL-13.2** Dismissal: Esc, outside click, or completing the popover's
  action. On dismiss, focus returns to the pane (or control) that had it. The
  trigger carries `aria-expanded`; the surface is `role="dialog"` with a label.
- **DL-13.3** Content inside a popover is made of §5 rows and §12 list rows —
  a popover is a small screen, not a new widget genre.
- **DL-13.4** A §12 item row may expand exactly one inline editor region
  beneath it (`aria-expanded` on the row); expanding a row collapses any other.
  This is the documented extension of DL-12.5 for items whose value is
  multi-line.
- **DL-13.5** Multi-line text uses `CommitTextarea`: DL-6.3 semantics (local
  draft, commit on blur / Cmd+Enter, Esc reverts), auto-grown by content up to
  a max height, then scrolls.
- **DL-13.6** Transient controls in a popover (pickers, search) reset when it
  opens; a popover never remembers half-finished state across opens.

## 11. Module structure

```
src/prompts/prompt-templates.ts        # pure: schema constants, id generation, validation helpers
src/prompts/snippet-format.ts          # pure: per-CLI reference-line table (§7)
src/prompts/prompt-assets-client.ts    # invoke wrapper for list_prompt_assets (+ memory fake)
src/prompts/inject.ts                  # capture → paste → triple gate → submit orchestration
src/prompts/prompt-popover.tsx         # the popover (DL §12 + §13)
src-tauri/src/prompt_assets.rs         # scanner + command (registered in lib.rs)
```

Changed: `settings-schema.ts` (+`promptTemplates` +validation),
`pane.ts` (+`pasteText`), `pane-lifecycle.ts` (per-pane FIFO write queue),
`tab-manager.ts` (+`injectIntoPane(paneId, text, opts)` + `paneAttention(paneId)`),
`action-registry.ts` (+`toggle-prompts`), `chrome-actions.tsx` (+button),
`reset-section.tsx` (dialog copy), `menu_registry.rs` via `npm run generate:menu`.

Not changed: `agent-launch.ts`, `agents.rs` discovery, the PTY/coordinator
seams (R4) — injection rides the existing per-pane write path.

## 12. Error handling

| Case                                        | Behaviour                                                         |
| ------------------------------------------- | ----------------------------------------------------------------- |
| No active pane when opening                 | Button disabled; the shortcut no-ops with a chrome toast          |
| Target pane exits / tab closes while open   | Popover closes; nothing is injected                               |
| Triple gate fails on an `autoSend` template | Paste stands, `\r` skipped, toast "Pasted — not sent"             |
| `list_prompt_assets` IPC fails              | Templates shown; pickers replaced by one faint "unavailable" line |
| One asset file unreadable/malformed         | That file skipped; the rest of the list is unaffected             |
| Empty label / body on commit                | Commit blocked, inline error (`.cfg-custom--error`)               |
| Duplicate label                             | Allowed (ids are the identity); no error                          |
| Store write fails                           | Unchanged — `PersistErrorBar`                                     |
| Restore Defaults                            | Templates wiped; dialog copy now says so (§6)                     |

## 13. Verification

- `npm test` — schema validation (drop-not-repair, id stability), formatter
  table, id generation, write-queue ordering (paste frame before `\r` with a
  delayed `writePty` fake), triple-gate unit tests (each gate independently
  fails → no `\r`, asserted against the memory PTY client's `writes`),
  popover tests (rows render, expand/collapse, add/delete, pickers hidden
  without an agent).
- `cargo test` in `src-tauri` — parser (plain + folded scalars, TOML line,
  16 KiB cap, symlink skip), root walk (nested cwd finds `.claude`/`.git`),
  shadowing (project over global, plugin names stay qualified), missing dirs.
- `npm run build` — green (covers typecheck). `npm run generate:menu:check`.
- Screenshot eye-review of the popover against §12/§13 before done (DL §9.6).
- Manual: template with `autoSend` into a busy Claude pane → pasted, not sent;
  same template into an idle Claude pane → sent; agent quit between open and
  click → pasted only.

## 14. Open questions

| Question                                                        | Owner | Blocking?                          |
| --------------------------------------------------------------- | ----- | ---------------------------------- |
| Exact `toggle-prompts` key binding                              | plan  | no — resolved against keymap there |
| Do Codex agent `.toml` files carry a usable `description` field | plan  | no — name-only fallback specified  |
