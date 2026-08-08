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
    pasteText(text) {
      return events.onData(id, text);
    },
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
    await expect(life.paneEvents.onData(pane.id, "x")).resolves.toBe(false);
    await vi.waitFor(() => {
      expect(persistError.value).toContain("input");
    });
  });

  it("keeps later independent input usable after one failed write", async () => {
    const writePty = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    const life = createPaneLifecycle({
      pty: { ...createMemoryPtyClient({ nextId: 1 }), writePty },
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane(id, _settings, events) {
        return fakePane(id, events);
      },
    });
    const pane = await life.spawnPane();

    await expect(life.enqueueWrite(pane.id, "first")).resolves.toBe(false);
    await expect(life.enqueueWrite(pane.id, "second")).resolves.toBe(true);
    expect(writePty).toHaveBeenNthCalledWith(2, pane.id, "second");
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

describe("write queue", () => {
  /** Let every pending microtask chain settle before asserting. */
  const flush = async (): Promise<void> => {
    for (let tick = 0; tick < 8; tick += 1) {
      await Promise.resolve();
    }
  };

  /** A pty whose writes settle only when the test releases them. */
  const gatedPty = () => {
    const writes: { id: number; data: string }[] = [];
    const releases: (() => void)[] = [];
    return {
      writes,
      releases,
      client: {
        ...createMemoryPtyClient(),
        writePty(id: number, data: string) {
          writes.push({ id, data });
          return new Promise<void>((resolve) => releases.push(resolve));
        },
      },
    };
  };

  const mount = (
    gate: ReturnType<typeof gatedPty>,
    // Annotated, not inferred from the default: `= () => {}` would infer
    // `() => void`, and test 3 passes `(id: number) => …`. A function taking
    // MORE parameters than its target type declares is never assignable
    // (TS2345), and `tsconfig.json` includes `src`, so that lands as a red
    // `npm run build` — while vitest stays green, because esbuild does not
    // typecheck.
    onWriteWhileExited: (id: number, data: string) => void = () => {},
  ) =>
    createPaneLifecycle({
      pty: gate.client,
      getSettings: () => DEFAULT_SETTINGS,
      createPane: (id, _settings: Settings, events: PaneEvents) =>
        fakePane(id, events),
      onWriteWhileExited,
      onFocus: () => {},
    });

  const sent = (gate: ReturnType<typeof gatedPty>): string[] =>
    gate.writes.map((write) => write.data);

  it("starts a write only after the previous one settles", async () => {
    const gate = gatedPty();
    const life = mount(gate);
    const pane = await life.spawnPane();

    life.enqueueWrite(pane.id, "frame");
    life.enqueueWrite(pane.id, "\r");
    await flush();
    // The second write must not have started while the first is unsettled.
    expect(sent(gate)).toEqual(["frame"]);

    gate.releases[0]();
    await flush();
    expect(sent(gate)).toEqual(["frame", "\r"]);
  });

  it("drops a queued write for a pane that exited meanwhile", async () => {
    const gate = gatedPty();
    const life = mount(gate);
    const pane = await life.spawnPane();

    life.enqueueWrite(pane.id, "frame");
    await flush();
    expect(sent(gate)).toEqual(["frame"]);

    // Queued while the pane is still alive, so it passes the enqueue-time
    // guard; the pane then exits before its turn comes up.
    life.enqueueWrite(pane.id, "\r");
    life.exited.add(pane.id);
    gate.releases[0]();
    await flush();
    expect(sent(gate)).toEqual(["frame"]);
  });

  it("still routes a bare Enter on an exited pane to the respawn path", async () => {
    const gate = gatedPty();
    const respawns: number[] = [];
    const life = mount(gate, (id: number) => respawns.push(id));
    const pane = await life.spawnPane();
    life.exited.add(pane.id);
    life.paneEvents.onData(pane.id, "\r");
    // Synchronous: the enqueue-time guard fires before any microtask.
    expect(respawns).toEqual([pane.id]);
    await flush();
    expect(gate.writes).toEqual([]);
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
