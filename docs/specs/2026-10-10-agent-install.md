# Install agents from Deck

Date: 2026-10-10
Status: Draft. The owner chose the direction on 2026-10-10 (decision 1). Two questions are still open
([Open decisions](#open-decisions)), and the plan is drafted once they are answered.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main` at `8c1d83cd` (2026-10-10), one commit ahead of `origin/main` `b9ef2e16`.
Host: Electron. Tauri is feature-frozen and keeps today's `Not installed` text
([Forks and constraints](#forks-and-constraints)).

## Purpose

A user reported that a built-in agent missing from their machine reads `Not installed` and
offers no way forward: no command and no guidance. Deck already knows which agents are missing,
because the discovery probe runs through the user's interactive login shell
([`electron/agents.ts`](../../electron/agents.ts)). It has nothing to offer about installing
them. Today:

- The launch page's `Show in quick launch` editor greys the row out, disables the checkbox and
  shows `Not installed`
  ([`quick-agent-choices.ts`](../../src/settings/quick-agent-choices.ts),
  [`quick-agent-editor.tsx`](../../src/launcher/quick-agent-editor.tsx)).
- Settings → Quick agents shows the same text as the row's description
  ([`quick-agents-section.tsx`](../../src/ui/settings/quick-agents-section.tsx)).
- Settings → Agents lists the agent under `Available to install`. Its expanded details say
  `Install <Agent>, then refresh detection.` without saying how
  ([`launch-profile-editor.tsx`](../../src/ui/settings/launch-profile-editor.tsx)).
- An agent's definition carries a `url` and nothing about installing it
  ([`agent-definition.ts`](../../src/lib/agents/agent-definition.ts)). The ↗ control that
  opened that `url` was removed on the owner's ask on 2026-08-19.
- After an install in another terminal, Deck can take up to 30 s to notice
  (`REVALIDATE_AFTER_MS` in
  [`agent-detection-store.ts`](../../src/terminal/agent-detection-store.ts)). Settings →
  Agents' **Refresh** does not force a probe: within that window it returns the cached answer.

## Decisions (owner, 2026-10-10)

1. **Install runs in a Deck terminal pane (option C).** Pressing `Install` opens a pane, types
   the vendor's official install command into the user's own shell and runs it there. The user
   sees the whole command and its output and answers the installer's prompts. Deck then
   notices the new CLI without a restart. Turned down:
   - **A. Open the vendor page.** Cheapest, but it reverses the 2026-08-19 removal of the ↗
     control and leaves the user to find the command.
   - **B. Show the command with a Copy button.** No risk, but the user needs another terminal,
     and Deck cannot tell when the install finished.
   - **D. Silent background install from the main process.** It would hide `curl | sh`, sudo
     prompts and npm `EACCES` failures from the user, which goes against the repo's rule that
     commands are spelled out on screen. It would also need a new Electron-only host command.
   - **E. Deck downloads and manages agent binaries itself.** That makes Deck a package manager,
     with versions, updates and licensing to own.
2. **This change gets a spec**, because it changes what the app does for every user without
   a given agent.

## Requirements and acceptance criteria

### Install data

- **INST-D1**: Each built-in agent may declare an install command for macOS and one for
  Windows, in its own file next to `url`. Each command is read off the vendor's official install
  documentation, and the file records the source URL and the date it was read. This is the same
  rule the file header already applies to launch flags, because the command is typed verbatim
  into a live shell. An unverified command is `null`, never a guess.
- **INST-D2**: Commands ship in the app bundle. They are never fetched at runtime or read from
  settings. Custom agents never get a command, because Deck does not know where they come from.
- **INST-D3**: Windows commands are written for the shell a Deck pane runs on Windows
  (PowerShell, [`electron/platform/windows.ts`](../../electron/platform/windows.ts)), not
  copied from the macOS form.

### Where Install appears

- **INST-S1**: An `Install` button replaces the `Not installed` text when a built-in agent is
  enabled, was not found by the probe, and has a command for the current platform. It appears
  on three surfaces:
  - the launch page's `Show in quick launch` editor;
  - Settings → Quick agents;
  - Settings → Agents, on the `Available to install` row itself, not only inside its collapsed
    details.
- **INST-S2**: The button sits outside the checkbox's `<label>`, so pressing it never toggles
  the checkbox. The checkbox stays disabled until the probe finds the agent, as it does today.
- **INST-S3**: The button's tooltip is the exact command, as plain tooltip text. The button
  label stays one word.
- **INST-S4**: Settings → Agents' `Install <Agent>, then refresh detection.` line goes wherever
  the button is present. Where the button is absent (INST-F1), its replacement is decided by
  Q1.
- **INST-S5**: The button appears only where the host can open the install pane, behind an
  `available` flag. Tauri and the browser preview keep today's `Not installed` text.

### Running the install

- **INST-R1**: `Install` opens one terminal pane in a new space of the active workspace, named
  `Install <Agent>`, and focuses it. Once the shell's prompt is up, Deck types the command and
  presses Enter. The prompt-readiness gate is the same one an agent launch uses. For when no
  workspace is open, see Q2.
- **INST-R2**: Deck adds nothing to the command: no `sudo`, flags or environment. The user
  answers the installer's prompts in the pane, such as a password, a confirmation or a vendor
  sign-in.
- **INST-R3**: While a pane opened by `Install` for an agent is still open, pressing `Install`
  for that agent focuses the existing pane instead of opening a second one.
- **INST-R4**: A failure before the pane exists shows its message next to the button. Deck
  reports nothing about how the installer exits. The user reads that in the pane, and the row
  stays `Install` until the probe finds the agent.

### An install pane is not an agent pane

- **INST-N1**: Pressing `Install` does not count as an agent launch (`countAgentLaunch`) and
  adds no telemetry key.
- **INST-N2**: The install command is not recorded as the pane's `launchCommand`, so the session
  journal never holds it. Reopening the last session restores that pane as a plain shell at
  most, and never types the installer again.
- **INST-N3**: The press does not mark the pane as the agent. A vendor installer that runs the
  agent's own binary while it works, such as an installer finishing with `<agent> install`, may
  briefly be classified by the existing process poller. That is accepted.

### Noticing the new CLI

- **INST-P1**: While an install started from Deck is pending, Deck forces a fresh probe that
  bypasses the 30 s window in two cases: when the window regains focus, and when any agent list
  is shown (the three surfaces in INST-S1 and the launch cards). The forced probe uses the boot
  probe's full name list (`probeNames(customAgents)`), not the built-ins alone. Acceptance: once
  the installer has finished and the user returns to Deck or opens any agent list, the row shows
  as installed and its checkbox is enabled, with no restart and no **Refresh**. The pending state
  ends when the agent is found or the window closes.
- **INST-P2**: Settings → Agents' **Refresh** forces a probe with the same full name list,
  instead of returning a cached answer younger than 30 s.

### Agents without a command

- **INST-F1**: A missing built-in with no verified command for this platform shows the fallback
  chosen in Q1.

## Open decisions

- **Q1. Fallback for an agent with no verified command.**
  - (a) Keep today's `Not installed` text.
  - (b) A `Get` link that opens the agent's `url` in the default browser, only while the agent
    is missing.

  Recommended: (b). It gives the user a way forward on every row. It brings the agent's link
  back only in the missing state, which partly reverses the 2026-08-19 removal of ↗, a removal
  that also covered installed agents.
- **Q2. Where the pane opens when no workspace is open.**
  - (a) `Install` is disabled, with the tooltip `Open a folder first`.
  - (b) Open the pane in the home folder.

  Recommended: (a). Option (b) either adds the home folder to the rail as a project, or needs a
  launch target that exists without a workspace. Launch-actions EMPTY1 already names that target
  as an R4 change.

## Forks and constraints

- **Tab materialization (an AGENTS.md fork, and R4).** `launchAgentAtTarget` builds its own
  command from `pageAgentCommand(agentId)`, records it in `launchCommandByPane` (the journal
  reads that map) and calls `countAgentLaunch`
  ([`tab-manager.ts`](../../src/terminal/tab-manager.ts)). Running a different command needs a
  command override that skips the recording and the count (INST-N1, INST-N2).
  [Launch actions](2026-10-08-launch-actions.md) PAGE4 (package C, not started) plans a
  command-override parameter on the same function. There is one shared parameter: whichever
  package lands first adds it, and the other reuses it. The plan carries the cross-boundary
  verification and needs the owner's approval before any code.
- **No PTY watch after spawn.** Launch-actions decision 7 classes reading an exit code as a
  fork, so Deck does not detect when the installer finishes. Detection is by re-probe
  (INST-P1).
- **DL-4.1.** The command shows as a plain tooltip. A styled monospace preview would need the
  same DL-4.1 exception launch-actions P1 took.
- **Tauri** keeps today's text (INST-S5). The launch page is already unavailable there
  (`agentLaunchPageAvailable` in
  [`agent-launch-page-store.ts`](../../src/launcher/agent-launch-page-store.ts)).
- **Windows** commands run in PowerShell. Windows is not runtime-verified (see the
  [platform limits](../operations/release.md#platform-limits)).
- **Not touched:** PTY ownership, process classification, close and quit coordination, the
  updater, and bundle or dependency configuration.

## Verification

- Unit tests sit beside each changed file and cover these points:
  - the button shows only for a missing built-in with a command for the current platform;
  - the label stays separate from the checkbox;
  - the Tauri gate hides the button;
  - an install press records no `launchCommand` and counts no launch;
  - a forced probe uses the full name list.
- Lint, plus the `scripts/` and `src/styles/` policy suites the pre-push hook runs.
- **E2E gate.** This changes a UI flow, so an agent drives it in the running Electron app with
  `playwright-core` and scratch userData, as AGENTS.md describes. Through a test seam, the E2E
  run replaces every install command with a harmless one. It must never run a real vendor
  installer, because scratch userData does not isolate global npm, `~/.local/bin` or the
  owner's rc files. The run proves four things:
  - the pane opens, named and focused;
  - the command is typed and runs;
  - the journal does not hold it;
  - returning focus triggers a probe.

  To show a row turning installed, the probe needs a stub binary it can see. The plan picks a
  seam that edits neither the owner's real PATH nor their rc files.
- Every command is checked against its vendor documentation, with the URL and date in the agent
  file. Running each real installer is a manual check, done only when the owner asks.
- Living docs: `docs/user/agents.md` (Settings → Agents and Quick agents) and the help copy in
  INST-S4 change with the code. `CHANGELOG.md` is written at merge time.

## Evidence

- The inventory in [Purpose](#purpose) comes from a read-only pass over `main` at the
  baseline. The files are the ones linked there, plus
  [`agent-launch-cards.tsx`](../../src/launcher/agent-launch-cards.tsx), where the launch cards
  list only found built-ins and mark missing custom agents.
- The journal reads `launchCommandFor` in `captureSession`
  ([`tab-manager.ts`](../../src/terminal/tab-manager.ts)). Restore picks the resume command
  from the classified `agent`
  ([session restore](../internals/session-restore.md)). That is why INST-N2 keeps the install
  command out of the map rather than relying on restore to ignore it.
- The user's report: a screenshot of the `Show in quick launch` editor on 2026-10-10 that showed
  Amp, Kimi Code, Grok Build and Mistral Vibe as `Not installed`.

## Out of scope

- updating or uninstalling an agent;
- installing a custom agent;
- checking prerequisites such as Node, `uv` or Homebrew beyond what the vendor installer itself
  reports;
- pinning a newly installed agent to quick launch automatically;
- a telemetry event for install presses, which would change the
  [telemetry contract](../internals/telemetry.md);
- vendor sign-in after install, which the agent's own first run handles.
