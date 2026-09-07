# Session restore

On launch Deck reopens the tabs that were open at quit and resumes each built-in agent's
conversation. Electron only: the lookup channel has no Tauri counterpart.
`Settings.restoreSessions` (default on) is the kill switch.

## The journal

[`session-journal.ts`](../../src/terminal/session-journal.ts) mirrors every window's live
tabs into `session.json` continuously, debounced 1 second, so the file is current at a hard
power-off rather than only at a clean quit.

- Keys: `windowLabels` (the store has no list-keys primitive), `window:<label>` records,
  `archive` (per-workspace, the rail's remembered rows) and `restoreAttempt` (the marker).
- A `WindowRecord` holds `savedAt`, `activeTabIndex`, `tabs`, `files` and `activeFileTab`.
  Each `SessionTab` holds `workspacePath`, `layout`, `panes`, `name` and `dotColor`; each
  `SessionPane` holds `cwd`, `agent` and `launchCommand`. The journal stores the **command**,
  not a preset id, so editing or removing a preset cannot rewrite a running session.
- Caps: 32 tabs per window and 24 archived workspaces, enforced on the write path too.
- A write is skipped when the record minus `savedAt` is unchanged. `capture()` reads the
  2-second poll cache with no IPC and no awaits: that is the deliberate accuracy bound.
- Restore suspends the journal so it cannot clobber what it is reading; quit flushes it with
  `force`, because the quit flow suspends first and an unforced flush was a no-op.
- A deliberate window close clears that window's record, so a closing window's tabs cannot
  resurrect as ghost tabs on the next boot.

## Boot restore

[`session-restore.ts`](../../src/terminal/session-restore.ts) runs from `App`, not from
`TabManager`.

1. **Crash-loop marker.** If `restoreAttempt` is already set, a previous attempt never
   finished: clear it and skip restoring this boot. Otherwise set it, and clear it in
   `finally`.
2. **Order.** The main window's tabs in order, then every other window's record newest
   first; a detached window's tabs fold into the main window.
3. **Liveness.** One `dirs_exist` call over every workspace path and pane cwd. A tab whose
   workspace is gone is dropped; a pane whose cwd is gone gets a null cwd and skips the
   lookup, because a stale cwd sent into a scanner that ranks by cwd match produces a wrong
   or wasted match.
4. **One batched `resume_lookup`** with one `{ agent, cwd, lastSeenAt }` per surviving
   built-in-agent pane, answered positionally.
5. **Materialize** each tab sequentially through `MaterializeIntent.paneCommands`, so each
   pane types its own resume command. A tab that throws is skipped and the rest continue.
6. Secondary window records are cleared **before** files and tab selection are restored, so
   a throw there cannot leave a stale record to fold in twice on the next boot.

Scrollback, unsaved edits and window placement never restore. The rail's remembered rows use
the same core for one workspace, without the marker.

## Resolving a conversation

[`electron/resume/resolve.ts`](../../electron/resume/resolve.ts) answers each request with an
exact id, `latest`, or nothing, and never rejects.

| Agent          | Scan                                                        | Answer                                   |
| -------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `claude`       | `~/.claude/projects/<project>/*.jsonl`, files directly in the project dir | exact id, else nothing      |
| `codex`        | Codex rollouts, interactive sources only, archived included | exact id, else nothing                   |
| `opencode`     | `opencode.db` via `node:sqlite` first, then the legacy JSON tree, deduplicated by id; sub-agent sessions excluded | exact id, else nothing |
| `gemini`       | none                                                        | always `latest`                          |
| `agy`          | `~/.gemini/antigravity/conversations/*.pb` head bytes       | best-effort id, else `latest`            |
| `cursor-agent` | none                                                        | nothing; relaunches bare                 |
| custom         | none                                                        | the declared command, unchanged          |

- Candidates within 30 days of `lastSeenAt` whose cwd matches are ranked by mtime proximity;
  a candidate is marked taken on selection, not on success, so two panes cannot resume the
  same conversation. Scans cap at 300 files and 64 KiB of head per file.
- The command comes from `COMMAND_TABLE` in [`agent-resume.ts`](../../src/lib/agent-resume.ts):
  `claude --resume <id>` / `--continue`, `codex resume <id>` / `--last`,
  `opencode -s <id>` / `-c`, `gemini --resume latest`, `agy --conversation <id>` /
  `--continue`, `cursor-agent --resume <id>`. An id is checked against
  `SESSION_REF_SAFE` (`[A-Za-z0-9._-]{1,128}`) in the one place before it can reach a PTY
  write; a failing id degrades to the bare command.
- Only `claude` is re-flagged on restore: the pane's own recorded `launchCommand` is the
  source, not the preset's current text, and the flags sit beside `--resume`.
- Session history (the dock's third tab and the board's "Resume a previous session…") lists
  Claude Code and Codex only, newest 500 per agent by default, titles read from the file
  head in batches of 8 with a `setImmediate` breath so the main process keeps serving PTYs.
  A history row refuses to resume unless the built command actually contains the session id,
  because a degraded bare command would silently open a new conversation.
