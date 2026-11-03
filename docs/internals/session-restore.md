# Session restore

> For maintainers. Using Deck? See [docs/user/](../user/).

Deck can reopen the tabs that were open at quit and resume each built-in agent's
conversation, but launch never does it unasked: the board offers the previous session as one
**Last session** line, and only its **Reopen** runs the restore. Reopening everything by
default buried the start of a new day under yesterday's agents, so the setting that switched
it off (`restoreSessions`) went with it and validation drops the stale field.

## The journal

[`session-journal.ts`](../../src/terminal/session-journal.ts) mirrors every window's live
tabs into `session.json` continuously, debounced 1 second, so the file is current at a hard
power-off rather than only at a clean quit.

- Keys: `window:<label>` records, `pendingRestore` (unrestored dated records),
  `archive` (per-workspace, the rail's remembered rows) and `restoreAttempt` (the marker).
- The [store IPC](../../electron/ipc/register-store.ts) derives the virtual `windowLabels`
  read from record keys in main. Renderers never maintain a shared index array; a legacy
  index cannot hide a record or resurrect one that was deleted.
- A `WindowRecord` holds `savedAt`, `activeTabIndex`, `tabs`, `files` and `activeFileTab`.
  Each `SessionTab` holds `workspacePath`, `layout`, `panes`, `name` and `dotColor`; each
  `SessionPane` holds `cwd`, `agent` and `launchCommand`. The journal stores the **command**,
  not a preset id, so editing or removing a preset cannot rewrite a running session.
- Caps: 32 tabs per window and 24 archived workspaces, enforced on the write path too.
- A write is skipped when the record minus `savedAt` is unchanged. `capture()` reads the
  2-second poll cache with no IPC and no awaits: that is the deliberate accuracy bound.
- **Quit acknowledgment means durable persistence, not an attempted write.** Restore and
  quit suspend captures; quit forces a strict flush that drains preceding writes and rejects
  failures. An unforced background flush while suspended is a no-op; a strict one rejects.
  A background error reporter
  cannot stand in for this acknowledgment. See the
  [journal](../../src/terminal/session-journal.ts) and
  [quit preparation](../../electron/ipc/register-quit.ts).
- **A checkpoint is one host mutation, not several individually atomic file writes.**
  [Store.patch](../../src/host/store-host.ts) carries the live record, pending records and
  consumed source keys through one [store handler](../../electron/ipc/register-store.ts).
  [JsonStore.patch](../../electron/store.ts) replaces them together before saving; autosave
  and a peer's Save must never observe half a checkpoint. Live peer records are protected
  from cleanup, and retry offers use pending identities rather than reused window labels.
- **Restore and quit preparation cannot start over one another.** The
  [restore action](../../src/ui/last-session-actions.ts) claims an idle journal before
  touching the offer or crash marker. A strict quit flush refuses another operation's
  suspension. The user can retry the canceled operation after the other finishes.
- While the offer stands, `holdEmpty` keeps the fresh, tabless window from overwriting the
  main record. Without it the journal's first write would erase the offer, and a launch that
  was closed without choosing would offer nothing next time.
- A deliberate window close clears that window's record, so a closing window's tabs cannot
  resurrect as ghost tabs on the next boot.

## The last-session offer

Boot calls `readLastSession` before the journal starts and holds the records in
[`last-session-store.ts`](../../src/terminal/last-session-store.ts); the board prints their
tab count and workspace names. The offer ends one of three ways, all in
[`last-session-actions.ts`](../../src/ui/last-session-actions.ts):

- **Reopen** runs `restoreSession` over the held records. Failed tabs stay in a retry offer
  and in `pendingRestore`; successful tabs are not retried. Live captures must preserve those
  pending records and include them in the archive, or a later ordinary flush silently erases
  the recovery path after partial success.
- **Dismiss**, or opening a tab instead of accepting the initial offer, drops it. Opening
  live tabs does not dismiss a retry offer. A restore checkpoint saves pending records and
  the live capture before consuming source records; failure is not equivalent to dismissal.
- A crash-loop marker left set means the last reopen crashed Deck; boot clears it and offers
  nothing, so the session that crashed is not offered back.

## Restoring

[`session-restore.ts`](../../src/terminal/session-restore.ts) runs from `App`, not from
`TabManager`.

1. **Crash-loop marker.** Set before materializing and cleared in `finally`; one still set at
   the next boot withholds the offer, as above.
2. **Order.** The main window's tabs in order, then every other window's record newest
   first; a detached window's tabs fold into the main window.
3. **Liveness.** One `dirs_exist` call over every workspace path and pane cwd. A tab whose
   workspace is gone is dropped; a pane whose cwd is gone gets a null cwd and skips the
   lookup, because a stale cwd sent into a scanner that ranks by cwd match produces a wrong
   or wasted match.
4. **One batched `resume_lookup`** with one `{ agent, cwd, lastSeenAt }` per surviving
   built-in-agent pane, answered positionally.
5. **Materialize** each tab sequentially through `MaterializeIntent.paneCommands`, so each
   pane types its own resume command. A false result or exception retains that tab for retry
   while the rest continue.
6. The [reopen action](../../src/ui/last-session-actions.ts) checkpoints live and pending
   tabs together before consuming source records. Clearing all secondary records merely
   because one tab succeeded would lose the remaining tabs; preserving the full source
   instead would duplicate the successful ones on retry.

While `AGENT_BOARD_RETIRED` is on (Mission Control replaced the Board on 2026-09-28), the
Board flags below are read without error and ignored. With the switch off:

The main record remembers the Agent Board chip separately from whether its surface held the
stage. Restore its surface **after** terminal selection, which deactivates every surface;
when it was active, do not activate a saved file over it. Records without the surface flag keep
the chip-only behavior. Secondary records cannot raise the Board, and no Board restores unless
at least one terminal tab survives. The decision is recorded in
[DECK-33](https://linear.app/mxrsv/issue/DECK-33).

Scrollback, unsaved edits and window placement never restore. The rail's remembered rows use
the same core for one workspace, without the marker; they also restore each pane's saved task
prompt, since the archive carries the same session tabs as the last-session offer.

## Resolving a conversation

[`electron/resume/resolve.ts`](../../electron/resume/resolve.ts) answers each request with an
exact id, `latest`, or nothing, and never rejects.

| Agent          | Scan                                                        | Answer                                   |
| -------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `claude`       | `~/.claude/projects/<project>/*.jsonl`, files directly in the project dir | exact id, else nothing      |
| `codex`        | Codex rollouts, plain or compressed, interactive sources only, archived included | exact id, else nothing |
| `opencode`     | `opencode.db` via `node:sqlite` (the 1.x and 2.x session tables) first, then the legacy JSON tree, deduplicated by id; sub-agent sessions excluded | exact id, else nothing |
| `gemini`       | none                                                        | always `latest`                          |
| `agy`          | `~/.gemini/antigravity/conversations/*.pb` head bytes       | best-effort id, else `latest`            |
| custom         | none                                                        | the declared command, unchanged          |

- Candidates within 30 days of `lastSeenAt` whose cwd matches are ranked by mtime proximity;
  a candidate is marked taken on selection, not on success, so two panes cannot resume the
  same conversation. Scans cap at 300 files and 64 KiB of head per file.
- The command comes from `COMMAND_TABLE` in [`agent-resume.ts`](../../src/lib/agent-resume.ts),
  built from each active agent's resume forms: `claude --resume <id>` / `--continue`,
  `codex resume <id>` / `--last`, `opencode -s <id>` / `-c`, `gemini --resume latest`,
  `agy --conversation <id>` / `--continue`. A withdrawn agent has no entry, so its journaled
  pane restores as a plain shell. An id is checked against
  `SESSION_REF_SAFE` (`[A-Za-z0-9._-]{1,128}`) in the one place before it can reach a PTY
  write; a failing id degrades to the bare command.
- Only `claude` is re-flagged on restore: the pane's own recorded `launchCommand` is the
  source, not the preset's current text, and the flags sit beside `--resume`.
- Session history (the dock's third tab and the board's "Resume a previous session…") lists
  Claude Code and Codex only, newest 500 per agent by default, titles read from the file
  head in batches of 8 with a `setImmediate` breath so the main process keeps serving PTYs.
  A history row refuses to resume unless the built command actually contains the session id,
  because a degraded bare command would silently open a new conversation.
