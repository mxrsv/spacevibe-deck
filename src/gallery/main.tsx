// MUST stay the first import: this module installs both host hooks as a side
// effect, and ES imports evaluate in order, so anything below it already sees
// them. See the comment at the foot of `host-stub.ts`.
import "./host-stub";
import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "../styles.css";
import "./gallery.css";
import "./chatgpt-direction.css";
import "./agent-status-rail.css";
import "./agent-rail-variants.css";
import "./rail-structure-variants.css";
import "./rail-worktree-cards.css";
import "./sections/settings-direction.css";
import "./sections/launch-profiles-section.css";
import "./sections/new-task-launcher-section.css";
import { initializeDesktopEnvironmentFromBackend } from "../lib/platform";
import { configureSettingsSync, settingsLoadState } from "../settings/settings-store";
import { createMemorySettingsSync } from "../settings/settings-sync";
import { LOAD_READY } from "../lib/load-state";
import { activeTabIndex, statusInfo, tabViews } from "../terminal/tabs-store";
import { activateTerminalSurface, openFileTab } from "../files/file-surface-store";
import { nextOpenSequence } from "../lib/open-sequence";
import { presetsData } from "../presets/presets-store";
import { sessionArchive } from "../terminal/session-journal";
import { paneSessionIds, paneTails } from "../terminal/session-tail-store";
import {
  SEED_PANE_TAILS,
  SEED_PRESETS,
  SEED_SESSION_ARCHIVE,
  SEED_STATUS,
  SEED_TABS,
  SEED_WORKSPACE_HISTORY,
} from "./seed-data";
import { Gallery } from "./gallery";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import {
  recentDeadProjects,
  recentSessionEntries,
  recentSessionsLoading,
  recentSessionsLoadState,
  sessionsSupported,
} from "../sessions/sessions-store";

/**
 * Gallery entry. It deliberately does NOT run the app's boot sequence:
 * `initSettings` and `initWorkspaces` exist to read the user's real store
 * files, and a design harness has no business touching those. Signals are
 * seeded in memory instead — same signals the app renders from, different
 * source.
 */
function main(): void {
  // A stubbed environment rather than the IPC command, because the seam is
  // already injectable and using it keeps one fewer thing behind the stub.
  void initializeDesktopEnvironmentFromBackend(async () => ({
    platform: "macos",
    homeDir: SEED_STATUS.home,
  }));

  // In-memory sync so a settings change in a specimen stays local. Without it
  // `updateSettings` would try to broadcast a patch through Rust.
  configureSettingsSync(createMemorySettingsSync());
  settingsLoadState.value = LOAD_READY;

  // The strip is one row of mixed chips in open order since 2026-08-16
  // (DL-18.6), so the gallery seeds it that way: a document opened before the
  // terminal tabs and one opened after them, which is the only arrangement
  // that shows the interleave rather than implying the retired segments.
  const seedWorkspace = `${SEED_STATUS.home}/spacevibe-deck`;
  openFileTab(seedWorkspace, `${seedWorkspace}/README.md`, { keep: true });
  tabViews.value = SEED_TABS.map((tab) => ({
    ...tab,
    openedAt: nextOpenSequence(),
  }));
  openFileTab(seedWorkspace, `${seedWorkspace}/src/styles.css`, {
    keep: false,
  });
  // `openFileTab` hands the stage to the file it opened; the gallery's resting
  // state is a terminal tab holding it — the strip still lists both files, and
  // the agent rail can show its selection wash, which a covering file surface
  // rightly suppresses.
  activateTerminalSurface();
  activeTabIndex.value = 0;
  statusInfo.value = SEED_STATUS;
  presetsData.value = { version: 1, presets: SEED_PRESETS };
  sessionArchive.value = SEED_SESSION_ARCHIVE;
  // The rail reads `session_tail` in the app; in a browser there is no session
  // log to read, so the store is seeded directly — without it every rail
  // specimen shows the never-spoken fallback and none of DL-27.15.
  paneTails.value = SEED_PANE_TAILS;
  const seededAt = Date.now();
  const missingRecentDirectory = `${SEED_STATUS.home}/retired/missing-workspace`;
  recentSessionEntries.value = [
    {
      agent: "claude",
      sessionId: "gallery-claude-launcher",
      cwd: seedWorkspace,
      lastActivityMs: seededAt - 4 * 60_000,
      title: "Task launcher follow-up",
      sourcePath: "/gallery/claude/launcher.jsonl",
      summary: "Aligned the launcher draft across both entry points.",
    },
    {
      agent: "codex",
      sessionId: "gallery-codex-release",
      cwd: `${SEED_STATUS.home}/spacevibe-academy`,
      lastActivityMs: seededAt - 37 * 60_000,
      title: "Release checks",
      sourcePath: "/gallery/codex/release.jsonl",
      summary:
        "Verified the updater manifest and traced the remaining platform-specific release gate.",
    },
    {
      agent: "claude",
      sessionId: "gallery-claude-rail",
      cwd: `${SEED_STATUS.home}/spacevibe-deck-worktrees/redesign-phase-1-2`,
      lastActivityMs: seededAt - 3 * 60 * 60_000,
      title: "Rail density",
      sourcePath: "/gallery/claude/rail.jsonl",
      summary: "Reduced the rail hierarchy to the useful context.",
    },
    {
      agent: "codex",
      sessionId: "gallery-codex-telemetry",
      cwd: `${SEED_STATUS.home}/spacevibe-api`,
      lastActivityMs: seededAt - 26 * 60 * 60_000,
      title: "Analytics worker",
      sourcePath: "/gallery/codex/telemetry.jsonl",
      summary: "The privacy-safe ingestion path is ready for review.",
    },
    {
      agent: "claude",
      sessionId: "gallery-claude-missing",
      cwd: missingRecentDirectory,
      lastActivityMs: seededAt - 5 * 24 * 60 * 60_000,
      title: "Retired prototype",
      sourcePath: "/gallery/claude/missing.jsonl",
      summary: "Recorded the prototype decision before the folder was removed.",
    },
  ];
  recentDeadProjects.value = new Set([missingRecentDirectory]);
  // Recent activity's status mark reads the pane→session pairings the tail
  // store confirms in the app (DL-33.2, amended 2026-08-26). There is no
  // session log in a browser, so the pairings are seeded here the same way
  // `paneTails` above is — three of the five listed sessions are running in a
  // seeded pane (working, needs-you, failed) and two are held by no pane, which
  // is the quiet dot. Pane 108 runs a different agent than its row's glyph on
  // purpose: the mark reports the PANE's state, the glyph the session's agent.
  paneSessionIds.value = new Map([
    [101, "gallery-claude-launcher"],
    [107, "gallery-codex-release"],
    [108, "gallery-claude-rail"],
  ]);
  recentSessionsLoading.value = false;
  recentSessionsLoadState.value = LOAD_READY;
  sessionsSupported.value = true;
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: SEED_WORKSPACE_HISTORY.map((path, index) => ({
      path,
      lastOpenedAt: seededAt - index,
    })),
  };

  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("#root element not found");
  }
  render(<Gallery />, root);
}

main();
