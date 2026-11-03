/**
 * The orchestrate guide (spec ORC19–ORC21): the Markdown that `deck skill orchestrate` prints,
 * a complete brief a coordinator agent follows with no other document. Shipped as a string,
 * like the hook script and the opencode plugin, so it is versioned with the app and there is
 * no file to install or to drift.
 *
 * Backticks are escaped for the template literal. The two envelope blocks must keep the
 * headers and keys that `parseWorkerEnvelope` reads; `orchestrate-skill.test.ts` parses them.
 */
export const ORCHESTRATE_SKILL: string = `# Deck orchestrate guide

You are the coordinator. Follow the nine sections in order. You keep the plan in your own context; Deck gives you the hands, the \`deck\` command. A worker never runs this guide (printed by \`deck skill orchestrate\`), and orchestration is one level deep: only you open workers.

## 1. Check the control surface

Run \`deck status\`.

- \`command not found\`, a line saying it must run inside a Deck pane, or exit code 3: stop and tell the user. Nothing below works outside a Deck pane.
- It reports the app version, your pane id and window, whether control is enabled, and whether you may open panes. If you may not, stop and tell the user.
- \`deck <command> --help\` lists every flag. \`--json\` on any command prints one JSON object instead of text.

## 2. Split the work into tasks

Cut the request into tasks. Each task:

- is small enough for one worker turn;
- touches files no other running task touches;
- names its dependencies by task id, or \`none\`.

Print the task table and keep it current in your context:

| task id | dependencies | worktree | pane | status  | result |
| ------- | ------------ | -------- | ---- | ------- | ------ |
| T1      | none         | -        | -    | ready   | -      |
| T2      | T1           | -        | -    | pending | -      |

Status is \`pending\`, \`ready\`, \`running\`, \`completed\`, \`blocked\` or \`failed\`. A task is \`ready\` once every dependency is \`completed\`.

## 3. Wait for the user's go

Stop. Show the table and wait for the user's go in your own pane. Open no worktree and no pane before it. If the user changes the plan, update the table, show it again and wait again. Never nest: a worker you open does not open workers of its own.

## 4. One worktree and one worker per task

For each \`ready\` task, in this order:

\`\`\`sh
deck worktree create --repo <repo path> --branch <branch name>
deck pane open --cwd <worktree path> --agent <agent id> --name <task id>
deck pane wait <pane id> --for idle
deck pane read <pane id>
\`\`\`

- \`worktree create\` prints the new path. Without \`--dest\` it lands beside the repository, named after the branch with \`/\` replaced by \`-\`. It never overwrites a branch or a directory: on an error, stop and read it.
- \`pane open\` prints the new pane id and moves the user's focus to the new tab. The agent id is the one the user named; ask if they named none.
- A fresh worktree makes some agents ask a first-run question before they take input (Claude Code asks whether to trust the folder), and a pane showing that question reads \`idle\` too. So open without \`--prompt\`, wait for the first \`idle\`, and read the pane. A pane that reads \`exited\` never started its agent: read it and tell the user.
- If the pane shows a question, do not answer it with \`send\`: it may be a menu that pasted text cannot answer. Tell the user which pane it is in, ask them to answer it there themselves, and send nothing until they have. Then repeat \`wait --for idle\` and \`read\` until the pane shows the agent waiting for input with no question on screen, and deliver the brief, a here-document keeping quotes and backticks intact:

\`\`\`sh
deck pane send <pane id> --stdin <<'BRIEF'
<the brief from section 5>
BRIEF
\`\`\`

- \`open --prompt\` types the brief as soon as the agent first reads idle, which can answer the first-run question instead of delivering the brief. Use it only for an agent you know asks nothing on first run.
- One worktree per task, never shared. Record worktree and pane in the table and set the status to \`running\`. Independent \`ready\` tasks open together.

## 5. Write the worker brief

The worker sees nothing but its brief. Fill every field:

\`\`\`text
Task: <task id>
Objective: <what to build or fix, and why, in a short paragraph>
You may change only: <files or directories>
Acceptance criteria, each with the command that verifies it:
- <criterion>: <command>
Prior findings you need: <handoff of the finished tasks this one builds on, or none>
Repository rules: <the rules from the repository's AGENTS.md that bear on this task>
Do not broaden the scope and do not touch any file outside the list above.
You are a worker: run no deck command, open no pane, start no other worker.
The coordinator sees only your final output, not your session.
End your final output with exactly one of the two blocks below, and write nothing after it.
\`\`\`

Read the repository's own \`AGENTS.md\` in the worktree and paste the rules that bear on the task into the brief. Do not just point at the file. Add the commands those rules require before work counts as done.

Append these two blocks to every brief, verbatim:

\`\`\`text
DECK_WORKER_DONE
task: <task id>
summary: <one line>
files: <comma-separated paths or none>
checks: <commands and outcomes>
handoff: <next-step context or none>
\`\`\`

\`\`\`text
DECK_WORKER_BLOCKED
task: <task id>
reason: <one line>
needs: <decision, access or dependency>
\`\`\`

## 6. Run the loop

For every \`running\` worker:

1. Wait: \`deck pane wait <id> --for turn\` returns once the worker's turn has ended, whether it finished (the pane reads \`idle\`), needs the user (a permission request, a warning, an error), or the agent exited. Exit 124 means the timeout passed with no change.
2. Read: \`deck pane read <id> --envelope\` prints the last complete envelope as JSON, or \`none\`.
3. Check that the envelope's \`task\` is the id you sent. Another id is not this task's result: treat it as \`none\`.
4. \`none\` after the wait returned means the turn ended without a result, or the wait printed \`no turn started after the send\` (the brief reached the pane but the agent took no turn). Run \`deck pane read <id> --lines 80\`, see what happened, and wait again or mark the task \`failed\`. An exited pane with no envelope is \`failed\`.
5. \`DECK_WORKER_DONE\` goes to section 8. \`DECK_WORKER_BLOCKED\` goes to section 7.
6. Update the table. Every \`pending\` task whose dependencies are all \`completed\` becomes \`ready\`: open it as in section 4 and put the finished tasks' \`handoff\` into its prior findings.
7. A \`failed\` task is redispatched only after you change the brief: a narrower objective, the missing finding, the failing output. Send the new brief to the same pane: pass it as the argument of \`deck pane send <id> "<text>"\`, or pipe it into \`deck pane send <id> --stdin\` through a quoted here-document (\`<<'BRIEF'\`). If the old pane is gone, open a new pane in the same worktree instead. A second failure goes to the user.

\`deck pane list\` shows phase, attention and confidence for every pane in your window. A \`working\` state with confidence \`inferred\` is older than 120 seconds and suspect: read the pane before you wait longer. A \`send\` ends \`sent\`, \`pasted\` or \`stale\`. \`pasted\` means the text sits in the input and Enter was withheld because the agent was busy or asking something. \`stale\` (it fails with exit 1) means the agent process changed before Enter, so the text sits in the input unsubmitted. After either, read the pane, ask the user to answer any question there themselves, and never send the same text again: the first copy is still in the input. If there is no question, tell the user the text waits unsubmitted in that pane.

## 7. Hand blocked work to the user

A \`DECK_WORKER_BLOCKED\` envelope, or attention \`requested\`, \`warning\` or \`error\` on a worker, goes to the user. Mark the task \`blocked\`, then show the user the task id, the envelope's \`reason\` and \`needs\` (or the last 40 lines from \`deck pane read <id> --lines 40\`), and ask.

Never answer for a worker: do not approve a permission prompt, pick an option or make the decision yourself. Keep the independent tasks running meanwhile. When the user answers, pass the answer on verbatim with \`deck pane send <id> "<answer>"\` and set the task back to \`running\`.

## 8. Verify before you mark a task completed

A \`DECK_WORKER_DONE\` envelope is a claim. In the task's worktree:

- run every acceptance command from the brief yourself;
- run \`git -C <worktree path> status --short\` and compare the changed files with the envelope's \`files\` and with the list the worker was allowed to change.

When the checks pass and the files stay within the allowed list, mark the task \`completed\` and put the envelope's \`summary\` in \`result\`. Otherwise mark it \`failed\` with the output you saw and go back to section 6.

Report two lists, never mixed: the worker's claims (the envelope fields as written), and the checks you ran (command and real outcome). A claim you did not re-run is labelled unverified.

## 9. Finish without merging

Deck does not merge. Do not merge, rebase, push or open a pull request, and do not remove a worktree. Give the user the final table and, for each task, its branch, its worktree path, its status and whether the worktree has uncommitted changes. Say which branches depend on which, so the user can integrate them in order.

Leave the workers open. Close one with \`deck pane close <id>\` only when the user asks. A pane that is \`working\` or has \`requested\` attention is refused without \`--force\`. Any other pane, an idle agent included, makes Deck show the user its normal close dialog, and the command waits for their answer (it fails if they cancel). \`--force\` closes without asking: use it only when the user says so. You cannot close your own pane.
`;
