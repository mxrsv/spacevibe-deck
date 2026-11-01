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
import { diffFocusRequested } from "../../files/changes/diff-column-focus";
import { createDiffSelection, type DiffSelectionStore } from "../../files/changes/diff-selection";
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
import { AgentDock } from "./agent-dock";
import { dockSheetOpen, resetAgentDockState } from "./agent-dock-state";
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

let diff: DiffSelectionStore;
let controller: ChangesController;

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
  diff = createDiffSelection(state);
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
      selection={{ onFocusPane: () => {}, onSelectTab: () => {} }}
      bodies={{
        changes: {
          watch: (root) => <DockChangesWatch root={root} changes={controller} diff={diff} />,
          section: (root) => <DockChanges root={root} changes={controller} diff={diff} />,
          count: (root) => changedFileCount(root, controller),
        },
        files: () => <p>files body</p>,
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
  diffFocusRequested.value = false;
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

describe("the Changes section in a narrow window", () => {
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

  it("closes the sheet on a file press and leaves the diff open for the column beside the handle", async () => {
    const view = await mount(dock());
    const handle = named("Open the side panel") as HTMLElement;
    handle.focus();
    await click(handle);
    await click(row("file:src/a.ts"));

    await waitUntil(() => byRole("dialog") === null);
    expect(dockSheetOpen.value).toBe(false);
    expect(diff.selection.value).toMatchObject({ root: ROOT, path: "src/a.ts" });
    expect(controller.setShown).not.toHaveBeenCalledWith(null);
    // The diff column is asked for focus after the sheet let go, and the handle does not get it back.
    await waitUntil(() => diffFocusRequested.value);
    expect(document.activeElement).not.toBe(handle);
    await view.unmount();
  });

  it("hands focus back to the handle for a close that opened no diff, and keeps an open diff", async () => {
    diff.open(ROOT, "src/b.ts");
    const view = await mount(dock());
    const handle = named("Open the side panel") as HTMLElement;
    handle.focus();
    await click(handle);
    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    await waitUntil(() => document.activeElement === handle);
    expect(diff.selection.value?.path).toBe("src/b.ts");
    expect(diffFocusRequested.value).toBe(false);

    // The scrim closes it the same way.
    await click(handle);
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        scrim().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
      }
    });
    await settle();
    await waitUntil(() => byRole("dialog") === null);
    expect(diff.selection.value?.path).toBe("src/b.ts");
    await view.unmount();
  });

  it("ends the diff when the dock goes away", async () => {
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    await click(row("file:src/a.ts"));
    await waitUntil(() => byRole("dialog") === null);
    expect(diff.selection.value).not.toBeNull();
    await view.unmount();
    expect(diff.selection.value).toBeNull();
  });
});
