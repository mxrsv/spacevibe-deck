import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACTIVE_SCAN_INTERVAL_MS,
  BACKGROUND_SCAN_INTERVAL_MS,
  MAX_STOPPED_ROWS,
  STOPPED_RETENTION_MS,
  createDiscovery,
  scanIntervalMs,
  type DevServerEnrichment,
  type DevServerRow,
} from "./discovery";
import type { Binding, NativeScan, ScanCompleteness } from "./native";

interface Proc {
  readonly pid: number;
  readonly port: number;
  readonly cwd?: string | null;
  readonly start?: string | null;
  readonly bindings?: readonly Binding[];
}

const V4_ANY: Binding = { family: "IPv4", address: "0.0.0.0" };
const V6_ANY: Binding = { family: "IPv6", address: "::" };
const START = "Fri Oct 9 21:54:11 2026";
const HTTP: DevServerEnrichment = { protocol: "http", url: "http://127.0.0.1:3000/", error: null };

function makeScan(
  procs: readonly Proc[],
  completeness: ScanCompleteness = "complete",
  metadata: ScanCompleteness = "complete",
): NativeScan {
  const cwds = new Map<number, string>();
  const identities = new Map<number, { pid: number; ppid: number; startTime: string }>();
  for (const proc of procs) {
    if (proc.cwd !== null && proc.cwd !== undefined) {
      cwds.set(proc.pid, proc.cwd);
    }
    if (proc.start !== null) {
      identities.set(proc.pid, { pid: proc.pid, ppid: 1, startTime: proc.start ?? START });
    }
  }
  return {
    capability: { available: true },
    completeness,
    listeners: procs.flatMap((proc) =>
      (proc.bindings ?? [V4_ANY]).map((binding) => ({ pid: proc.pid, port: proc.port, binding })),
    ),
    metadata,
    cwds,
    identities,
    diagnostics: [],
  };
}

function harness(options: { platform?: string; realpath?: (p: string) => Promise<string> } = {}) {
  let now = 1_000_000;
  const queue: NativeScan[] = [];
  let last = makeScan([]);
  const collect = vi.fn(async () => {
    last = queue.shift() ?? last;
    return last;
  });
  const discovery = createDiscovery({
    collect,
    clock: () => now,
    realpath: options.realpath ?? (async (p) => p),
    salt: "test-salt",
    platform: options.platform ?? "darwin",
  });
  return {
    discovery,
    collect,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    /** Run one scan that reports `scan`, then move the clock one active interval. */
    async scan(next: NativeScan) {
      queue.push(next);
      const result = await discovery.scanOnce();
      now += ACTIVE_SCAN_INTERVAL_MS;
      return result;
    },
  };
}

async function watching(roots: readonly string[], options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options);
  await h.discovery.setRoots("w1", roots);
  return h;
}

const rowsOf = (h: ReturnType<typeof harness>, sender = "w1"): readonly DevServerRow[] =>
  h.discovery.snapshotFor(sender).rows;

describe("capability and interest", () => {
  it("is unavailable on win32 and linux, runs nothing and says why", async () => {
    for (const platform of ["win32", "linux"]) {
      const h = await watching(["/p"], { platform });
      expect(await h.discovery.scanOnce()).toEqual({ status: "skipped", reason: "unavailable" });
      expect(h.collect).not.toHaveBeenCalled();
      const snapshot = h.discovery.snapshotFor("w1");
      expect(snapshot.capability).toEqual({
        available: false,
        reason: "unsupported-platform",
        platform,
      });
      expect(snapshot.rows).toEqual([]);
      expect(snapshot.diagnostics[0]?.code).toBe("unsupported-platform");
    }
  });

  it("does not scan with no roots, and reports pending before the first scan", async () => {
    const h = harness();
    expect(h.discovery.hasInterest()).toBe(false);
    expect(await h.discovery.scanOnce()).toEqual({ status: "skipped", reason: "no-interest" });
    expect(h.collect).not.toHaveBeenCalled();
    await h.discovery.setRoots("w1", ["/p"]);
    const snapshot = h.discovery.snapshotFor("w1");
    expect(snapshot).toMatchObject({
      completeness: "pending",
      metadata: "pending",
      observedAt: null,
    });
    expect(snapshot.diagnostics.map((note) => note.code)).toEqual(["scan-pending"]);
  });

  it("exposes the cadence constants", () => {
    expect(scanIntervalMs("active")).toBe(3_000);
    expect(scanIntervalMs("background")).toBe(15_000);
    expect(STOPPED_RETENTION_MS).toBe(60_000);
    expect(MAX_STOPPED_ROWS).toBe(100);
  });
});

describe("attribution", () => {
  it("shows a running server under its root and never invents stopped rows", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    expect(rowsOf(h)).toHaveLength(1);
    expect(rowsOf(h)[0]).toMatchObject({
      workspacePath: "/p",
      displayRoot: "/p",
      port: 3000,
      liveness: "running",
      protocol: "unknown",
      url: null,
      stoppedAt: null,
    });
    expect(rowsOf(h).filter((row) => row.liveness === "stopped")).toEqual([]);
  });

  it("gives each sender the server under its own deepest root", async () => {
    const h = await watching(["/p"]);
    await h.discovery.setRoots("w2", ["/p/packages/web"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/p" },
        { pid: 11, port: 3001, cwd: "/p/packages/web" },
      ]),
    );
    expect(rowsOf(h, "w1").map((row) => [row.port, row.workspacePath])).toEqual([
      [3000, "/p"],
      [3001, "/p"],
    ]);
    expect(rowsOf(h, "w2").map((row) => [row.port, row.workspacePath])).toEqual([
      [3001, "/p/packages/web"],
    ]);
  });

  it("prefers the deepest root inside one sender", async () => {
    const h = await watching(["/p", "/p/packages/web"]);
    await h.scan(makeScan([{ pid: 11, port: 3001, cwd: "/p/packages/web/src" }]));
    expect(rowsOf(h)[0]?.workspacePath).toBe("/p/packages/web");
  });

  it("does not attribute by string prefix, unknown cwd or system listeners", async () => {
    const h = await watching(["/p"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/p-other" },
        { pid: 11, port: 3001, cwd: null },
        { pid: 12, port: 3002, cwd: "/" },
      ]),
    );
    expect(rowsOf(h)).toEqual([]);
  });

  it("keeps two worktrees of one repo distinct", async () => {
    const h = await watching(["/repo", "/repo-wt"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/repo" },
        { pid: 11, port: 3001, cwd: "/repo-wt" },
        { pid: 12, port: 3002, cwd: "/repo-wt" },
      ]),
    );
    expect(rowsOf(h).map((row) => [row.port, row.workspacePath])).toEqual([
      [3000, "/repo"],
      [3001, "/repo-wt"],
      [3002, "/repo-wt"],
    ]);
  });

  it("resolves a symlinked root through the real filesystem", async () => {
    const real = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deck-disc-")));
    const holder = fs.mkdtempSync(path.join(os.tmpdir(), "deck-disc-link-"));
    const link = path.join(holder, "project");
    fs.symlinkSync(real, link);
    try {
      const h = harness({ realpath: fs.promises.realpath });
      await h.discovery.setRoots("w1", [link]);
      await h.scan(makeScan([{ pid: 10, port: 3000, cwd: path.join(real, "packages", "web") }]));
      expect(rowsOf(h)[0]).toMatchObject({ workspacePath: real, displayRoot: link });
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
      fs.rmSync(holder, { recursive: true, force: true });
    }
  });

  it("surfaces root diagnostics instead of an empty success", async () => {
    const h = harness({
      realpath: async () => {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      },
    });
    const result = await h.discovery.setRoots("w1", ["/gone", 5]);
    expect(result.rootDiagnostics.map((entry) => entry.code)).toEqual(["not-found", "invalid"]);
    expect(h.discovery.snapshotFor("w1").rootDiagnostics).toHaveLength(2);
  });
});

describe("lifecycle", () => {
  it("is unknown after one complete miss and stopped after two", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    await h.scan(makeScan([]));
    expect(rowsOf(h)[0]?.liveness).toBe("unknown");
    await h.scan(makeScan([]));
    expect(rowsOf(h)[0]).toMatchObject({ liveness: "stopped" });
    expect(rowsOf(h)[0]?.stoppedAt).not.toBeNull();
  });

  it("treats a partial scan between two misses as breaking the run", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    await h.scan(makeScan([]));
    await h.scan(makeScan([], "partial"));
    await h.scan(makeScan([]));
    expect(rowsOf(h)[0]?.liveness).toBe("unknown");
    await h.scan(makeScan([]));
    expect(rowsOf(h)[0]?.liveness).toBe("stopped");
  });

  it("never advances absence on partial or failed scans, then goes unknown by staleness", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    for (const completeness of ["failed", "partial", "failed", "failed"] as const) {
      await h.scan(makeScan([], completeness));
    }
    expect(rowsOf(h)[0]?.liveness).not.toBe("stopped");
    expect(rowsOf(h)[0]?.liveness).toBe("unknown");
    expect(h.discovery.snapshotFor("w1").completeness).toBe("failed");
  });

  it("goes stale after twice the interval and honours the background cadence", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    h.advance(ACTIVE_SCAN_INTERVAL_MS - 1);
    expect(rowsOf(h)[0]?.liveness).toBe("running");
    h.advance(2 * ACTIVE_SCAN_INTERVAL_MS);
    expect(rowsOf(h)[0]?.liveness).toBe("unknown");
    expect(h.discovery.snapshotFor("w1").diagnostics.map((note) => note.code)).toContain(
      "scan-stale",
    );
    h.discovery.setCadence("background");
    expect(h.discovery.intervalMs()).toBe(BACKGROUND_SCAN_INTERVAL_MS);
    expect(rowsOf(h)[0]?.liveness).toBe("running");
  });

  it("recovers to running when a missed server is seen again", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    await h.scan(makeScan([]));
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    expect(rowsOf(h)[0]?.liveness).toBe("running");
  });

  it("drops a stopped row after the retention window", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    await h.scan(makeScan([]));
    await h.scan(makeScan([]));
    expect(rowsOf(h)).toHaveLength(1);
    h.advance(STOPPED_RETENTION_MS);
    await h.scan(makeScan([]));
    expect(rowsOf(h)).toEqual([]);
  });

  it("keeps at most the newest 100 stopped rows", async () => {
    const h = await watching(["/p"]);
    const first = Array.from({ length: MAX_STOPPED_ROWS + 5 }, (_, index) => ({
      pid: 100 + index,
      port: 4000 + index,
      cwd: "/p",
    }));
    await h.scan(makeScan(first));
    await h.scan(makeScan([]));
    await h.scan(makeScan([]));
    expect(rowsOf(h)).toHaveLength(MAX_STOPPED_ROWS);
    expect(rowsOf(h).every((row) => row.liveness === "stopped")).toBe(true);
  });

  it("does not keep a stopped entry for a process outside every root", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/elsewhere" }]));
    await h.scan(makeScan([]));
    await h.scan(makeScan([]));
    await h.discovery.setRoots("w1", ["/elsewhere"]);
    expect(rowsOf(h)).toEqual([]);
  });

  it("turns a collector exception into a failed scan that cannot stop anything", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    h.collect.mockRejectedValueOnce(new Error("boom"));
    expect(await h.discovery.scanOnce()).toMatchObject({ status: "scanned" });
    expect(h.discovery.snapshotFor("w1").completeness).toBe("failed");
    expect(rowsOf(h)[0]?.liveness).toBe("running");
  });
});

describe("instance identity", () => {
  it("does not count a missing start time or cwd as absence and keeps one row", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    const id = rowsOf(h)[0]?.id;
    for (let index = 0; index < 3; index += 1) {
      await h.scan(
        makeScan([{ pid: 10, port: 3000, cwd: null, start: null }], "complete", "partial"),
      );
    }
    expect(rowsOf(h)).toHaveLength(1);
    expect(rowsOf(h)[0]).toMatchObject({ id, liveness: "running" });
  });

  it("drops cached protocol when continuity cannot be verified", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    const token = rowsOf(h)[0]?.instanceToken ?? "";
    expect(h.discovery.setEnrichment(token, HTTP)).toBe(true);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    expect(rowsOf(h)[0]).toMatchObject({ protocol: "http", url: HTTP.url });
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p", start: null }]));
    expect(rowsOf(h)[0]).toMatchObject({ protocol: "unknown", url: null });
  });

  it("treats a changed start time on the same pid and port as a new instance", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    const old = rowsOf(h)[0];
    h.discovery.setEnrichment(old?.instanceToken ?? "", HTTP);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p", start: "Sat Oct 10 01:00:00 2026" }]));
    const rows = rowsOf(h);
    const fresh = rows.find((row) => row.id !== old?.id);
    expect(fresh).toMatchObject({ liveness: "running", protocol: "unknown", url: null });
    expect(rows.find((row) => row.id === old?.id)?.liveness).toBe("unknown");
    expect(h.discovery.findRow("w1", old?.id ?? "", old?.instanceToken ?? "")?.liveness).toBe(
      "unknown",
    );
  });

  it("does not hand a takeover's endpoint the previous process's cached protocol", async () => {
    const h = await watching(["/a", "/b"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/a" }]));
    h.discovery.setEnrichment(rowsOf(h)[0]?.instanceToken ?? "", HTTP);
    await h.scan(makeScan([{ pid: 20, port: 3000, cwd: "/b", start: "Sat Oct 10 01:00:00 2026" }]));
    await h.scan(makeScan([{ pid: 20, port: 3000, cwd: "/b", start: "Sat Oct 10 01:00:00 2026" }]));
    const rows = rowsOf(h);
    expect(rows.find((row) => row.workspacePath === "/b")).toMatchObject({
      protocol: "unknown",
      liveness: "running",
    });
    expect(rows.find((row) => row.workspacePath === "/a")?.liveness).toBe("stopped");
  });

  it("rejects enrichment for a stopped instance or an unknown token", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    const token = rowsOf(h)[0]?.instanceToken ?? "";
    expect(h.discovery.setEnrichment("nope", HTTP)).toBe(false);
    await h.scan(makeScan([]));
    await h.scan(makeScan([]));
    expect(h.discovery.setEnrichment(token, HTTP)).toBe(false);
  });

  it("merges separate IPv4 and IPv6 sockets of one process into one row", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 7000, cwd: "/p", bindings: [V6_ANY, V4_ANY] }]));
    expect(rowsOf(h)).toHaveLength(1);
    expect(rowsOf(h)[0]?.bindings).toEqual([V4_ANY, V6_ANY]);
  });
});

describe("shared endpoints", () => {
  it("keeps one row per process and flags a cluster in one project as shared", async () => {
    const h = await watching(["/p"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/p", bindings: [V6_ANY] },
        { pid: 11, port: 3000, cwd: "/p", bindings: [V6_ANY] },
        { pid: 12, port: 3000, cwd: "/p", bindings: [V6_ANY] },
      ]),
    );
    expect(rowsOf(h)).toHaveLength(3);
    expect(rowsOf(h).every((row) => row.sharedEndpoint)).toBe(true);
  });

  it("withholds an endpoint shared by two projects and says so", async () => {
    const h = await watching(["/a", "/b"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/a" },
        { pid: 11, port: 3000, cwd: "/b" },
      ]),
    );
    expect(rowsOf(h)).toEqual([]);
    expect(h.discovery.snapshotFor("w1").diagnostics.map((note) => note.code)).toContain(
      "ambiguous-endpoint",
    );
  });

  it("withholds when the other holder is outside the sender's roots or unreadable", async () => {
    const h = await watching(["/a"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/a" },
        { pid: 11, port: 3000, cwd: "/outside" },
        { pid: 12, port: 3001, cwd: "/a" },
        { pid: 13, port: 3001, cwd: null },
      ]),
    );
    expect(rowsOf(h)).toEqual([]);
  });

  it("does not treat different address families on one port as shared", async () => {
    const h = await watching(["/a", "/b"]);
    await h.scan(
      makeScan([
        { pid: 10, port: 5173, cwd: "/a", bindings: [{ family: "IPv4", address: "127.0.0.1" }] },
        { pid: 11, port: 5173, cwd: "/b", bindings: [{ family: "IPv6", address: "::1" }] },
      ]),
    );
    expect(rowsOf(h).map((row) => row.workspacePath)).toEqual(["/a", "/b"]);
  });
});

describe("senders, generations and races", () => {
  it("gives every setRoots a new generation and filters per sender", async () => {
    const h = harness();
    const a = await h.discovery.setRoots("w1", ["/a"]);
    const b = await h.discovery.setRoots("w2", ["/b"]);
    const a2 = await h.discovery.setRoots("w1", ["/a"]);
    expect(new Set([a.generation, b.generation, a2.generation]).size).toBe(3);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/a" },
        { pid: 11, port: 3001, cwd: "/b" },
      ]),
    );
    expect(rowsOf(h, "w1").map((row) => row.port)).toEqual([3000]);
    expect(rowsOf(h, "w2").map((row) => row.port)).toEqual([3001]);
    expect(h.discovery.snapshotFor("w1").generation).toBe(a2.generation);
    expect(h.discovery.snapshotFor("nobody").rows).toEqual([]);
  });

  it("lets the last setRoots win even if an earlier one resolves later", async () => {
    let releaseFirst: (value: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });
    const h = harness({ realpath: (p) => (p === "/slow" ? slow : Promise.resolve(p)) });
    const first = h.discovery.setRoots("w1", ["/slow"]);
    const second = await h.discovery.setRoots("w1", ["/fast"]);
    releaseFirst("/slow");
    expect(await first).toMatchObject({ applied: false });
    expect(second.applied).toBe(true);
    await h.scan(
      makeScan([
        { pid: 10, port: 3000, cwd: "/slow" },
        { pid: 11, port: 3001, cwd: "/fast" },
      ]),
    );
    expect(rowsOf(h).map((row) => row.workspacePath)).toEqual(["/fast"]);
  });

  it("invalidates a pending setRoots when the sender is released", async () => {
    let finish: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const h = harness({ realpath: () => pending });
    const call = h.discovery.setRoots("w1", ["/p"]);
    h.discovery.releaseSender("w1");
    h.discovery.releaseSender("w1");
    finish("/p");
    expect(await call).toMatchObject({ applied: false });
    expect(h.discovery.hasInterest()).toBe(false);
  });

  it("stops being interested after the last release and one window keeps its rows", async () => {
    const h = await watching(["/a"]);
    await h.discovery.setRoots("w2", ["/a"]);
    h.discovery.releaseSender("w1");
    expect(h.discovery.hasInterest()).toBe(true);
    h.discovery.releaseSender("w2");
    expect(h.discovery.hasInterest()).toBe(false);
  });

  it("shares one scan between concurrent callers", async () => {
    const h = await watching(["/p"]);
    const [a, b] = await Promise.all([h.discovery.scanOnce(), h.discovery.scanOnce()]);
    expect(h.collect).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("discards a scan that returns after dispose", async () => {
    let finish: (scan: NativeScan) => void = () => undefined;
    const slow = new Promise<NativeScan>((resolve) => {
      finish = resolve;
    });
    const discovery = createDiscovery({
      collect: () => slow,
      realpath: async (p) => p,
      platform: "darwin",
    });
    await discovery.setRoots("w1", ["/p"]);
    const scanning = discovery.scanOnce();
    discovery.dispose();
    finish(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    expect(await scanning).toEqual({ status: "discarded" });
    expect(discovery.snapshotFor("w1").rows).toEqual([]);
    expect((await discovery.setRoots("w1", ["/p"])).applied).toBe(false);
  });
});

describe("snapshots", () => {
  it("are frozen and unaffected by later scans", async () => {
    const h = await watching(["/p"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/p" }]));
    const before = h.discovery.snapshotFor("w1");
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.rows)).toBe(true);
    expect(Object.isFrozen(before.rows[0])).toBe(true);
    await h.scan(makeScan([]));
    await h.scan(makeScan([]));
    expect(before.rows[0]?.liveness).toBe("running");
    expect(h.discovery.snapshotFor("w1").rows[0]?.liveness).toBe("stopped");
    expect(h.discovery.snapshotFor("w1").sequence).toBe(before.sequence + 2);
  });

  it("separates metadata gaps from listener completeness", async () => {
    const h = await watching(["/p"]);
    const scan = {
      ...makeScan([{ pid: 10, port: 3000, cwd: "/p" }], "complete", "partial"),
      diagnostics: [{ code: "cwd-unavailable" as const, message: "1 process" }],
    };
    await h.scan(scan);
    const snapshot = h.discovery.snapshotFor("w1");
    expect(snapshot).toMatchObject({ completeness: "complete", metadata: "partial" });
    expect(snapshot.diagnostics.map((note) => note.code)).toContain("cwd-unavailable");
  });

  it("finds a row only for the sender that sees it and only with the right token", async () => {
    const h = await watching(["/a"]);
    await h.discovery.setRoots("w2", ["/b"]);
    await h.scan(makeScan([{ pid: 10, port: 3000, cwd: "/a" }]));
    const row = rowsOf(h)[0];
    expect(h.discovery.findRow("w1", row?.id ?? "", row?.instanceToken ?? "")).not.toBeNull();
    expect(h.discovery.findRow("w1", row?.id ?? "", "forged")).toBeNull();
    expect(h.discovery.findRow("w2", row?.id ?? "", row?.instanceToken ?? "")).toBeNull();
  });
});
