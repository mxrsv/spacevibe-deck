import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDiscovery, type DevServerRow } from "./discovery";
import type { Binding, NativeScan } from "./native";
import {
  createProber,
  type IdentifyOptions,
  type IdentifyResult,
  type ProbeFunction,
} from "./protocol";
import { createDevServerService, type DevServerActivity } from "./service";

const V4_ANY: Binding = { family: "IPv4", address: "0.0.0.0" };
const LAN: Binding = { family: "IPv4", address: "192.168.1.20" };
const START = "Fri Oct 9 21:54:11 2026";

interface Proc {
  readonly pid: number;
  readonly port: number;
  readonly cwd: string | null;
  readonly start?: string | null;
  readonly bindings?: readonly Binding[];
}

const proc = (pid: number, port: number, cwd: string | null, extra: Partial<Proc> = {}): Proc => ({
  pid,
  port,
  cwd,
  ...extra,
});

function makeScan(procs: readonly Proc[]): NativeScan {
  const cwds = new Map<number, string>();
  const identities = new Map<number, { pid: number; ppid: number; startTime: string }>();
  for (const entry of procs) {
    if (entry.cwd !== null) {
      cwds.set(entry.pid, entry.cwd);
    }
    if (entry.start !== null) {
      identities.set(entry.pid, { pid: entry.pid, ppid: 1, startTime: entry.start ?? START });
    }
  }
  return {
    capability: { available: true },
    completeness: "complete",
    listeners: procs.flatMap((entry) =>
      (entry.bindings ?? [V4_ANY]).map((binding) => ({
        pid: entry.pid,
        port: entry.port,
        binding,
      })),
    ),
    metadata: "complete",
    cwds,
    identities,
    diagnostics: [],
  };
}

const HTTP: IdentifyResult = { protocol: "http", status: 200 };

function setup(options: { platform?: string; probe?: ReturnType<typeof vi.fn> } = {}) {
  let scan = makeScan([]);
  const collect = vi.fn(async () => scan);
  const discovery = createDiscovery({
    collect,
    clock: () => Date.now(),
    realpath: async (target) => target,
    salt: "salt",
    platform: options.platform ?? "darwin",
  });
  const probe = options.probe ?? vi.fn(async (): Promise<IdentifyResult> => ({ ...HTTP }));
  const prober = createProber({ probe: probe as unknown as ProbeFunction });
  let active = true;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const activity: DevServerActivity = {
    isActive: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    },
  };
  const service = createDevServerService({ discovery, prober, activity });
  return {
    service,
    discovery,
    prober,
    probe,
    collect,
    unsubscribe,
    listeners,
    setScan: (next: NativeScan) => {
      scan = next;
    },
    setActive: (next: boolean) => {
      active = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    rows: (sender = "w1"): readonly DevServerRow[] => service.snapshot(sender).rows,
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lifecycle and cadence", () => {
  it("scans immediately on first interest, then every 3 s while the app is active", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.collect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.collect).toHaveBeenCalledTimes(3);
    expect(h.service.isObserving()).toBe(true);
  });

  it("slows to 15 s in the background and refreshes at once on focus", async () => {
    const h = setup();
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    h.setActive(false);
    await vi.advanceTimersByTimeAsync(3_000);
    // The 3 s timer was armed while active and fires once; the next wait is 15 s.
    expect(h.collect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(h.collect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.collect).toHaveBeenCalledTimes(3);
    h.setActive(true);
    await flush();
    expect(h.collect).toHaveBeenCalledTimes(4);
  });

  it("keeps a row seen in the background running while a refocus scan is pending", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    h.setActive(false);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.rows()[0]?.liveness).toBe("running");
    // Focus restores the 3 s cadence before the immediate scan has committed.
    h.setActive(true);
    expect(h.rows()[0]?.liveness).toBe("running");
    expect(h.service.snapshot("w1").diagnostics.map((note) => note.code)).not.toContain(
      "scan-stale",
    );
  });

  it("does not scan with no roots and stops on an empty root list", async () => {
    const h = setup();
    await h.service.setRoots("w1", []);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.collect).not.toHaveBeenCalled();
    expect(h.service.isObserving()).toBe(false);
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.service.isObserving()).toBe(true);
    await h.service.setRoots("w1", []);
    expect(h.service.isObserving()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one collector across senders and keeps going until the last release", async () => {
    const h = setup();
    await Promise.all([h.service.setRoots("w1", ["/p"]), h.service.setRoots("w2", ["/q"])]);
    await flush();
    expect(h.collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.collect).toHaveBeenCalledTimes(2);
    h.service.release("w1");
    expect(h.service.isObserving()).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.collect).toHaveBeenCalledTimes(3);
    h.service.release("w2");
    h.service.release("w2");
    expect(h.service.isObserving()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.collect).toHaveBeenCalledTimes(3);
  });

  it("forgets what it saw on the last release, so a restart starts clean", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.rows()).toHaveLength(1);
    h.service.release("w1");
    h.setScan(makeScan([]));
    await h.service.setRoots("w1", ["/p"]);
    expect(h.rows()).toEqual([]);
    await flush();
    expect(h.rows()).toEqual([]);
  });

  it("reports unsupported platforms as unavailable and never scans or probes", async () => {
    for (const platform of ["win32", "linux"]) {
      const h = setup({ platform });
      const result = await h.service.setRoots("w1", ["/p"]);
      expect(result.capability).toMatchObject({ available: false, reason: "unsupported-platform" });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.collect).not.toHaveBeenCalled();
      expect(h.service.isObserving()).toBe(false);
      expect(await h.service.resolve("w1", "srv-1", "x")).toEqual({
        status: "unavailable",
        reason: "unsupported-platform",
      });
      expect(h.service.snapshot("w1").capability.available).toBe(false);
    }
  });

  it("answers an unregistered sender with an explicit not-registered snapshot", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    const snapshot = h.service.snapshot("w2");
    expect(snapshot.generation).toBe(0);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.completeness).toBe("pending");
    expect(snapshot.diagnostics[0]?.code).toBe("scan-skipped");
    expect(h.collect).toHaveBeenCalledTimes(1);
  });
});

describe("protocol enrichment", () => {
  it("publishes the listener first and enriches afterwards", async () => {
    let release: (result: IdentifyResult) => void = () => {};
    const probe = vi.fn(
      () =>
        new Promise<IdentifyResult>((resolve) => {
          release = resolve;
        }),
    );
    const h = setup({ probe });
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.rows()).toMatchObject([{ liveness: "running", protocol: "unknown", url: null }]);
    release({ ...HTTP });
    await flush();
    expect(h.rows()).toMatchObject([{ protocol: "http", url: "http://127.0.0.1:3000/" }]);
  });

  it("probes only rows a sender can see", async () => {
    const h = setup();
    h.setScan(
      makeScan([proc(10, 3000, "/p/app"), proc(11, 4000, "/elsewhere"), proc(12, 5000, null)]),
    );
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.probe).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
      expect.anything(),
    );
  });

  it("does not probe an endpoint nobody can reach on loopback, and says why", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app", { bindings: [LAN] })]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.rows()).toMatchObject([
      { protocol: "unknown", url: null, identificationError: "non-loopback" },
    ]);
  });

  it("keeps probes to four at a time without delaying listener rows", async () => {
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const probe = vi.fn(async (): Promise<IdentifyResult> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active -= 1;
      return { ...HTTP };
    });
    const h = setup({ probe });
    h.setScan(makeScan(Array.from({ length: 6 }, (_, i) => proc(10 + i, 3000 + i, `/p/app${i}`))));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    expect(h.rows()).toHaveLength(6);
    expect(peak).toBe(4);
    expect(active).toBe(4);
    gates.splice(0).forEach((open) => open());
    await flush();
    gates.splice(0).forEach((open) => open());
    await flush();
    expect(h.rows().every((row) => row.protocol === "http")).toBe(true);
    expect(peak).toBe(4);
  });

  it("aborts in-flight probes on the last release and ignores their late answers", async () => {
    const signals: AbortSignal[] = [];
    let finish: (result: IdentifyResult) => void = () => {};
    const probe = vi.fn((_target: unknown, options: IdentifyOptions) => {
      signals.push(options.signal as AbortSignal);
      return new Promise<IdentifyResult>((resolve) => {
        finish = resolve;
      });
    });
    const h = setup({ probe });
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    h.service.release("w1");
    expect(signals[0]?.aborted).toBe(true);
    // Observation restarts; the old probe answers late and must not touch the new rows.
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    finish({ ...HTTP });
    await flush();
    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(h.rows()[0]?.url).toBe("http://127.0.0.1:3000/");
  });

  it("forgets a probed instance when it leaves every sender's view", async () => {
    const h = setup();
    const forget = vi.spyOn(h.prober, "forget");
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    const id = h.rows()[0]?.id ?? "";
    await h.service.setRoots("w1", ["/other"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(forget).toHaveBeenCalledWith(id);
  });

  it("re-probes when discovery dropped a protocol the prober still caches", async () => {
    const h = setup();
    const forget = vi.spyOn(h.prober, "forget");
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    const id = h.rows()[0]?.id ?? "";
    expect(h.rows()[0]?.protocol).toBe("http");
    // The process is still listed but its start time cannot be read: continuity is
    // unproven, so discovery drops the protocol.
    h.setScan(makeScan([proc(10, 3000, "/p/app", { start: null })]));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(forget).toHaveBeenCalledWith(id);
    expect(h.probe).toHaveBeenCalledTimes(2);
  });
});

describe("resolve", () => {
  async function ready() {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    const row = h.rows()[0] as DevServerRow;
    return { h, row };
  }

  it("rescans, reprobes and returns the verified URL", async () => {
    const { h, row } = await ready();
    const before = { scans: h.collect.mock.calls.length, probes: h.probe.mock.calls.length };
    expect(await h.service.resolve("w1", row.id, row.instanceToken)).toEqual({
      status: "ready",
      id: row.id,
      url: "http://127.0.0.1:3000/",
      protocol: "http",
    });
    expect(h.collect.mock.calls.length).toBe(before.scans + 1);
    expect(h.probe.mock.calls.length).toBe(before.probes + 1);
  });

  it("is stale for an unknown id, a wrong token and another window's row", async () => {
    const { h, row } = await ready();
    await h.service.setRoots("w2", ["/q"]);
    expect(await h.service.resolve("w1", "srv-zz", row.instanceToken)).toEqual({ status: "stale" });
    expect(await h.service.resolve("w1", row.id, "0000")).toEqual({ status: "stale" });
    expect(await h.service.resolve("w2", row.id, row.instanceToken)).toEqual({ status: "stale" });
  });

  it("refuses a takeover instead of handing out the new owner's URL", async () => {
    const { h, row } = await ready();
    h.setScan(makeScan([proc(20, 3000, "/p/app", { start: "Fri Oct 9 22:30:00 2026" })]));
    expect(await h.service.resolve("w1", row.id, row.instanceToken)).toEqual({
      status: "unavailable",
      reason: "not-running",
    });
  });

  it("returns unknown-protocol when the listener answers nothing HTTP", async () => {
    const { h, row } = await ready();
    h.probe.mockResolvedValue({ protocol: "unknown", error: "not-http" });
    expect(await h.service.resolve("w1", row.id, row.instanceToken)).toEqual({
      status: "unknown-protocol",
      error: "not-http",
    });
    expect(h.rows()[0]).toMatchObject({ protocol: "unknown", url: null });
  });

  it("reports an incomplete scan as such, not as a stopped server", async () => {
    const { h, row } = await ready();
    await vi.advanceTimersByTimeAsync(1);
    h.setScan({ ...makeScan([]), completeness: "failed" });
    expect(await h.service.resolve("w1", row.id, row.instanceToken)).toEqual({
      status: "unavailable",
      reason: "scan-incomplete",
    });
  });

  it("waits out a scan already running and then scans again", async () => {
    const { h, row } = await ready();
    const gates: Array<() => void> = [];
    h.collect.mockImplementation(
      () =>
        new Promise<NativeScan>((resolve) => {
          gates.push(() => resolve(makeScan([proc(10, 3000, "/p/app")])));
        }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(gates).toHaveLength(1);
    const resolved = h.service.resolve("w1", row.id, row.instanceToken);
    await flush();
    gates.shift()?.();
    await flush();
    expect(gates).toHaveLength(1);
    gates.shift()?.();
    expect(await resolved).toMatchObject({ status: "ready" });
  });

  it("is unavailable once the service is disposed", async () => {
    const { h, row } = await ready();
    h.service.dispose();
    expect(await h.service.resolve("w1", row.id, row.instanceToken)).toEqual({
      status: "unavailable",
      reason: "observation-stopped",
    });
  });
});

describe("dispose", () => {
  it("is terminal: clears timers, aborts work and refuses new roots", async () => {
    const h = setup();
    h.setScan(makeScan([proc(10, 3000, "/p/app")]));
    await h.service.setRoots("w1", ["/p"]);
    await flush();
    h.service.dispose();
    h.service.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect((await h.service.setRoots("w1", ["/p"])).applied).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.collect).toHaveBeenCalledTimes(1);
  });
});
