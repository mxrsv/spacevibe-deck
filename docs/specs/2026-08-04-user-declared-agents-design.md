# Spec — User-declared agents

Status: approved 2026-08-04
Branch: `feat/user-declared-agents` (worktree, based on `main` after PR #9)

This is `M2`, the work [the settings spec](2026-08-02-settings-full-window-design.md)
named as its next step. Its stated precondition — "diagnose the `opencode` launch
failure before `M2` ships" — was closed by PR #9: esbuild 0.25 mis-minified xterm 6's
function-local enum in `InputHandler.requestMode`, and the build now uses Terser.

## 1. Problem

The set of agent CLIs Deck can launch is a compile-time constant in two places:
[`AGENT_ALLOWLIST`](../../src-tauri/src/agents.rs) `current` in Rust, and
[`AGENT_LABELS`](../../src/open-board/open-board.tsx) `current` in the Open board.
Running anything else — a CLI Deck has never heard of, or a known one with flags
(`claude --resume`, `codex --model o3`) — means editing the source and rebuilding.

Two distinct needs, one shape: **a name plus a command line, declared by the user.**

## 2. Goals (MVP)

- Declare an agent as a label plus a full shell command, in Settings.
- Declared agents appear in the Open board's agent row beside the built-in four,
  selectable by click and by digit key, remembered per workspace like any other.
- A declared agent whose binary is not on `$PATH` degrades exactly like a built-in
  one does today: the board warns, and the choice falls back.
- Declaring an agent cannot execute anything at declare time.

## 3. Non-goals (later, not never)

- Editing the built-in four (their command stays the bare binary name). The list
  shows them locked so the set reads as one, but they are not editable at MVP.
- Per-workspace agent sets, env vars, or working directories per agent.
- Importing agent definitions from a file, or syncing them between machines.
- An icon picker. Declared agents use the existing letter avatar.

## 4. Current source facts

Verified against `23fd43e`.

| Fact                                                                                               | Where                                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `AgentChoice = string \| null`; the string is a binary name, `null` is Shell only                  | [`workspace-recents.ts`](../../src/lib/workspace-recents.ts) `current`             |
| The choice is persisted per workspace as `lastAgent` and resolved by `resolveAgentChoice`          | [`workspace-recents.ts`](../../src/lib/workspace-recents.ts) `current`             |
| The launcher writes the choice into the pane verbatim: `pty.writePty(id, \`${entry.agent}\r\`)`    | [`agent-launch.ts`](../../src/terminal/agent-launch.ts) `current`                  |
| macOS discovery builds one shell script: `command -v <name>` joined by `; `, run under `sh -ilc`   | [`macos.rs`](../../src-tauri/src/platform/macos.rs) `current`                      |
| Windows discovery loops the same allowlist through a search provider, normalising `.exe/.cmd/.bat` | [`agent_discovery.rs`](../../src-tauri/src/platform/windows/agent_discovery.rs)    |
| Settings persist through one validated schema and a debounced Tauri store                          | [`settings-schema.ts`](../../src/settings/settings-schema.ts) `current`            |
| A settings category is one registry entry plus one file under `sections/`                          | [`settings-categories.ts`](../../src/ui/settings/settings-categories.ts) `current` |

### 4.1 The fact that shapes everything

`lastAgent` is **already on disk** in every user's recents, holding bare binary
names. Any design that changes what that string means has to migrate it. The design
below keeps the string a stable id and makes built-in ids identical to their binary
names, so every recents entry written before this change keeps resolving unchanged
and no migration exists to get wrong.

## 5. Data model

```ts
export interface CustomAgent {
  /** Stable id, `custom:<slug>`. Generated once; never re-derived from label. */
  readonly id: string;
  /** Display name in the chip and the settings list. */
  readonly label: string;
  /** The full command line typed into the pane. */
  readonly command: string;
}
```

`Settings` gains `customAgents: readonly CustomAgent[]`, defaulting to `[]`, validated
by `validateSettings` like every other field: a malformed entry is dropped, not
repaired, and a malformed array falls back to `[]`.

The id is generated from the label at creation (`custom:aider`), de-duplicated with a
numeric suffix, and then **frozen**. Renaming an agent keeps its id, so a workspace
that remembers it keeps opening it.

## 6. Design

### 6.1 Resolving a choice to a command

One new pure module, `src/lib/agent-catalog.ts`:

- `agentBinary(command)` — the first whitespace-separated token.
- `resolveAgentCommand(id, customAgents)` — built-in id → itself; `custom:*` → that
  agent's `command`; unknown → `null`.
- `probeNames(customAgents)` — built-in names plus each custom agent's binary, deduped.

`tab-manager` resolves the id to a command at the call site and passes the command to
`launcher.arm()`. `agent-launch.ts` is **unchanged**: it still receives a string and
still writes it verbatim. Keeping the launcher ignorant of the catalog is deliberate —
its retry/timeout state machine is the trickiest code in the path and this change has
no business touching it.

### 6.2 Discovery

`detect_agents` gains a parameter: `detect_agents(names: Vec<String>) -> Vec<AgentInfo>`.

- Rust **re-filters** every name through `is_probe_safe` and silently drops the rest.
  The frontend validates too, but the frontend is not the trust boundary.
- The built-in names are always probed, whatever the caller sends, so a frontend bug
  can never collapse the picker to Shell only.
- The return contract is unchanged and stays keyed by binary name: it answers "which
  binaries exist", nothing more. Two custom agents sharing a binary (`claude --resume`
  and `claude -c`) both resolve against the same single `AgentInfo` — which is why the
  chips are built from settings, not from the discovery result.

`AGENT_ALLOWLIST` is renamed `BUILTIN_AGENTS`; the constant survives, its meaning
narrows from "the only agents that may exist" to "the agents always probed".

### 6.3 Safety — this is the part that can go wrong

macOS discovery interpolates each name into a shell script run by `sh -ilc`. Today
that is safe because the names are a compile-time constant. Once a user supplies them
it is a **command-injection sink**: an agent named `x; rm -rf ~` would run.

`is_probe_safe(name)` accepts only `A–Z a–z 0–9 . _ - / ~ +`, requires non-empty, and
caps length at 128. Everything that gives a shell power — whitespace, `;`, `&`, `|`,
`$`, backtick, quotes, parentheses, newline — is absent from that set. It is written
as a plain `chars().all(…)` check; no `regex` crate, because a new dependency is a
fork and this does not need one.

The **command's remaining arguments are never escaped and never probed** — they are
written into the user's own interactive shell, which is exactly what typing them by
hand would do. Deck is a terminal; running the command a user typed is the product.
The boundary being defended is the _discovery probe_, which the user did not ask to
run and which executes before any pane exists.

### 6.4 The Open board

The board stops mapping the discovery result straight to chips. It builds one list:

```
built-ins found on $PATH  →  chip { id: name, label: AGENT_LABELS[name], logo }
custom agents (settings)  →  chip { id, label, letter avatar, missing?: bool }
Shell only                →  chip { id: null }
```

Digit keys, arrow movement, the selected-chip marker and the stale-choice warning all
keep working against this list; `resolveAgentChoice` now compares ids instead of
binary names, which for built-ins is the same string it always compared.

A custom agent whose binary is missing stays visible but marked, rather than vanishing:
a chip that disappears when a tool is uninstalled reads as data loss.

## 7. Design-language addition — §12 Editable lists

Approved as a fork on 2026-08-04. §5 allows exactly one interactive value per row and
forbids list widgets outright, so a list the user can add to and delete from needs a
rule rather than an exception.

- **DL-12.1** A list section renders **one `cfg-row` per item**. The item's name is the
  row key; its single pill shows the item's value. The list is rows, not a widget.
- **DL-12.2** An item row may carry **one** destructive affordance (`×`) after the pill.
  It sits outside the value slot, is `--text-faint`, and turns `--red` on hover (DL-3.2).
  This is the only place in the app where a row holds a second interactive element, and
  it is allowed only for removing that row's own item.
- **DL-12.3** The list's final row is the add affordance: an `action` pill (`+ add`),
  keyed like any other row.
- **DL-12.4** Items the user cannot edit appear in the same list, pill disabled and no
  `×` (DL-5.2's disabled treatment). A separate "built-in" section would imply two
  different kinds of thing; they are one set with different permissions.
- **DL-12.5** Editing is in place: the pill becomes a `CommitInput` (DL-6.3). No modal,
  no drawer — a list that opens a dialog per row is the widget genre §5 rejects.

### 7.1 Migration note for the ledger

§10's migration table gains no entry: no existing component violates §12, because no
editable list exists yet.

## 8. Module structure

```
src/lib/agent-catalog.ts              # pure: binary extraction, id generation, resolution
src/lib/agent-catalog.test.ts
src/ui/settings/sections/agents-section.tsx       # the list (DL-12)
src/ui/settings/sections/agents-section.test.tsx
```

Changed: `settings-schema.ts` (+field, +validation), `settings-categories.ts` (+entry),
`active-category-store.ts` (+`"agents"` in `CategoryId`), `settings-nav-icons.tsx`
(+icon), `open-board.tsx` (chip list), `tab-manager.ts` (resolve before arm),
`pty-client.ts` (`detectAgents(names)`), `agents.rs`, `macos.rs`,
`windows/agent_discovery.rs`.

Not changed: `agent-launch.ts`, `workspace-recents.ts` (the `AgentChoice` type already
says `string | null` and still does).

## 9. Error handling

| Case                                   | Behaviour                                                     |
| -------------------------------------- | ------------------------------------------------------------- |
| Empty label or command                 | Save blocked, inline error on the row (`.cfg-custom--error`)  |
| Label duplicates another agent's       | Save blocked, inline error                                    |
| Binary fails `is_probe_safe`           | Save blocked, inline error naming the character class allowed |
| Binary valid but absent from `$PATH`   | Saves fine; chip shows as missing; board warns on selection   |
| Discovery times out or the shell hangs | Unchanged — empty list, board degrades to Shell only          |
| Store write fails                      | Unchanged — `PersistErrorBar`                                 |

## 10. Verification

- `npm test` — green, including: catalog unit tests (id stability across rename,
  binary extraction, injection strings rejected), section tests (add / edit / remove /
  duplicate-label / bad-binary), and a board test that a custom chip is selectable by
  digit key.
- `cargo test` in `src-tauri` — `is_probe_safe` rejects each metacharacter; discovery
  probes built-ins even when the caller sends an empty or fully-invalid list.
- `npm run build` — green (covers typecheck).
- Screenshot of the Agents section reviewed by eye against §12 before calling it done
  (§9, item 6).
- Manual: declare `aider --model sonnet`, open a workspace with it, confirm the pane
  receives the full command; rename it, reopen the workspace, confirm it still opens.

## 11. Open questions

| Question                                                                 | Owner   | Blocking?                      |
| ------------------------------------------------------------------------ | ------- | ------------------------------ |
| Should the built-in four become editable once §12 exists?                | product | no — non-goal at MVP           |
| Should a missing custom agent be removable straight from the board chip? | product | no — Settings is the one place |
