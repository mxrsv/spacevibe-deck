// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stores the chip reads reach the host; none of it is exercised here.
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

import { createDevServerStore, type DevServerStore } from "../../dev-servers/dev-server-store";
import type {
  DevServerCapability,
  DevServerHost,
  DevServerSnapshot,
} from "../../dev-servers/dev-server-types";
import { WORKSPACES_VERSION } from "../../lib/workspace-recents";
import { workspacesData } from "../../open-board/workspaces-store";
import { repositoryScans } from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { NOW, tab } from "../attention-list-fixtures";
import { row, snapshot, worktree } from "./dev-server-fixtures";
import { DevServersStripChip } from "./dev-servers-strip-chip";

const AVAILABLE: DevServerCapability = { available: true };

function fakeHost(capability: DevServerCapability, rows: DevServerSnapshot["rows"] = []) {
  const setRoots = vi.fn(async () => ({
    capability,
    applied: true,
    generation: 1,
    rootDiagnostics: [],
  }));
  const host: DevServerHost = {
    setRoots,
    snapshot: vi.fn(async () => snapshot(rows, { capability })),
    release: vi.fn(async () => {}),
    resolve: vi.fn(async () => ({ status: "stale" as const })),
  };
  return { host, setRoots };
}

describe("DevServersStripChip", () => {
  let host: HTMLDivElement;
  let store: DevServerStore;
  const openInDeck = vi.fn(async (url: string) => ({ ok: true as const, url }));
  const shell = { openUrl: vi.fn(async () => {}), copy: vi.fn(async () => {}) };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/old", lastOpenedAt: NOW }],
    };
    repositoryScans.value = new Map();
    activeTabIndex.value = 0;
    tabViews.value = [tab(1, "/w/deck"), tab(2, "/w/api")];
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    tabViews.value = [];
  });

  const flush = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const mount = async (fake: ReturnType<typeof fakeHost>): Promise<void> => {
    store = createDevServerStore(fake.host, 60_000);
    act(() =>
      render(<DevServersStripChip openInDeck={openInDeck} store={store} shell={shell} />, host),
    );
    await flush();
  };
  const chip = (): HTMLButtonElement | null => host.querySelector(".dsv-chip");

  it("watches the open tabs and the recents from the moment it mounts", async () => {
    const fake = fakeHost(AVAILABLE);
    await mount(fake);

    expect(fake.setRoots).toHaveBeenCalledTimes(1);
    expect(fake.setRoots).toHaveBeenCalledWith(["/w/api", "/w/deck", "/w/old"]);
    expect(chip()?.getAttribute("aria-label")).toBe("Dev servers — 0 running");
  });

  it("also watches the worktrees of a scanned repository, opened or not", async () => {
    const nested = "/w/deck/.claude/worktrees/x";
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/w/deck/.git",
      root: "/w/deck",
      worktrees: [worktree("/w/deck", "main"), worktree(nested, "x")],
    };
    repositoryScans.value = new Map([["/w/deck", scan]]);
    const fake = fakeHost(AVAILABLE);
    await mount(fake);

    expect(fake.setRoots).toHaveBeenCalledWith(["/w/api", "/w/deck", nested, "/w/old"]);
  });

  it("counts the active tab's running servers from the store's snapshot", async () => {
    await mount(
      fakeHost(AVAILABLE, [
        row(),
        row({ id: "b", port: 3000, displayRoot: "/w/api" }),
        row({ id: "c", port: 3001, displayRoot: "/w/api" }),
      ]),
    );

    expect(chip()?.textContent).toBe("1");
    activeTabIndex.value = 1;
    await flush();
    expect(chip()?.textContent).toBe("2");
    expect(chip()?.getAttribute("aria-label")).toContain("2 running");
  });

  it("is absent where the host cannot discover servers", async () => {
    await mount(fakeHost({ available: false, reason: "unsupported-platform", platform: "win32" }));

    expect(host.innerHTML).toBe("");
  });

  it("re-registers only when the set of folders changes, not on every republish", async () => {
    const fake = fakeHost(AVAILABLE);
    await mount(fake);
    fake.setRoots.mockClear();

    act(() => {
      tabViews.value = [tab(1, "/w/deck"), tab(2, "/w/api")];
    });
    await flush();
    expect(fake.setRoots).not.toHaveBeenCalled();

    act(() => {
      tabViews.value = [tab(1, "/w/deck"), tab(2, "/w/api"), tab(3, "/w/hub")];
    });
    await flush();
    expect(fake.setRoots).toHaveBeenCalledTimes(1);
    expect(fake.setRoots).toHaveBeenCalledWith(["/w/api", "/w/deck", "/w/hub", "/w/old"]);
  });

  it("lets go of the host when it leaves the strip", async () => {
    const fake = fakeHost(AVAILABLE);
    await mount(fake);

    act(() => render(null, host));
    await flush();

    expect(fake.host.release).toHaveBeenCalledTimes(1);
    expect(store.observing.value).toBe(false);
  });

  it("asks the core to vouch for an instance before acting on it", async () => {
    const fake = fakeHost(AVAILABLE, [row()]);
    await mount(fake);

    act(() => chip()?.click());
    act(() => (document.querySelector("[data-col='0']") as HTMLButtonElement).click());
    await flush();

    expect(fake.host.resolve).toHaveBeenCalledWith("a", "token-a");
    expect(openInDeck).not.toHaveBeenCalled();
    expect(document.querySelector(".dsv-status")?.textContent).toContain("Not opened");
  });
});
