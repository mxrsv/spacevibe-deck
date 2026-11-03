# Orchestration

Orchestration lets one agent in a Deck pane run several others. That agent, the coordinator,
splits a job into tasks, opens a worker for each task in its own worktree, waits for the workers
to finish and checks what they report. You approve the plan before anything starts, and you do
the merging.

The `deck` command that drives this is not in release builds yet.

## The deck command

`deck` is a command that exists only inside the terminal panes Deck opens. Agents use it to open
and steer other panes, and you can type it yourself. It works in zsh, bash and fish on macOS. An
ordinary terminal and Windows have no `deck` command. Inside a pane it can still lose track of
the pane: a Codex background-service subcommand and opencode with Signals off start without the
pane's identity. There `deck` prints one line saying so and exits with code 3.

Deck puts its own folder first on `PATH` in its panes, so a program of yours named `deck` is
hidden there.

`deck --help` lists every command and `deck <command> --help` describes one. Output is a few
lines of text. Add `--json` to any command for one JSON object instead.

## Running several agents

In a pane running an agent, ask it to run `deck skill orchestrate`, follow the guide it prints,
and then describe the job. The guide is built into Deck, so it always matches your version. The
agent splits the job into tasks, prints them in a table with their dependencies, and stops. Nothing
opens until you say go, and you can change the plan first. After your go, it creates a worktree and
a branch for each task and opens a worker there, as a new tab running the agent you named. Each
worker shows in the rail like any other agent, and Deck moves focus to each new tab as it opens.
The coordinator waits for a worker's turn to end, reads the result, runs the checks itself and
starts the tasks that were waiting on it. A worker that is blocked, or that asks a question, goes
to you: the guide has the coordinator pass it on instead of answering. At the end it lists the
branches and worktrees, and you merge them.

The guide keeps orchestration one level deep: it tells workers not to open workers of their own.

## Commands

| Command | What it does | Notes |
| --- | --- | --- |
| `deck status` | Shows the Deck version, this pane, its window, and whether it can open panes. | |
| `deck worktree create --repo <path> --branch <name>` | Creates a git worktree on a new branch and prints its path. | `--dest <path>` picks the folder. Without it the folder is named after the branch, `/` turned into `-`, beside the repository. It never overwrites a branch or a folder. |
| `deck pane list` | Lists the panes in this window with agent, phase, attention and confidence. | Panes this pane opened are marked. A `working` pane with confidence `inferred` has not reported for two minutes: read it before waiting longer. |
| `deck pane open --cwd <path> --agent <id>` | Opens a new tab with an agent in that folder and prints the new pane id. | `--agent` is the first word of the agent's launch command in [Built-in agents](agents.md#built-in-agents), such as `claude`, `codex` or `opencode`; the agent must be installed and turned on. `--name <label>` names the tab. Focus moves to the new tab. `--prompt <text>` also sends a first message: see [First-run questions](#first-run-questions). |
| `deck pane send <id> <text>` | Types text into a pane and presses Enter once its agent is idle. | `--stdin` reads the text from standard input. `--no-submit` types without Enter. Put `--` before text that starts with a dash. |
| `deck pane read <id>` | Prints the end of a pane's scrollback as plain text. | `--lines <n>` sets how many: 200 by default, at most 2000. `--envelope` prints the last complete [envelope](#envelopes) as JSON, or `none`. |
| `deck pane wait <id> --for <state>` | Waits until the pane reaches a state, then prints it. | `idle`, `needs-you`, `exited` or `turn`: see [Waiting](#waiting). `--timeout <s>` is 600 by default, at most 3600. |
| `deck pane close <id>` | Closes a pane this pane opened. | `--force` closes without asking: see [Closing](#closing). |
| `deck skill orchestrate` | Prints the orchestration guide for a coordinator. | |

A pane can `send` to and `close` only the panes it opened. It can `read` and `wait` on itself too,
and `pane list` shows every pane in the window. Any other pane answers as if it did not exist.
Exit codes: 0 done, 1 refused or failed, 2 usage error, 3 outside a Deck pane, 124 timed out.

### Waiting

- **`idle`** — the agent finished its turn and nothing needs you, or it left the pane.
- **`needs-you`** — the agent asked a question or raised a warning or an error, or it left the pane.
- **`exited`** — the agent left the pane.
- **`turn`** — any of the three: the turn ended, one way or another.

After a `send`, an `idle` or `turn` wait ignores the idle that came before it and resolves once the
agent is working on a turn. If no turn starts within five seconds of the send, `wait` says `no turn
started after the send` and exits 0. The five seconds count from the send, even when `wait` is
called later, and only the agent working counts as a turn: focusing the pane or clearing its
attention does not. A send changes nothing for `needs-you` and `exited`. A timeout exits 124.

### Sending

`send` ends in one of four ways:

- **`sent`** — the text was typed and Enter was pressed.
- **`pasted`** — the text is in the pane but Enter was withheld, because the agent was busy or was
  asking something.
- **`stale`** — the agent process changed before the text could be typed or submitted, so nothing
  was submitted and nothing may have been typed. This one exits 1.
- **`expired`** — the send waited behind another send until its deadline passed, so it was dropped.
  Nothing was typed. This one exits 1.

After `pasted` or `stale`, read the pane before doing anything else. If the text is in the input,
do not send it again: the first copy is still there. Control characters and escape sequences in the
text are removed. Sends to one pane happen one at a time.

### Closing

A pane that is working, or waiting for you, is refused without `--force`. Any other pane, an idle
agent included, shows you the normal close dialog and the command waits for your answer. If you
cancel, the command fails and the pane stays. `--force` closes without asking. A pane cannot close
itself.

## Envelopes

A worker ends its final output with exactly one of these blocks. The coordinator reads the last
complete one with `deck pane read <id> --envelope`.

```text
DECK_WORKER_DONE
task: <task id>
summary: <one line>
files: <comma-separated paths or none>
checks: <commands and outcomes>
handoff: <next-step context or none>
```

```text
DECK_WORKER_BLOCKED
task: <task id>
reason: <one line>
needs: <decision, access or dependency>
```

A block with a missing field reads as `none`, and the brief's template echoed on screen is ignored.
A `DONE` block is the worker's claim, not proof: the guide has the coordinator rerun the checks and report
the worker's claims and its own results separately.

## First-run questions

The first time an agent opens in a new folder, it may ask a question before it takes any input.
Claude Code asks whether to trust the folder. While that question is on screen the agent reads as
idle. `deck pane open --prompt` sends its message as soon as the agent first reads idle, so in a
fresh worktree the message can answer the question instead of delivering the brief. It prints two
lines, the pane id and `prompt:` followed by what happened (`sent`, `pasted`, `not-idle` or a
refusal), and exits 0 either way.

The safe order, and the one the guide follows:

1. `deck pane open` without `--prompt`.
2. `deck pane wait <id> --for idle`.
3. `deck pane read <id>`. If it shows a question, the coordinator asks you to answer it yourself
   in that worker's pane, then waits and reads again.
4. `deck pane send <id> --stdin` with the brief.

Use `--prompt` only for an agent you know asks nothing on first run.

## What Deck does not do

- **Merge.** Deck has no command that merges, pushes or opens a pull request, and the guide tells
  the coordinator not to merge, rebase, push, open a pull request or remove a worktree. The only
  git command Deck runs for orchestration is `git worktree add`.
- **Coordinate by itself.** The coordinator is an ordinary agent following the guide. Deck has no
  scheduler of its own.
- **Enforce the guide.** Waiting for your go, one level of depth and passing a worker's questions
  to you are in the guide the coordinator follows. Deck does not check them, and a coordinator can
  type into any worker it opened.
- **Adopt your panes.** A coordinator controls only the panes it opened itself, never one you
  started.
- **Run outside a Deck pane**, or on Windows.
