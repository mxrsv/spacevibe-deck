# Agent Command Rows Implementation Plan

**Goal:** Settings → Agents lists every built-in agent as one row printing the command that agent will actually launch with, with its extra launch profiles nested under it — and adds `cursor-agent` as a sixth built-in.

**Architecture:** No new composition point. A row's text is `defaultLaunchOptions()` fed to `composeLaunchCommand()` — the two pure functions [2026-08-19-agent-launch-profiles.md](2026-08-19-agent-launch-profiles.md) `current` already landed. An agent with no default profile composes nothing and prints its bare binary, which IS the empty state; nothing is seeded.

**Tech Stack:** TypeScript, Preact + `@preact/signals`, Vitest.

**Spec:** None — direction approved in conversation on 2026-08-19 from an owner-supplied reference image. Decisions below are the record.

## Global Constraints

- **No seeding.** `launchProfiles` still defaults to `[]`. `claude` and `opencode` standing bare in the reference image IS the empty state.
- **No risk badge.** Re-confirmed by the owner on 2026-08-19, second time of asking. Rows print the command and nothing else.
- **No mono face** (DL-4.1, DL-15.4). Binary at `--text`, flags at `--text-faint`, as already shipped in `launch-profile-editor.tsx`.
- **The draft loses its agent radio.** Adding a profile now happens FROM an agent's row, so the agent is known. This also retires a DL-6.5 problem before it starts: `binary` caps at three options and `cursor-agent` would make four.
- **`cursor-agent` goes LAST** in `BUILTIN_AGENTS` (owner, 2026-08-19), so every existing digit key keeps its agent. Order is the digit-key contract in `AgentQuickPicker` and the Open board.
- **No Cursor logo file.** `AGENT_LOGOS` has no entry for it and none will be drawn; `letterAvatar` already covers a missing mark.
- **Flags verbatim from `--help`**, checked on this machine 2026-08-19: `cursor-agent --mode <plan|ask>`, `--model <m>`, `-f/--force`. `--yolo` is documented there as an alias of `--force`; the long form is what gets composed.
- **codex gains one boolean**, `bypass`, for its real `--dangerously-bypass-approvals-and-sandbox`. When on, `--sandbox` and `--ask-for-approval` are omitted from the command AND hidden in the editor — the CLI ignores them and a row printing all three would misdescribe what runs.
- **Commit hygiene.** The tree is shared and carries another plan's uncommitted work. Every commit names its paths; anything touching `agents-section.tsx`, `launch-profile-editor.tsx`, `section-registry.ts`, `gallery/main.tsx`, `AGENTS.md` or `docs/CONTEXT.md` joins the deferred clusters instead of being committed.
- **English only** in code, comments, docs and commits (AGENTS.md R1).

## Fork record

Adding an agent to `BUILTIN_AGENTS` reaches process classification
(`agentProcessMatchers`), which AGENTS.md names a stop-and-ask seam. The owner
approved it on 2026-08-19 after being shown the touch list.

## File Structure

**New files**

| File          | Responsibility                    |
| ------------- | --------------------------------- |
| `src/assets/` | nothing — no Cursor mark is drawn |

**Modified files**

| File                                               | Change                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/agent-catalog.ts`                         | `cursor-agent` appended to `BUILTIN_AGENTS`                                                                                         |
| `src/lib/agent-resume.ts`                          | `COMMAND_TABLE` entry: `--resume <id>` / `--continue` / bare                                                                        |
| `src/lib/launch-profile.ts`                        | `CursorLaunchOptions`, `CURSOR_MODES`, `codex.bypass`                                                                               |
| `src/lib/launch-command.ts`                        | compose both                                                                                                                        |
| `src/ui/settings/launch-profile-editor.tsx`        | per-agent rows, nested profiles, no agent radio                                                                                     |
| `src/ui/settings/sections/agents-section.tsx`      | the built-in list becomes the editor's own                                                                                          |
| `src/gallery/sections/launch-profiles-section.tsx` | specimen follows                                                                                                                    |
| tests pinning the agent list                       | `agent-catalog.test`, `electron/agents.test`, `usage-format.test`, `drop-agent-pane`, `settings-screen.test`, `agents-section.test` |
| `AGENTS.md`, `docs/CONTEXT.md`                     | record + fork queue                                                                                                                 |

**Deliberately not touched:** `electron/resume/*` — no Cursor session scanner in v1, so `resume_lookup` answers null and a restored cursor pane relaunches bare. `AgentLauncher`, PTY, window coordinator.

---

### Task 1: Model cursor-agent and codex's bypass

- [ ] Failing tests in `src/lib/launch-profile.test.ts` and `launch-command.test.ts`:
      `hasLaunchProfiles("cursor-agent")` is true; a cursor profile validates and composes
      `cursor-agent --model gpt-5 --mode plan --force`; `codex` with `bypass: true` composes
      `codex --dangerously-bypass-approvals-and-sandbox` and DROPS sandbox/approval even when set.
- [ ] `CURSOR_MODES = ["plan", "ask"]`, `CursorLaunchOptions { kind, model, mode, force }`,
      `CodexLaunchOptions.bypass: boolean`.
- [ ] `composeLaunchCommand` cases for both.
- [ ] Commit: `src/lib/launch-profile.ts`, `launch-command.ts` and their tests.

### Task 2: cursor-agent joins the catalog

- [ ] Read `electron/agents.ts` and every test pinning the agent list BEFORE editing.
- [ ] Append `{ id: "cursor-agent", label: "Cursor Agent" }` to `BUILTIN_AGENTS`.
- [ ] `COMMAND_TABLE["cursor-agent"]`.
- [ ] Fix the tests that assert the list, its order, or its length.
- [ ] Verify: `npm test -- agent-catalog agent-resume usage-format drop-agent-pane`, plus
      `npx tsc -p tsconfig.electron.json`.
- [ ] Commit the clean files; note any that join a deferred cluster.

### Task 3: The row is the command (gallery specimen)

- [ ] Rebuild the specimen: one row per built-in agent — brand mark (or letter avatar),
      composed command, an edit affordance; extra profiles indented beneath their agent;
      the draft with no agent radio.
- [ ] Both palettes, wide and 480px.
- [ ] Verify: `npm run build`, `rg -n "gallery/" src --glob '!gallery/**'`.

### Task 4: Owner eye review

- [ ] Screenshot and get explicit approval. **Task 5 does not start until this passes.**
- [ ] Two known departures from the reference image to state at review time: `gemini --yolo`
      is not reachable (gemini has no modelled options in v1), and the brand marks are the
      only colour on an otherwise achromatic surface (DL-3.7) — the review decides whether
      they stay.

### Task 5: The production surface

- [ ] Port the approved shape into `launch-profile-editor.tsx`; `agents-section.tsx` drops its
      own `Built in` block and mounts the editor as the whole agent list.
- [ ] Tests: a row prints its agent's default command; an agent with no default prints the bare
      binary; adding from an agent's row skips the agent question.
- [ ] Verify: `npm test -- launch-profile-editor agents-section settings-screen`.

### Task 6: Records and final verification

- [ ] `npm test`, `npm run build`.
- [ ] AGENTS.md bullet + fork-queue line; `docs/CONTEXT.md` section; drift row.
- [ ] Show the owner the docs before committing them (D14).

## Notes for the executor

- Never run `npm test` without a pattern until Task 6.
- `search-bar.test.ts` fails under the full suite and passes alone — a recorded flake, not yours.
- The tree is shared: attribute any unexpected failure by file mtime before touching it.
