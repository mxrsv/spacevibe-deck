# Agents

An agent is a command-line AI tool that Deck runs inside a terminal pane. Deck does not
replace the tool's own workflow: it starts the command in a real shell, watches the pane,
and reads the tool's own session logs where it knows their format.

## Built-in agents

Deck recognises twelve agents out of the box. Each ships with a launch command, and the command
is shown on screen in Settings → Agents rather than hidden behind a label.

| Agent       | Launch command                                                              |
| ----------- | --------------------------------------------------------------------------- |
| Claude Code | `claude --dangerously-skip-permissions`                                     |
| Codex       | `codex --dangerously-bypass-approvals-and-sandbox -c tui.animations=false` |
| OpenCode    | `opencode`                                                                  |
| Antigravity | `agy --dangerously-skip-permissions`                                        |
| Gemini CLI  | `gemini --yolo`                                                             |
| GitHub Copilot | `copilot`                                                                |
| Amp         | `amp`                                                                       |
| Kimi Code   | `kimi`                                                                      |
| Kiro        | `kiro-cli`                                                                  |
| Grok Build  | `grok`                                                                      |
| Mistral Vibe | `vibe`                                                                     |
| Droid       | `droid`                                                                     |

Codex's `-c tui.animations=false` turns off its idle animations. Codex keeps repainting its
prompt while it waits, and Deck would read that as an agent still working, so the row would
show the working spinner before you have typed anything and after the reply has landed. If you
write your own Codex command, keep that flag, or set `animations = false` under `[tui]` in
`~/.codex/config.toml` to turn the animations off in every terminal.

Several of these skip the tool's own confirmation prompts. That is the point of Deck, which
exists to run agents that keep working, and it is also why every command is spelled out and
why each one can be disabled. OpenCode ships bare because its `--auto` mode is opt-in per
session. The seven agents added after Gemini CLI ship bare too: Deck has not read their flag
lists, so it offers no flag, model or effort controls for them (Droid's autonomy level and spec
mode are the exception) and relaunches them bare on resume.

Until you choose [quick agents](#quick-agents), quick launch and the checkout menu offer the
installed agents: these in this order, then your custom agents
([quick agent defaults](../../src/settings/quick-agents.ts)).

## Settings → Agents

The catalog splits on what Deck found on your login shell's `PATH`:

- **Installed** — agents whose binary was found. **Refresh** looks again straight away, including your custom agents.
- **Available to install** — the rest.

Each agent is one row showing its name and the command it launches with:

- **on / off.** Turning an agent off removes it from launch choices;
  a built-in cannot be deleted because the next probe would find it again
  ([agent choices](../../src/lib/agent-catalog.ts)).
- **Configure** (the arrow) opens the agent's settings under the row:
  - **Command** — the full launch command appears first. Edit it directly or change the
    controls under **Launch**; both edit the same command. Blur or Enter saves a valid edit;
    invalid text stays in the field with an error. The reset arrow beside a custom command
    removes that preset and falls back to the next saved command or Deck's built-in command
    ([command editor](../../src/ui/settings/agent-launch-flags.tsx)).
  - **Launch** — the switches and choices each CLI offers. Two or three choices appear side
    by side, including **CLI default**; longer lists use a menu
    ([agent choices](../../src/ui/settings/agent-choice-value.tsx)).
  - **Model** — **Default model**, **Default effort** and **Additional models** appear on
    installed agents whose CLI takes those flags
    ([model settings](../../src/ui/settings/launch-profile-editor.tsx)).
  - **Integrations → Signals** — on Claude Code, Codex and opencode: use the status the agent reports instead
    of Deck's estimate, for new sessions. It is on by default for all three. For Claude Code and Codex, Signals installs Deck hooks
    in their settings; opencode loads a small Deck plugin instead and nothing is written to its
    config. It also covers commands you type manually inside Deck. For Codex, Deck starts
    its terminal sessions without Codex's shared background service so the reports reach the
    right pane, which means those sessions do not appear in `codex agents`. For opencode, a
    `OPENCODE_CONFIG_DIR` you set yourself is not used inside Deck terminals. Turning it off
    removes this installation's hooks. Reopen terminals created before this integration was
    installed. [Signal integration](../internals/terminal.md#the-contract-layer).
- For an agent under **Available to install**, choose **Configure launch** to prepare its
  command before installation. Model controls appear after Deck detects the CLI
  ([agent settings](../../src/ui/settings/launch-profile-editor.tsx)).
- **Add command.** Save another command line for an agent. The first one saved for an agent
  also becomes its command; later ones stand behind it for the reset arrow above. The agent
  is derived from the command's first word.

A command you write is typed verbatim into a live interactive shell, so it may use only letters,
digits, spaces and `. , : @ + = _ - /`. Pipes, `&&`, `;`, quotes, redirects, variables and
newlines are refused with a message saying why. A pipeline belongs in a wrapper script declared
as a custom agent. The install commands Deck ships are the vendors' own and are exempt from
this rule.

### Installing a missing agent

A built-in agent that Deck did not find shows **Install** on its row in Settings → Quick agents
and as a dimmed tile on the launcher, after the agents you can run. Hover it to see the exact command. It opens
a terminal named `Install <Agent>` in a new space (in your home folder when no folder is open),
types the vendor's install command and runs it there, so you see every prompt and answer them
in that terminal. Pressing **Install** again while that terminal is open takes you back to it.

Deck does not watch the installer finish. It looks again when you return to the Deck window or
open an agent list, or when you press **Refresh**, and the row then moves to **Installed**
without a restart. An agent installed this way is also added to your quick agents. A terminal
that was already open keeps the `PATH` it started with, so start a newly installed agent from a
new terminal. An agent whose install command Deck has not verified shows **Get** instead, which
opens its website. Install and Get appear only for enabled built-in agents, never for custom
ones, and only in the Electron app
([install control](../../src/launcher/agent-install-control.tsx)).

## Quick agents

Quick agents are the tiles on the quick launcher and the rows in the checkout menu. Choose
them in Settings → Agents → Quick agents; the launcher has no list of its own to edit. Your
choices are saved; agents you disable or uninstall stop appearing in the menu without being
replaced by another agent
([quick agent settings](../../src/ui/settings/quick-agents-section.tsx)).

Hover or focus a tile to see the exact command it will type, the folder and where it lands.
Each tile runs its agent's default launch command; change which one that is in
[Settings → Agents](agents.md#settings--agents). If an agent cannot be started, the launcher says why and offers
**Retry**
([launcher](../../src/launcher/agent-launch-page.tsx)).

The checkout menu's **Open shell** opens a new terminal tab inside Deck at that checkout.
Use **New split here** for a pane beside the existing tab
([checkout actions](../../src/ui/worktree-card-menus.tsx)).

## Custom agents

Under **Agent identities**, add any CLI with a name and the command to type into each pane. Click
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
| Droid       | no                       | `--resume --last` for the folder           |
| Other built-ins | no                   | relaunch bare                              |
| Custom      | no                       | relaunches the declared command unchanged  |

Working, needs-you and failed states come from the terminal itself (bell, notification and
progress sequences the tool emits, plus sustained output) and work for any agent. When Deck
reads a needs-you or done state from output timing rather than from the agent, the row's
tooltip says **(inferred)**. With **Signals** on, which is the default,
the state is the agent's own report for new sessions, and a needs-you state can say
what it waits on, such as a permission prompt. An agent whose process has left its pane reads
as **ended** ([rail states](../../src/ui/worktree-card-row.tsx)).

## Token usage

The Token usage tab (**⌘⇧U**) reads the local session logs of Claude Code and Codex, including
Claude Code's sub-agent logs, and groups tokens and estimated cost by agent and day. Ranges
are local calendar days: Today, 7 days, 30 days, All. Costs use a pricing snapshot that ships
with Deck.

**Details** at the top of the tab opens a larger Usage page over the main area, with the rail
still in view (**⌘⇧R**, or View → Usage Details). **Back** or Escape returns you to where you
were; choosing a tab or an agent in the rail closes it and goes there.
