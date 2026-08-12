// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stubs the flat sidebar's suite installs: the rail reaches the host for
// logo persistence, favicon scanning and the native dialog through its
// imports, none of which a jsdom tree can provide.
vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));

import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import type { TabView } from "../terminal/tabs-store";
import { RepositoryRail } from "./repository-rail";
import {
  collapsedRepositories,
  configureRepositoryClient,
  invalidateRepositoryScans,
} from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";

const SCAN: RepositoryScan = {
  kind: "repository",
  key: "/r/.git",
  root: "/r/main",
  worktrees: [
    {
      path: "/r/main",
      head: "a",
      branch: "main",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
    {
      path: "/r/side",
      head: "b",
      branch: "side",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
  ],
};

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/r/main",
    agentBusy: false,
    unread: false,
    ...overrides,
  };
}

let host: HTMLDivElement;

const NOOP = (): void => {};

function mount(props: Partial<Parameters<typeof RepositoryRail>[0]> = {}): void {
  act(() => {
    render(
      <RepositoryRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onNewTab={NOOP}
        onRenameTab={NOOP}
        onSetTabColor={NOOP}
        {...props}
      />,
      host,
    );
  });
}

/** Let the scan promise and the signal update it triggers both settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  host = document.createElement("div");
  document.body.appendChild(host);
  invalidateRepositoryScans();
  collapsedRepositories.value = new Set();
  configureRepositoryClient({ scan: async () => SCAN });
  tabViews.value = [tab()];
  activeTabIndex.value = 0;
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  invalidateRepositoryScans();
  resetDesktopEnvironmentForTests();
  vi.restoreAllMocks();
});

describe("RepositoryRail", () => {
  it("groups the open tab under its repository and lists the sibling worktree", async () => {
    mount();
    await settle();
    expect(host.querySelector(".repogroup__name")?.textContent).toBe("main");
    // One interactive row for the open tab, one readout for the worktree
    // nobody has opened.
    expect(host.querySelectorAll(".wsitem").length).toBe(2);
    expect(host.querySelectorAll(".wsitem--readout").length).toBe(1);
  });

  it("selects a tab through the same callback the flat sidebar used", async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/r/side" })];
    activeTabIndex.value = 0;
    mount({ onSelectTab });
    await settle();
    const rows = host.querySelectorAll<HTMLElement>(".wsitem:not(.wsitem--readout)");
    expect(rows.length).toBe(2);
    act(() => {
      rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it("closes a tab by index, not by row position", async () => {
    const onCloseTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/r/side" })];
    mount({ onCloseTab });
    await settle();
    const closers = host.querySelectorAll<HTMLElement>(".wsitem__close");
    act(() => {
      closers[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCloseTab).toHaveBeenCalledWith(1);
  });

  it("does not make the not-open worktree a button (DL-17.3 readout)", async () => {
    mount();
    await settle();
    const readout = host.querySelector(".wsitem--readout");
    expect(readout?.tagName).toBe("DIV");
    expect(readout?.querySelector("button")).toBeNull();
    expect(readout?.getAttribute("aria-label")).toContain("not open");
  });

  it("names every state in the accessible label, not only in colour", async () => {
    configureRepositoryClient({
      scan: async () => ({
        ...SCAN,
        worktrees: [
          SCAN.worktrees[0],
          { ...SCAN.worktrees[1], prunable: "gitdir file points to nowhere" },
        ],
      }),
    });
    invalidateRepositoryScans();
    mount();
    await settle();
    expect(
      host.querySelector(".wsitem--readout")?.getAttribute("aria-label"),
    ).toContain("missing from disk");
  });

  it("collapses a repository and hides its worktrees", async () => {
    mount();
    await settle();
    const toggle = host.querySelector<HTMLElement>(".repogroup__toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      host.querySelector(".repogroup__toggle")?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(host.querySelectorAll(".wsitem").length).toBe(0);
  });

  it("still renders every tab when the scan refuses", async () => {
    // Navigation must not be able to fail: a machine without git, or a folder
    // that is not a repository, gets the flat list Deck has always shown.
    configureRepositoryClient({
      scan: async () => ({ kind: "plain", reason: "not a git repository" }),
    });
    invalidateRepositoryScans();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/elsewhere" })];
    mount();
    await settle();
    expect(host.querySelectorAll(".repogroup--plain").length).toBe(2);
    expect(host.querySelectorAll(".wsitem").length).toBe(2);
    expect(host.querySelectorAll(".wsitem--readout").length).toBe(0);
    // No repository header and no `primary` badge: the rail adds a tier where
    // git says there is one, and claims nothing where git said nothing.
    expect(host.querySelector(".repogroup__head")).toBeNull();
    expect(host.querySelector(".wsitem__badge")).toBeNull();
  });

  it("still renders when the scan rejects outright", async () => {
    configureRepositoryClient({
      scan: async () => {
        throw new Error("bridge is gone");
      },
    });
    invalidateRepositoryScans();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    await settle();
    expect(host.querySelectorAll(".wsitem").length).toBe(1);
  });
});
