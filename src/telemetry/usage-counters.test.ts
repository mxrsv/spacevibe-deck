import { signal } from "@preact/signals";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The host facade is mocked; the fold through the REAL `agentPayloadKey` is
// part of what these tests pin — a user-typed agent id must leave this module
// as "custom", never as itself. `available` is read at call time inside every
// counter, so flipping it here exercises the fail-soft branch too.
const host = vi.hoisted(() => ({
  available: true,
  telemetryCount: vi.fn(),
  telemetryState: vi.fn(() => Promise.resolve(null)),
  telemetrySetEnabled: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../host/telemetry-host", () => host);

import {
  countAgentLaunch,
  countRestoredSessions,
  countSurfaceOpen,
  installUsageCounterEffects,
  type UsageCounterSources,
} from "./usage-counters";

interface Harness {
  sources: UsageCounterSources;
  tabs: ReturnType<typeof signal<number>>;
  panes: ReturnType<typeof signal<number>>;
  browser: ReturnType<typeof signal<boolean>>;
  explorer: ReturnType<typeof signal<boolean>>;
  usage: ReturnType<typeof signal<boolean>>;
}

function makeSources(overrides?: { browser?: boolean }): Harness {
  const tabs = signal(1);
  const panes = signal(1);
  const browser = signal(overrides?.browser ?? false);
  const explorer = signal(false);
  const usage = signal(false);
  return {
    tabs,
    panes,
    browser,
    explorer,
    usage,
    sources: {
      tabCount: () => tabs.value,
      paneCount: () => panes.value,
      browserVisible: () => browser.value,
      explorerVisible: () => explorer.value,
      usageVisible: () => usage.value,
    },
  };
}

function surfaceCounts(key: string): number {
  return host.telemetryCount.mock.calls.filter(
    ([args]) => args.kind === "surface" && args.key === key,
  ).length;
}

describe("usage-counters", () => {
  beforeEach(() => {
    host.available = true;
    host.telemetryCount.mockClear();
  });

  it("counts a built-in agent launch under its own id", () => {
    countAgentLaunch("claude");
    expect(host.telemetryCount).toHaveBeenCalledWith({
      kind: "agent",
      key: "claude",
      value: 1,
    });
  });

  it("folds a user-typed agent id to the custom bucket before it leaves", () => {
    countAgentLaunch("my-secret-tool");
    expect(host.telemetryCount).toHaveBeenCalledWith({
      kind: "agent",
      key: "custom",
      value: 1,
    });
  });

  it("counts nothing for an empty agent id", () => {
    countAgentLaunch("");
    expect(host.telemetryCount).not.toHaveBeenCalled();
  });

  it("counts surface opens and the restored-sessions flag in their shapes", () => {
    countSurfaceOpen("explorer");
    countRestoredSessions();
    expect(host.telemetryCount).toHaveBeenCalledWith({
      kind: "surface",
      key: "explorer",
      value: 1,
    });
    expect(host.telemetryCount).toHaveBeenCalledWith({
      kind: "restored",
      key: "",
      value: 1,
    });
  });

  it("is a no-op everywhere the host cannot answer", () => {
    host.available = false;
    countAgentLaunch("claude");
    countSurfaceOpen("browser");
    countRestoredSessions();
    const h = makeSources();
    const dispose = installUsageCounterEffects(h.sources);
    h.browser.value = true;
    dispose();
    expect(host.telemetryCount).not.toHaveBeenCalled();
  });

  describe("installUsageCounterEffects", () => {
    it("seeds on the first tick: a boot-persisted open surface is state, not an open", () => {
      const h = makeSources({ browser: true });
      const dispose = installUsageCounterEffects(h.sources);
      expect(surfaceCounts("browser")).toBe(0);
      dispose();
    });

    it("counts a surface on each not-visible → visible edge, so reopen counts again", () => {
      const h = makeSources();
      const dispose = installUsageCounterEffects(h.sources);
      h.browser.value = true;
      expect(surfaceCounts("browser")).toBe(1);
      h.browser.value = false;
      expect(surfaceCounts("browser")).toBe(1);
      h.browser.value = true;
      expect(surfaceCounts("browser")).toBe(2);
      dispose();
    });

    it("reports tab and pane gauges on change only; main folds the maximum", () => {
      const h = makeSources();
      const dispose = installUsageCounterEffects(h.sources);
      expect(host.telemetryCount).toHaveBeenCalledWith({
        kind: "tabs",
        key: "",
        value: 1,
      });
      host.telemetryCount.mockClear();
      h.panes.value = 3;
      expect(host.telemetryCount).toHaveBeenCalledWith({
        kind: "panes",
        key: "",
        value: 3,
      });
      // Tabs did not move, so no second tabs gauge rides along.
      expect(host.telemetryCount.mock.calls.filter(([args]) => args.kind === "tabs")).toHaveLength(
        0,
      );
      dispose();
    });

    it("stops counting after dispose", () => {
      const h = makeSources();
      const dispose = installUsageCounterEffects(h.sources);
      dispose();
      host.telemetryCount.mockClear();
      h.browser.value = true;
      h.tabs.value = 9;
      expect(host.telemetryCount).not.toHaveBeenCalled();
    });
  });
});
