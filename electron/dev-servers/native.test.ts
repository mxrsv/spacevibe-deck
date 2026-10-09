import { describe, expect, it, vi } from "vitest";
import {
  LISTENER_OUTPUT_CAP_BYTES,
  LSOF_PATH,
  MAX_CANDIDATE_PIDS,
  PID_BATCH_SIZE,
  PS_PATH,
  collectNative,
  execNative,
  nativeCapability,
  parseCwds,
  parseEndpointName,
  parseIdentities,
  parseListeners,
  readListeners,
  type ExecFn,
  type ExecOutcome,
} from "./native";

// Output captured from the C1 fixtures on macOS 27.2 (lsof 4.91).
const LISTENER_OUTPUT = [
  "p450",
  "f12",
  "tIPv6",
  "n*:65100",
  "p452",
  "f12",
  "tIPv4",
  "n127.0.0.1:65101",
  "p454",
  "f12",
  "tIPv6",
  "n[::1]:65103",
  "p684",
  "f10",
  "tIPv4",
  "n*:7000",
  "f11",
  "tIPv6",
  "n*:7000",
  "",
].join("\n");

const CWD_OUTPUT =
  "p450\nfcwd\nn/private/tmp/c1/projA\np452\nfcwd\nn/private/tmp/c1/projA/packages/web\n";

const PS_OUTPUT =
  "  450     1 Fri Oct  9 21:54:11 2026\n  452     1 Fri Oct  9 21:54:11 2026\n  454   450 Sat Oct 10 03:04:05 2026\n";

const exit = (stdout: string, code = 0, stderr = ""): ExecOutcome => ({
  kind: "exit",
  code,
  stdout,
  stderr,
});

interface Calls {
  readonly file: string;
  readonly args: readonly string[];
}

/** Scripted runner: one outcome per tool, recording every invocation. */
function fakeExec(handlers: {
  listeners?: ExecOutcome;
  cwd?: ExecOutcome | ((args: readonly string[]) => ExecOutcome);
  ps?: ExecOutcome | ((args: readonly string[]) => ExecOutcome);
}): { exec: ExecFn; calls: Calls[] } {
  const calls: Calls[] = [];
  const pick = (
    handler: ExecOutcome | ((args: readonly string[]) => ExecOutcome) | undefined,
    args: readonly string[],
  ): ExecOutcome => (typeof handler === "function" ? handler(args) : (handler ?? exit("", 1)));
  const exec: ExecFn = async (file, args) => {
    calls.push({ file, args });
    if (file === PS_PATH) {
      return pick(handlers.ps, args);
    }
    return args.includes("cwd") ? pick(handlers.cwd, args) : (handlers.listeners ?? exit("", 1));
  };
  return { exec, calls };
}

describe("parseEndpointName", () => {
  it("normalises wildcard per family and strips IPv6 brackets", () => {
    expect(parseEndpointName("*:7000", "IPv4")).toEqual({
      binding: { family: "IPv4", address: "0.0.0.0" },
      port: 7000,
    });
    expect(parseEndpointName("*:7000", "IPv6")).toEqual({
      binding: { family: "IPv6", address: "::" },
      port: 7000,
    });
    expect(parseEndpointName("[::1]:65103", "IPv6")?.binding.address).toBe("::1");
    expect(parseEndpointName("127.0.0.1:5199", "IPv4")?.port).toBe(5199);
  });

  it("rejects bad ports and family mismatches", () => {
    expect(parseEndpointName("127.0.0.1:0", "IPv4")).toBeNull();
    expect(parseEndpointName("127.0.0.1:70000", "IPv4")).toBeNull();
    expect(parseEndpointName("[::1]:80", "IPv4")).toBeNull();
    expect(parseEndpointName("127.0.0.1:80", "IPv6")).toBeNull();
    expect(parseEndpointName("localhost", "IPv4")).toBeNull();
  });
});

describe("parseListeners", () => {
  it("reads one record per socket and keeps v4 and v6 sockets of one pid", () => {
    const { listeners, skipped } = parseListeners(LISTENER_OUTPUT, false);
    expect(skipped).toBe(0);
    expect(listeners).toHaveLength(5);
    const controlCenter = listeners.filter((listener) => listener.pid === 684);
    expect(controlCenter.map((listener) => listener.binding.family)).toEqual(["IPv4", "IPv6"]);
  });

  it("deduplicates an identical socket reported twice", () => {
    const doubled = "p1\nf1\ntIPv4\nn127.0.0.1:80\nf2\ntIPv4\nn127.0.0.1:80\n";
    expect(parseListeners(doubled, false).listeners).toHaveLength(1);
  });

  it("counts malformed records instead of inventing listeners", () => {
    const { listeners, skipped } = parseListeners(
      "pabc\nf1\ntIPv4\nn127.0.0.1:80\np2\nf1\nn127.0.0.1:81\n",
      false,
    );
    expect(listeners).toHaveLength(0);
    expect(skipped).toBe(3);
  });

  it("drops the unterminated trailing segment of a truncated stream", () => {
    const cut = "p1\nf1\ntIPv4\nn127.0.0.1:80\np2\nf1\ntIPv4\nn127.0.0.1:81";
    expect(parseListeners(cut, true).listeners.map((listener) => listener.port)).toEqual([80]);
    expect(parseListeners(cut, false).listeners.map((listener) => listener.port)).toEqual([80, 81]);
  });
});

describe("parseCwds and parseIdentities", () => {
  it("maps pids to canonical cwd paths", () => {
    const cwds = parseCwds(CWD_OUTPUT, false);
    expect(cwds.get(450)).toBe("/private/tmp/c1/projA");
    expect(cwds.get(452)).toBe("/private/tmp/c1/projA/packages/web");
  });

  it("reads parent and an opaque, space-normalised start time", () => {
    const identities = parseIdentities(PS_OUTPUT, false);
    expect(identities.get(450)).toEqual({
      pid: 450,
      ppid: 1,
      startTime: "Fri Oct 9 21:54:11 2026",
    });
    expect(identities.get(454)?.ppid).toBe(450);
  });

  it("skips rows whose start time is not the C-locale format", () => {
    expect(parseIdentities("  450     1 Fr.  9 Okt. 21:54:11 2026\n", false).size).toBe(0);
  });
});

describe("readListeners: empty success versus failure", () => {
  it("treats exit 1 with empty output as a complete empty answer", () => {
    expect(readListeners(exit("", 1))).toMatchObject({ completeness: "complete", listeners: [] });
  });

  it("treats exit 0 with listeners as complete", () => {
    const read = readListeners(exit(LISTENER_OUTPUT));
    expect(read.completeness).toBe("complete");
    expect(read.listeners).toHaveLength(5);
  });

  it("fails on exit 1 with an error message and no output", () => {
    expect(readListeners(exit("", 1, "lsof: illegal option")).completeness).toBe("failed");
  });

  it("fails on missing binary, timeout, other exit codes and spawn errors", () => {
    expect(readListeners({ kind: "missing" }).completeness).toBe("failed");
    expect(readListeners({ kind: "timeout" }).completeness).toBe("failed");
    expect(readListeners(exit("", 2)).completeness).toBe("failed");
    expect(readListeners({ kind: "error", message: "boom" }).completeness).toBe("failed");
  });

  it("is partial, never complete, when stderr speaks on exit 0", () => {
    const read = readListeners(exit(LISTENER_OUTPUT, 0, "lsof: WARNING"));
    expect(read.completeness).toBe("partial");
    expect(read.listeners).toHaveLength(5);
  });

  it("is partial when exit 1 comes with readable output", () => {
    expect(readListeners(exit(LISTENER_OUTPUT, 1)).completeness).toBe("partial");
  });

  it("is partial after an output cap breach and never reports the cut record", () => {
    const stdout = "p1\nf1\ntIPv4\nn127.0.0.1:80\np2\nf1\ntIPv4\nn127.0.0.1:8";
    const read = readListeners({ kind: "overflow", stdout, stderr: "" });
    expect(read.completeness).toBe("partial");
    expect(read.listeners.map((listener) => listener.port)).toEqual([80]);
    expect(read.diagnostics.map((note) => note.code)).toContain("output-truncated");
  });

  it("fails a cap breach with nothing usable", () => {
    expect(readListeners({ kind: "overflow", stdout: "p", stderr: "" }).completeness).toBe(
      "failed",
    );
  });

  it("is partial when some records are unparseable and failed when all are", () => {
    const mixed = LISTENER_OUTPUT + "p9\nf1\ntIPv4\nnnot-an-endpoint\n";
    expect(readListeners(exit(mixed)).completeness).toBe("partial");
    expect(readListeners(exit("garbage\np1\nf1\ntIPv4\nnnope\n")).completeness).toBe("failed");
  });
});

describe("execNative", () => {
  it("runs a fixed executable without a shell and reports exit codes", async () => {
    const ok = await execNative("/bin/echo", ["$HOME;x"], {
      timeoutMs: 2000,
      maxBufferBytes: 1024,
    });
    expect(ok).toEqual({ kind: "exit", code: 0, stdout: "$HOME;x\n", stderr: "" });
    const failed = await execNative("/usr/bin/false", [], {
      timeoutMs: 2000,
      maxBufferBytes: 1024,
    });
    expect(failed).toMatchObject({ kind: "exit", code: 1 });
  });

  it("classifies missing, timeout and overflow in order", async () => {
    expect(
      await execNative("/nonexistent/tool", [], { timeoutMs: 1000, maxBufferBytes: 1024 }),
    ).toEqual({ kind: "missing" });
    expect(await execNative("/bin/sleep", ["5"], { timeoutMs: 100, maxBufferBytes: 1024 })).toEqual(
      { kind: "timeout" },
    );
    const overflow = await execNative("/usr/bin/yes", [], { timeoutMs: 2000, maxBufferBytes: 64 });
    expect(overflow.kind).toBe("overflow");
  });
});

describe("nativeCapability", () => {
  it("is available on darwin and explicitly unavailable elsewhere", () => {
    expect(nativeCapability("darwin")).toEqual({ available: true });
    expect(nativeCapability("win32")).toEqual({
      available: false,
      reason: "unsupported-platform",
      platform: "win32",
    });
    expect(nativeCapability("linux")).toMatchObject({ available: false, platform: "linux" });
  });
});

describe("collectNative", () => {
  it("never runs a tool on win32 or linux", async () => {
    for (const platform of ["win32", "linux"]) {
      const exec = vi.fn<ExecFn>();
      const scan = await collectNative({ exec, platform });
      expect(exec).not.toHaveBeenCalled();
      expect(scan.capability.available).toBe(false);
      expect(scan.listeners).toEqual([]);
      expect(scan.diagnostics[0]?.code).toBe("unsupported-platform");
    }
  });

  it("reads listeners, then cwd and identity only for the listener pids", async () => {
    const { exec, calls } = fakeExec({
      listeners: exit(LISTENER_OUTPUT),
      cwd: exit(CWD_OUTPUT, 1),
      ps: exit(PS_OUTPUT),
    });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(calls[0]).toEqual({
      file: LSOF_PATH,
      args: ["-w", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpftn"],
    });
    expect(calls[1]?.args.at(-2)).toBe("450,452,454,684");
    expect(calls[2]?.file).toBe(PS_PATH);
    expect(scan.completeness).toBe("complete");
    expect(scan.cwds.get(450)).toBe("/private/tmp/c1/projA");
    expect(scan.identities.get(450)?.startTime).toBe("Fri Oct 9 21:54:11 2026");
  });

  it("reports metadata gaps separately and keeps the listener scan complete", async () => {
    const { exec } = fakeExec({
      listeners: exit(LISTENER_OUTPUT),
      cwd: exit(CWD_OUTPUT, 1),
      ps: exit(PS_OUTPUT),
    });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(scan.completeness).toBe("complete");
    expect(scan.metadata).toBe("partial");
    const codes = scan.diagnostics.map((note) => note.code);
    expect(codes).toContain("cwd-unavailable");
    expect(codes).toContain("identity-unavailable");
  });

  it("is metadata-complete when every pid has a cwd and a start time", async () => {
    const only = "p450\nf1\ntIPv4\nn127.0.0.1:3000\n";
    const { exec } = fakeExec({
      listeners: exit(only),
      cwd: exit("p450\nfcwd\nn/a\n", 0),
      ps: exit(PS_OUTPUT),
    });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(scan.metadata).toBe("complete");
  });

  it("marks metadata failed when every metadata command fails", async () => {
    const { exec } = fakeExec({
      listeners: exit(LISTENER_OUTPUT),
      cwd: { kind: "timeout" },
      ps: { kind: "missing" },
    });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(scan.completeness).toBe("complete");
    expect(scan.metadata).toBe("failed");
  });

  it("makes no metadata calls when the listener scan finds nothing", async () => {
    const { exec, calls } = fakeExec({ listeners: exit("", 1) });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(calls).toHaveLength(1);
    expect(scan).toMatchObject({ completeness: "complete", metadata: "complete", listeners: [] });
  });

  it("returns a failed listener scan without throwing", async () => {
    const { exec } = fakeExec({ listeners: { kind: "timeout" } });
    const scan = await collectNative({ exec, platform: "darwin" });
    expect(scan.completeness).toBe("failed");
    expect(scan.listeners).toEqual([]);
  });

  it("batches pids and caps the candidate list", async () => {
    const total = MAX_CANDIDATE_PIDS + 10;
    const lines = Array.from(
      { length: total },
      (_, index) => `p${1000 + index}\nf1\ntIPv4\nn127.0.0.1:${2000 + index}`,
    );
    const { exec, calls } = fakeExec({
      listeners: exit(lines.join("\n") + "\n"),
      cwd: exit("", 1),
      ps: exit("", 1),
    });
    const scan = await collectNative({ exec, platform: "darwin" });
    const cwdCalls = calls.filter((call) => call.args.includes("cwd"));
    expect(cwdCalls).toHaveLength(Math.ceil(MAX_CANDIDATE_PIDS / PID_BATCH_SIZE));
    expect(scan.diagnostics.map((note) => note.code)).toContain("candidates-capped");
    expect(scan.metadata).toBe("partial");
    expect(scan.listeners).toHaveLength(total);
  });

  it("uses the documented listener output cap", async () => {
    const limits: number[] = [];
    const exec: ExecFn = async (_file, _args, limit) => {
      limits.push(limit.maxBufferBytes);
      return exit("", 1);
    };
    await collectNative({ exec, platform: "darwin" });
    expect(limits[0]).toBe(LISTENER_OUTPUT_CAP_BYTES);
  });
});
