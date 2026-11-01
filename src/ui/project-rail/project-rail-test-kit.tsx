// Shared by the project rail's suites: the workday fixture and the real `AgentRail` entrance.
// A suite carries its own `vi.mock` block (they hoist per file): the host stubs the rail's
// import graph reaches, and a `DeckIcon` jsdom can draw.
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, vi } from "vitest";
import { byRole, settle as settleTimers, waitUntil } from "../controls/preset-test-kit";
import { activeTabIndex, tabViews, type PaneView, type TabView } from "../../terminal/tabs-store";
import { AgentRail } from "../agent-rail";
import {
  configureRepositoryClient,
  invalidateRepositoryScans,
} from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../../files/file-surface-controller";
import { resetFileSurfaces } from "../../files/file-surface-store";
import type { FileClient } from "../../files/file-client";
import { workspacesData } from "../../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../../lib/workspace-recents";
import { sessionArchive } from "../../terminal/session-journal";
import { paneModels, paneTails } from "../../terminal/session-tail-store";
import { updateSettings } from "../../settings/settings-store";
import { resetProjectRailState } from "./project-rail-state";

const fileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root: string, parent: string, name: string) => ({
    path: `${parent}/${name}`,
  }),
  listenFileChanged: async () => () => {},
};

const checkout = (path: string, branch: string) => ({
  path,
  head: "a",
  branch,
  bare: false,
  detached: false,
  locked: null,
  prunable: null,
});

const REPOSITORY: RepositoryScan = {
  kind: "repository",
  key: "/r/.git",
  root: "/r/main",
  worktrees: [checkout("/r/main", "main"), checkout("/r/side", "side")],
};

export const MINUTE = 60_000;
export const NOW = 1_800_000_000_000;

export function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: NOW - 30 * MINUTE,
    ...overrides,
  };
}

export function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/r/main",
    agents: [],
    agentBusy: false,
    unread: false,
    panes: [pane()],
    ...overrides,
  };
}

/** A repository that asks and works, a finished side checkout, a failed folder beside a shell. */
export function workday(): TabView[] {
  return [
    tab({
      key: 1,
      panes: [
        pane({ paneId: 11, attention: "requested", changedAt: NOW - 10 * MINUTE }),
        pane({ paneId: 12, agent: "codex", phase: "working", changedAt: NOW - MINUTE }),
      ],
    }),
    tab({
      key: 2,
      workspacePath: "/r/side",
      name: "token refresh",
      panes: [
        pane({
          paneId: 21,
          attention: "completed",
          confidence: "inferred",
          changedAt: NOW - 3 * MINUTE,
        }),
      ],
    }),
    tab({
      key: 3,
      workspacePath: "/w/api",
      panes: [pane({ paneId: 31, attention: "error", changedAt: NOW - 40 * MINUTE })],
    }),
    tab({ key: 4, workspacePath: "/w/api", panes: [] }),
  ];
}

/** The workday with the window's keyboard in tab `key` (the caller makes it the active tab). */
export function workdayFocusing(key: number): TabView[] {
  return workday().map((view) =>
    view.key === key
      ? { ...view, panes: (view.panes ?? []).map((p) => ({ ...p, focused: true })) }
      : view,
  );
}

/**
 * A fresh element per test (`beforeEach`): Base UI marks the rest of the page inert while a popup
 * is open, and a mark a test left behind would keep the next one's fields from taking focus.
 */
export let host = document.createElement("div");
let fileController: FileSurfaceController;

const NOOP = (): void => {};

/** Pin the host the way `action-availability.test.ts` does; the switch follows `isDevelopment`. */
export function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

export function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onClosePane={NOOP}
        onFocusPane={NOOP}
        legacy={{ onOpenWorkspace: NOOP, onResumeWorktree: NOOP }}
        fileController={fileController}
        {...props}
      />,
      host,
    );
  });
}

export function unmount(): void {
  act(() => render(null, host));
}

export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Dispatch a key on `element`; returns whether a handler cancelled it. */
export function press(
  element: Element | null | undefined,
  key: string,
  modifiers: KeyboardEventInit = {},
): boolean {
  let event: KeyboardEvent | undefined;
  act(() => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
    element?.dispatchEvent(event);
  });
  return event?.defaultPrevented ?? false;
}

export const rows = () => [...host.querySelectorAll<HTMLElement>("[data-rail-row]")];
export const headers = () => [...host.querySelectorAll<HTMLElement>("[data-rail-project]")];
export const row = (id: string) => host.querySelector<HTMLElement>(`[data-rail-row="${id}"]`);
/** The row's wrapper: the hover buttons and the rename field live beside the row button. */
export const item = (id: string) => host.querySelector<HTMLElement>(`[data-rail-item="${id}"]`);
export const names = () =>
  headers().map((header) => header.querySelector(".truncate")?.textContent);
export const text = (element: Element | null | undefined) => element?.textContent ?? "";

/** The entries of the open menu, labelled by their text. */
export const menuItems = () => [
  ...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
];
export const menuLabels = () => menuItems().map((entry) => text(entry));

/** A real activation: Base UI listens for the click a button's own press produces. */
export async function activate(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    element?.click();
  });
  await settleTimers();
}

/** Right-click a row's wrapper; resolves to whether the native menu was cancelled, with ours open. */
export async function openMenuByRightClick(id: string): Promise<boolean> {
  let cancelled = false;
  await act(async () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    item(id)?.dispatchEvent(event);
    cancelled = event.defaultPrevented;
  });
  await waitUntil(() => byRole("menu") !== null);
  return cancelled;
}

export async function closeMenu(): Promise<void> {
  press(byRole("menu"), "Escape");
  await waitUntil(() => byRole("menu") === null);
}

/** Choose a menu entry by its label. */
export async function pick(label: string): Promise<void> {
  await activate(menuItems().find((entry) => text(entry) === label));
}

/** Registers the per-test setup every suite of the rail shares. Call once at the top of a suite. */
export function installRailHarness(): void {
  beforeEach(() => {
    // Real time keeps passing (`shouldAdvanceTime`), so the controls' own deadlines still end.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.appendChild(host);
    invalidateRepositoryScans();
    configureRepositoryClient({
      scan: async (path: string) =>
        path.startsWith("/r/") ? REPOSITORY : { kind: "plain", reason: "not a git repository" },
    });
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/r/main", lastOpenedAt: 4 },
        { path: "/w/api", lastOpenedAt: 3 },
        { path: "/w/notes", lastOpenedAt: 2 },
      ],
    };
    tabViews.value = workday();
    activeTabIndex.value = 0;
    resetFileSurfaces();
    fileController = createFileSurfaceController({ client: fileClient });
    sessionArchive.value = {};
    paneTails.value = new Map();
    paneModels.value = new Map();
    updateSettings({ railOrder: [] });
    resetProjectRailState();
  });

  afterEach(() => {
    unmount();
    host.remove();
    invalidateRepositoryScans();
    resetDesktopEnvironmentForTests();
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    fileController.dispose();
    resetFileSurfaces();
    sessionArchive.value = {};
    paneTails.value = new Map();
    paneModels.value = new Map();
    updateSettings({ railOrder: [] });
    resetProjectRailState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}
