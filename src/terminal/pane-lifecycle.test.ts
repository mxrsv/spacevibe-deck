import { describe, expect, it, vi } from "vitest";
import { leaf } from "../lib/split-tree";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings-schema";
import { createPaneLifecycle } from "./pane-lifecycle";
import type { Pane, PaneAttentionSignal, PaneEvents } from "./pane";
import { createMemoryPtyClient } from "./pty-client";
import { persistError } from "../chrome/events";

function fakePane(
  id: number,
  events: PaneEvents,
): Pane & { focusCalls: number } {
  const focusCalls = { n: 0 };
  const pane: Pane & { focusCalls: number } = {
    id,
    element: {} as HTMLElement,
    search: {} as Pane["search"],
    focusCalls: 0,
    mount() {},
    write() {},
    writeln() {},
    fit() {},
    clear() {},
    copySelection() {},
    paste() {},
    scrollPage() {},
    scrollToEdge() {},
    focus() {
      focusCalls.n += 1;
      pane.focusCalls = focusCalls.n;
      events.onFocus(id);
    },
    applySettings() {},
    setHeaderInfo() {},
    captureSelection() {
      return null;
    },
    restoreSelection() {},
    dispose() {},
  };
  return pane;
}

describe("createPaneLifecycle respawn", () => {
  it("does not focus the fresh pane (caller focuses after render/mount)", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const made: Array<Pane & { focusCalls: number }> = [];
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        const pane = fakePane(id, events);
        made.push(pane);
        return pane;
      },
    });

    const old = await life.spawnPane();
    const tree = leaf(old.id);
    const result = await life.respawn(old.id, tree, old.id);

    expect(result).not.toBeNull();
    expect(result!.activeId).toBe(2);
    expect(made).toHaveLength(2);
    expect(made[1].focusCalls).toBe(0);
  });

  it("replaces the leaf id and removes the old pane from the map", async () => {
    const pty = createMemoryPtyClient({ nextId: 10 });
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        return fakePane(id, events);
      },
    });

    const old = await life.spawnPane("/tmp");
    const result = await life.respawn(old.id, leaf(old.id), old.id);
    expect(result?.tree).toEqual(leaf(11));
    expect(life.panes.has(10)).toBe(false);
    expect(life.panes.has(11)).toBe(true);
  });
});

describe("createPaneLifecycle write failures", () => {
  it("surfaces a failed keystroke write to the user", async () => {
    persistError.value = null;
    const pty = {
      ...createMemoryPtyClient({ nextId: 1 }),
      writePty: vi.fn().mockRejectedValue(new Error("session gone")),
    };
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        return fakePane(id, events);
      },
    });
    const pane = await life.spawnPane();
    life.paneEvents.onData(pane.id, "x");
    await vi.waitFor(() => {
      expect(persistError.value).toContain("input");
    });
  });
});

describe("createPaneLifecycle attention signals", () => {
  it("forwards a signal from the pane's events to deps.onAttentionSignal with the same pane id", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const onAttentionSignal = vi.fn();
    let capturedEvents: PaneEvents | null = null;
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      onAttentionSignal,
      createPane(id, _settings, events) {
        capturedEvents = events;
        return fakePane(id, events);
      },
    });

    const pane = await life.spawnPane();
    const signal: PaneAttentionSignal = {
      kind: "requested",
      source: "osc-notification",
    };
    capturedEvents!.onAttentionSignal?.(pane.id, signal);

    expect(onAttentionSignal).toHaveBeenCalledWith(pane.id, signal);
  });

  it("is a safe no-op when no onAttentionSignal dep is provided", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    let capturedEvents: PaneEvents | null = null;
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        capturedEvents = events;
        return fakePane(id, events);
      },
    });

    const pane = await life.spawnPane();
    expect(() =>
      capturedEvents!.onAttentionSignal?.(pane.id, {
        kind: "requested",
        source: "bell",
      }),
    ).not.toThrow();
  });
});

describe("createPaneLifecycle discardPane", () => {
  it("kills the PTY session", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const killSpy = vi.spyOn(pty, "killPty");
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        return fakePane(id, events);
      },
    });
    const pane = await life.spawnPane();
    life.discardPane(pane);
    expect(killSpy).toHaveBeenCalledWith(1);
    expect(life.panes.has(1)).toBe(false);
  });
});
