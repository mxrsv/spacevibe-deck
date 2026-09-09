import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SurfaceStrip } from "../terminal/tab-manager";
import type { BrowserClient, BrowserState } from "../browser/browser-client";
import {
  browserOpen,
  browserSurfaceActive,
  EMPTY_STATE,
  resetBrowserStore,
} from "../browser/browser-store";
import {
  agentBoardOpen,
  agentBoardOpenedAt,
  agentBoardSurfaceActive,
  openAgentBoard,
  resetAgentBoardStore,
  stepAgentBoardBack,
} from "./agent-board-store";
import {
  composeSurfaceStrip,
  stageSurfaceDescriptors,
  takeStageForSurface,
} from "./stage-surface-strip";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";

function state(overrides: Partial<BrowserState> = {}): BrowserState {
  return { ...EMPTY_STATE, ...overrides };
}

function fakeClient(overrides: Partial<BrowserClient> = {}): BrowserClient {
  return {
    open: vi.fn(async () => state()),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async (url: string) => url),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setBounds: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
    setInspect: vi.fn(async () => {}),
    onState: vi.fn(async () => () => {}),
    onGrab: vi.fn(async () => () => {}),
    onNavigated: vi.fn(async () => () => {}),
    ...overrides,
  };
}

function fakeFiles(overrides: Partial<SurfaceStrip> = {}): SurfaceStrip {
  return {
    count: vi.fn(() => 2),
    total: vi.fn(() => 3),
    activeIndex: vi.fn(() => -1),
    activate: vi.fn(),
    deactivate: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    applySettings: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetBrowserStore();
  // Both surface stores are window-scoped singletons, so a board left open by
  // one case would change every count in the next one.
  resetAgentBoardStore();
});

describe("composeSurfaceStrip with the browser tab closed", () => {
  // The invariant protecting every existing TabManager behavior: while no
  // browser tab exists, the composed strip must be indistinguishable from
  // the file controller it wraps.
  it("delegates every method bit-identically to the file strip", async () => {
    const files = fakeFiles({ activeIndex: vi.fn(() => 1) });
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    expect(strip.count()).toBe(2);
    expect(strip.total()).toBe(3);
    expect(strip.activeIndex()).toBe(1);
    strip.activate(1);
    expect(files.activate).toHaveBeenCalledWith(1);
    strip.deactivate();
    expect(files.deactivate).toHaveBeenCalledTimes(1);
    strip.focus();
    expect(files.focus).toHaveBeenCalledTimes(1);
    await strip.close();
    expect(files.close).toHaveBeenCalledTimes(1);
    await strip.save();
    expect(files.save).toHaveBeenCalledTimes(1);
    strip.applySettings(DEFAULT_SETTINGS);
    expect(files.applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    // No browser transition happened, so TabManager was never poked.
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("composeSurfaceStrip with the browser tab open", () => {
  it("appends the browser as the segment's last surface", () => {
    browserOpen.value = true;
    const strip = composeSurfaceStrip({
      files: fakeFiles(),
      client: fakeClient(),
      onChanged: vi.fn(),
    });
    expect(strip.count()).toBe(3);
    expect(strip.total()).toBe(4);
    expect(strip.activeIndex()).toBe(-1); // nothing active yet

    browserSurfaceActive.value = true;
    expect(strip.activeIndex()).toBe(2); // files.count() — after the files
  });

  it("activating the browser index steps the file surface back", () => {
    browserOpen.value = true;
    const files = fakeFiles();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    strip.activate(2);
    expect(browserSurfaceActive.value).toBe(true);
    expect(files.deactivate).toHaveBeenCalledTimes(1);
    expect(files.activate).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Re-activating the already-active browser is a no-op, not a re-notify.
    strip.activate(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("activating a file index steps the browser back and hides its view", () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const client = fakeClient();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({ files, client, onChanged });

    strip.activate(0);
    expect(browserSurfaceActive.value).toBe(false);
    expect(browserOpen.value).toBe(true); // the chip survives losing the stage
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(files.activate).toHaveBeenCalledWith(0);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("deactivate steps both surfaces back (a terminal took the stage)", () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const client = fakeClient();
    const strip = composeSurfaceStrip({ files, client, onChanged: vi.fn() });

    strip.deactivate();
    expect(browserSurfaceActive.value).toBe(false);
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(files.deactivate).toHaveBeenCalledTimes(1);
  });

  it("⌘W routes to the browser tab while it holds the stage", async () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    await strip.close();
    expect(browserOpen.value).toBe(false); // the chip leaves the strip
    expect(browserSurfaceActive.value).toBe(false);
    expect(files.close).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("save and focus are browser no-ops, never misrouted to the files", async () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged: vi.fn(),
    });

    await strip.save();
    strip.focus();
    expect(files.save).not.toHaveBeenCalled();
    expect(files.focus).not.toHaveBeenCalled();
  });
});

describe("composeSurfaceStrip and the Edit-menu commands", () => {
  // The delegation this file exists to guarantee, for the one method added
  // 2026-08-19. Forgetting it here is silent: `runEditCommand` is optional on
  // `SurfaceStrip`, so a composed strip that drops it type-checks fine and
  // simply answers "not mine" — which sends Select All back to the
  // document-level command that cannot see Monaco at all.
  it("forwards runEditCommand to the file strip", () => {
    const files = fakeFiles({ runEditCommand: vi.fn(() => true) });
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged: vi.fn(),
    });

    expect(strip.runEditCommand?.("select-all")).toBe(true);
    expect(files.runEditCommand).toHaveBeenCalledWith("select-all");
  });

  it("answers false when the file strip cannot handle the command", () => {
    const files = fakeFiles({ runEditCommand: vi.fn(() => false) });
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged: vi.fn(),
    });

    expect(strip.runEditCommand?.("undo")).toBe(false);
  });

  it("answers false for a file strip that predates the method", () => {
    const strip = composeSurfaceStrip({
      files: fakeFiles(),
      client: fakeClient(),
      onChanged: vi.fn(),
    });

    expect(strip.runEditCommand?.("redo")).toBe(false);
  });
});

describe("the agent board slot", () => {
  it("counts after the browser and answers its own order key", () => {
    browserOpen.value = true;
    const strip = composeSurfaceStrip({
      files: fakeFiles(),
      client: fakeClient(),
      onChanged: vi.fn(),
    });
    expect(strip.count()).toBe(3); // two file tabs plus the browser

    openAgentBoard();
    expect(strip.count()).toBe(4);
    expect(strip.total()).toBe(5);
    // Files, then the browser, then the board — the index space is
    // bookkeeping, and the merged strip places the chip by this key instead.
    expect(strip.orderKey?.(3)).toBe(agentBoardOpenedAt.value);
  });

  it("activates the board, and a terminal tab steps it back", () => {
    const files = fakeFiles({ count: vi.fn(() => 1) });
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({ files, client: fakeClient(), onChanged });

    openAgentBoard();
    stepAgentBoardBack(); // the chip exists, but a terminal holds the stage
    strip.activate(1);
    expect(agentBoardSurfaceActive.value).toBe(true);
    expect(strip.activeIndex()).toBe(1);
    expect(files.deactivate).toHaveBeenCalledTimes(1);
    expect(files.activate).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);

    strip.deactivate();
    expect(agentBoardSurfaceActive.value).toBe(false);
    expect(agentBoardOpen.value).toBe(true); // the chip survives losing the stage
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("closes the board tab, not just its stage turn", async () => {
    const files = fakeFiles({ count: vi.fn(() => 0) });
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({ files, client: fakeClient(), onChanged });

    openAgentBoard();
    await strip.close();
    expect(agentBoardOpen.value).toBe(false);
    expect(agentBoardSurfaceActive.value).toBe(false);
    expect(files.close).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("saves and focuses nothing while the board holds the stage", async () => {
    const files = fakeFiles();
    const strip = composeSurfaceStrip({ files, client: fakeClient(), onChanged: vi.fn() });

    openAgentBoard();
    await strip.save();
    strip.focus();
    expect(files.save).not.toHaveBeenCalled();
    expect(files.focus).not.toHaveBeenCalled();
  });

  it("describes every slot by kind, in SurfaceStrip index order", () => {
    browserOpen.value = true;
    openAgentBoard();
    const descriptors = stageSurfaceDescriptors(
      fakeFiles({ count: vi.fn(() => 1), orderKey: vi.fn(() => 7) }),
    );

    expect(descriptors.map((slot) => slot.kind)).toEqual(["file", "browser", "agent-board"]);
    expect(descriptors.map((slot) => slot.index)).toEqual([0, 1, 2]);
    expect(descriptors[0].openedAt).toBe(7);
    expect(descriptors[2].openedAt).toBe(agentBoardOpenedAt.value);
  });

  it("describes only the files while neither the browser nor the board is open", () => {
    expect(
      stageSurfaceDescriptors(fakeFiles({ count: vi.fn(() => 2) })).map((s) => s.kind),
    ).toEqual(["file", "file"]);
  });
});

describe("a chip press keeps exactly one surface on the stage", () => {
  // The hole Task 1 left: `selectAgentBoardTab` cleared the browser, but the
  // browser's own chip did not clear the Board — so a press left BOTH flags
  // true, and `composeSurfaceStrip` tests the board first in `activeIndex()`
  // and `close()`. The strip then highlighted the Board's chip while the
  // browser was on screen, and ⌘W closed the Board's chip while the user was
  // looking at the browser.
  it("steps the board back when the browser chip is pressed", () => {
    browserOpen.value = true;
    openAgentBoard();
    const files = fakeFiles();

    const changed = takeStageForSurface("browser", { files, client: fakeClient() });

    expect(changed).toBe(true);
    expect(browserSurfaceActive.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(false);
    expect(agentBoardOpen.value).toBe(true); // the chip survives losing the stage
    expect(files.deactivate).toHaveBeenCalledTimes(1);
  });

  it("hides the browser's native view when the board chip is pressed", () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    openAgentBoard();
    stepAgentBoardBack();
    const files = fakeFiles();
    const client = fakeClient();

    const changed = takeStageForSurface("agent-board", { files, client });

    expect(changed).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(true);
    expect(browserSurfaceActive.value).toBe(false);
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(browserOpen.value).toBe(true);
  });

  it("never leaves both flags true, whichever chip is pressed", () => {
    for (const kind of ["browser", "agent-board"] as const) {
      resetBrowserStore();
      resetAgentBoardStore();
      browserOpen.value = true;
      openAgentBoard();
      takeStageForSurface(kind, { files: fakeFiles(), client: fakeClient() });
      expect(browserSurfaceActive.value && agentBoardSurfaceActive.value).toBe(false);
    }
  });

  it("reports no transition when the pressed chip already holds the stage", () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();

    expect(takeStageForSurface("browser", { files, client: fakeClient() })).toBe(false);
    expect(files.deactivate).not.toHaveBeenCalled();
  });

  it("reports no transition for a board chip that does not exist", () => {
    // Unreachable from a chip — there is no chip while the board is closed —
    // but the function must not claim a transition it did not make:
    // `activateAgentBoard` is a no-op on a closed board, and the caller
    // notifies TabManager on a `true`.
    const files = fakeFiles();
    expect(takeStageForSurface("agent-board", { files, client: fakeClient() })).toBe(false);
    expect(files.deactivate).not.toHaveBeenCalled();
  });
});
