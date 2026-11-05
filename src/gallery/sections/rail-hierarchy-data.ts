import type { RailStatus } from "../../ui/rail-view-model";

/**
 * Worst-case data for the rail hierarchy mock (ledger RH-18): 9 workspaces, 34 agents, every
 * status present, one workspace with six live agents, a folded one holding all four attention
 * kinds, a long name, a one-word name, a long Vietnamese title, a long branch, an empty one.
 * `src/gallery` only: nothing here ships.
 */

export interface MockAgent {
  readonly title: string;
  readonly branch: string;
  readonly status: RailStatus;
  /** What the age column reads; the real rail formats `changedAt`, the mock keeps it literal. */
  readonly age: string;
  /** Mark the row as the focused pane. */
  readonly focused?: boolean;
}

export type MockLogo = "folder" | "dark" | "violet";

export interface MockWorkspace {
  readonly key: string;
  readonly name: string;
  readonly logo: MockLogo;
  readonly folded: boolean;
  readonly agents: readonly MockAgent[];
}

const a = (
  title: string,
  status: RailStatus,
  age: string,
  branch = "main",
  focused = false,
): MockAgent => ({ title, status, age, branch, focused });

export const MOCK_WORKSPACES: readonly MockWorkspace[] = [
  {
    key: "deck",
    name: "spacevibe-deck",
    logo: "violet",
    folded: false,
    agents: [
      a("Refactor the rail row into one layout", "working", "now", "main", true),
      a("Fix the dock tree resize grip", "working", "2m", "fix/dock-grip"),
      a("Write the launcher bar tests", "working", "5m", "feat/launcher-bar"),
      a(
        "Cho phép xoá một worktree đang có agent chạy dở dang, hỏi lại trước khi xoá",
        "needs-input",
        "1m",
        "worktree-clean",
      ),
      a("Review the spec traceability table", "unread", "9m", "docs/specs"),
      a("Updater smoke is red at manifest-missing", "failed", "14m", "fix/updater-smoke"),
    ],
  },
  {
    key: "kyant-dev",
    name: "kyant.dev",
    logo: "dark",
    folded: false,
    agents: [
      a("Đây là thông báo tự động báo lỗi build", "working", "now"),
      a("Add the RSS feed route", "done", "1h", "feat/rss"),
      a("Rewrite the about page copy", "unread", "22m", "content/about"),
      a("Audit image sizes", "idle", "3d", "perf/images"),
    ],
  },
  {
    key: "bench",
    name: "spacevibe-bench",
    logo: "folder",
    folded: false,
    agents: [
      a("Which model should lead the leaderboard?", "needs-input", "3m", "main"),
      a("Cut the Vote page from navigation", "working", "7m", "chore/hide-vote"),
      a("Leaderboard cache headers", "done", "2h", "perf/cache"),
    ],
  },
  {
    key: "academy",
    name: "spacevibe-academy-with-an-extremely-long-workspace-name",
    logo: "folder",
    folded: false,
    agents: [
      a(
        "Migrate the lesson player to server components",
        "working",
        "now",
        "feat/lesson-player-server-components-migration",
      ),
      a("Seed the pre-launch waitlist", "working", "4m", "feat/waitlist"),
      a("Payload upgrade", "ended", "6h", "chore/payload"),
      a("Check the Neon branch cleanup", "idle", "1d", "ops/neon"),
    ],
  },
  {
    key: "kyantran",
    name: "kyantran",
    logo: "folder",
    folded: false,
    agents: [
      a("Tóm tắt các PR đang mở", "unread", "11m", "main"),
      a("Dọn thư mục scratch", "done", "5h", "main"),
    ],
  },
  { key: "active", name: "spacevibe-active", logo: "folder", folded: false, agents: [] },
  {
    key: "board",
    name: "spacevibe-board",
    logo: "folder",
    folded: true,
    agents: [
      a("Which notch layout do you prefer?", "needs-input", "2m"),
      a("Permission: run xcodebuild?", "needs-input", "6m", "feat/notch"),
      a("Build failed on the Release scheme", "failed", "18m", "fix/release"),
      a("Usage ring summary is ready", "unread", "25m", "feat/rings"),
      a("Sparkle appcast", "working", "now", "ops/appcast"),
      a("Stream Deck plugin pause", "working", "1m", "chore/pause"),
      a("Codex usage poller", "working", "8m", "feat/codex-poll"),
      a("Old notch prototype", "done", "2d", "proto/notch"),
    ],
  },
  {
    key: "giffcoffee",
    name: "spacevibe-giffcoffee",
    logo: "dark",
    folded: true,
    agents: [
      a("VietQR amount field", "working", "now"),
      a("Supabase RLS policy for creators", "working", "3m", "feat/rls"),
      a("Google auth callback", "done", "4h", "fix/auth"),
      a("Idle shell", "idle", "1d"),
    ],
  },
  {
    key: "hub",
    name: "spacevibe-hub",
    logo: "folder",
    folded: true,
    agents: [
      a("Remove the old live code", "unread", "12m", "chore/live"),
      a("Redirect /live", "done", "3h", "feat/redirect"),
      a("Portfolio copy", "idle", "2d"),
    ],
  },
];
