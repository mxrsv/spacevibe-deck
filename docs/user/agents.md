# Agents

An agent is a command-line AI tool that Deck runs inside a terminal pane. Deck does not
replace the tool's own workflow: it starts the command in a real shell, watches the pane,
and reads the tool's own session logs where it knows their format.

## Built-in agents

Deck recognises six agents out of the box. Each ships with a launch command, and the command
is shown on screen in Settings → Agents rather than hidden behind a label.

| Agent       | Launch command                                     |
| ----------- | -------------------------------------------------- |
| Claude Code | `claude --dangerously-skip-permissions`            |
| Codex       | `codex --dangerously-bypass-approvals-and-sandbox` |
| OpenCode    | `opencode`                                         |
| Antigravity | `agy --dangerously-skip-permissions`               |
| Gemini CLI  | `gemini --yolo`                                    |
| Cursor      | `cursor-agent --force`                             |

Several of these skip the tool's own confirmation prompts. That is the point of Deck, which
exists to run agents that keep working, and it is also why every command is spelled out and
why each one can be disabled. OpenCode ships bare because its `--auto` mode is opt-in per
session.

This order is also the digit-key order in the quick picker.

## Settings → Agents

The catalog splits on what Deck found on your login shell's `PATH`:

- **Installed** — agents whose binary was found, with the path. **Refresh** re-runs the probe.
- **Available to install** — the rest, each with a link to the tool's page.

Per row:

- **Enable / Disable.** The switch is the only thing that takes a built-in out of the pickers;
  a built-in cannot be deleted because the next probe would find it again.
- **Default.** Offered on installed rows only. The starred agent is what a recent workspace
  opens with when it has no remembered agent of its own.
- **Add command.** Type a full command line, for example `claude --plan`. It replaces the
  shipped command for that agent; nothing merges. The agent is derived from the command's
  first word.

A command is typed verbatim into a live interactive shell, so it may use only letters, digits,
spaces and `. , : @ + = _ - /`. Pipes, `&&`, `;`, quotes, redirects, variables and newlines
are refused with a message saying why. A pipeline belongs in a wrapper script declared as a
custom agent.

## Custom agents

Under **Declared**, add any CLI with a name and the command to type into each pane. Click
the name or the command to edit either; ✕ removes it. A declared agent stays listed when its
binary is missing from `PATH` so that an uninstalled tool reads as missing rather than as
lost data.

Custom agents show a name and a state in the rail but no "latest words": Deck reads session
logs only for the built-ins it knows.

## What Deck knows about each agent

| Agent       | Latest words in the rail | Resume on relaunch                         |
| ----------- | ------------------------ | ------------------------------------------ |
| Claude Code | yes                      | exact session id                           |
| Codex       | yes                      | exact session id                           |
| OpenCode    | yes                      | exact session id                           |
| Gemini CLI  | no                       | `--resume latest`                          |
| Antigravity | no                       | best-effort session id, else `--continue`  |
| Cursor      | no                       | relaunches the command bare                |
| Custom      | no                       | relaunches the declared command unchanged  |

Working, asked and failed states come from the terminal itself (bell, notification and
progress sequences the tool emits, plus sustained output) and work for any agent.

## Token usage

The Token usage tab (**⌘⇧U**) reads the local session logs of Claude Code and Codex, including
Claude Code's sub-agent logs, and groups tokens and estimated cost by agent and day. Ranges
are local calendar days: Today, 7 days, 30 days, All. Costs use a pricing snapshot that ships
with Deck.
