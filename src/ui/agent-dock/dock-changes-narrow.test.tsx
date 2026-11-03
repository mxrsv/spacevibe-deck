// @vitest-environment jsdom
import { signal } from "@preact/signals";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dock's import graph reaches the host (settings, sessions, repositories): stub it as the
// dock's own tests do, and never let a test start a real scan.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../repositories/repositories-store", async () => {
  const actual = await vi.importActual<typeof import("../../repositories/repositories-store")>(
    "../../repositories/repositories-store",
  );
  return { ...actual, ensureRepositoriesScanned: vi.fn() };
});

import { activeWorkspace } from "../../files/file-surface-store";
import type { ChangesController, ChangesState } from "../../files/changes/changes-controller";
import type { DiffSidesPorts } from "../../files/changes/diff-sides";
import type { ChangeEntry } from "../../host/git-changes-host";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import {
  activeTabIndex,
  statusInfo,
  tabViews,
  type PaneView,
  type TabView,
} from "../../terminal/tabs-store";
import { byRole, click, mount, press, settle, waitUntil } from "../controls/preset-test-kit";
import { testFileBodies } from "./dock-files-test-kit";
import { AgentDock } from "./agent-dock";
import { dockChangesList, dockSheetOpen, resetAgentDockState } from "./agent-dock-state";
import { DockChanges } from "./dock-changes";
import { changedFileCount, DockChangesWatch } from "./dock-changes-watch";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const ROOT = "/work/repo";

const entry = (path: string): ChangeEntry => ({
  path,
  status: "modified",
  oldPath: null,
  added: 2,
  removed: 1,
  binary: false,
  counted: true,
});

const ENTRIES = ["src/a.ts", "src/b.ts", "docs/c.md"].map(entry);

let controller: ChangesController;
const files = testFileBodies();
/** Nothing to read: the cards stay at their "Reading…" line, which these tests do not look at. */
const stackPorts: DiffSidesPorts = {
  statFiles: async () => new Promise(() => {}),
  readFile: async () => new Promise(() => {}),
  readHeadFile: async () => new Promise(() => {}),
};

function fakeChanges(): void {
  const state = signal<ChangesState>({
    root: ROOT,
    snapshot: {
      kind: "changes",
      branch: "feat/x",
      detached: false,
      oid: null,
      initial: false,
      entries: ENTRIES,
      omitted: 0,
      totals: { added: 6, removed: 3 },
    },
    failure: null,
    reading: false,
  });
  controller = {
    state,
    readCount: signal(1),
    setShown: vi.fn(),
    setWindowVisible: vi.fn(),
    trigger: vi.fn(),
    turnEnded: vi.fn(),
    dispose: vi.fn(),
  };
}

const pane = (overrides: Partial<PaneView> = {}): PaneView => ({
  paneId: 11,
  agent: "claude",
  attention: "none",
  phase: "idle",
  hasRun: true,
  changedAt: 1_800_000_000_000,
  focused: true,
  ...overrides,
});
const tab = (): TabView => ({
  key: 1,
  process: "node",
  name: "token refresh",
  dotColor: null,
  workspacePath: ROOT,
  agents: [],
  agentBusy: false,
  unread: false,
  panes: [pane()],
});

/** `AgentDock` over the Changes parts `App` hands it, with the fake controller. */
function dock() {
  return (
    <AgentDock
      entered
      onClose={() => {}}
      bodies={{
        changes: {
          watch: (root) => <DockChangesWatch root={root} changes={controller} />,
          view: (root) => (
            <DockChanges
              root={root}
              changes={controller}
              controller={files.controller}
              ports={stackPorts}
            />
          ),
          count: (root) => changedFileCount(root, controller),
        },
        files,
        usage: () => <p>usage body</p>,
        history: () => <p>history body</p>,
      }}
    />
  );
}

async function resizeTo(width: number): Promise<void> {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

const named = (label: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
const row = (key: string): HTMLElement =>
  document.body.querySelector(`[data-change-row="${key}"]`) as HTMLElement;
const scrim = (): HTMLElement =>
  document.body.querySelector('[data-slot="sheet-overlay"]') as HTMLElement;

beforeEach(async () => {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  settings.value = DEFAULT_SETTINGS;
  tabViews.value = [tab()];
  activeTabIndex.value = 0;
  activeWorkspace.value = ROOT;
  statusInfo.value = { branch: null, cwd: null, agent: null, paneCount: 1, home: "/home/test" };
  resetAgentDockState();
  resetRevealDockTabForTests();
  fakeChanges();
  await resizeTo(1000);
});

afterEach(async () => {
  await resizeTo(1024);
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  tabViews.value = [];
  activeTabIndex.value = -1;
  activeWorkspace.value = null;
  resetAgentDockState();
});

describe("the Changes view in a narrow window", () => {
  it("shows the changed-file count on the handle without opening the sheet", async () => {
    const view = await mount(dock());
    expect(byRole("dialog")).toBeNull();
    expect(named("Open the side panel")?.getAttribute("aria-label")).toBe(
      "Open the side panel, Claude, done, 3 changed files",
    );
    expect(document.body.querySelector("aside")?.textContent).toContain("3");
    await view.unmount();
  });

  it("keeps the watch while the sheet is closed", async () => {
    const view = await mount(dock());
    expect(controller.setShown).toHaveBeenLastCalledWith(ROOT);
    await click(named("Open the side panel") as HTMLElement);
    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    expect(controller.setShown).not.toHaveBeenCalledWith(null);
    await view.unmount();
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
  });

  it("keeps the sheet open on a list press: it scrolls to the card", async () => {
    dockChangesList.value = true;
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    await click(row("file:src/a.ts"));
    expect(byRole("dialog")).not.toBeNull();
    expect(dockSheetOpen.value).toBe(true);
    await view.unmount();
  });

  it("hands focus back to the handle when Escape or the scrim closes the sheet", async () => {
    const view = await mount(dock());
    const handle = named("Open the side panel") as HTMLElement;
    handle.focus();
    await click(handle);
    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    await waitUntil(() => document.activeElement === handle);

    // The scrim closes it the same way.
    await click(handle);
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        scrim().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
      }
    });
    await settle();
    await waitUntil(() => byRole("dialog") === null);
    await waitUntil(() => document.activeElement === handle);
    await view.unmount();
  });
});
