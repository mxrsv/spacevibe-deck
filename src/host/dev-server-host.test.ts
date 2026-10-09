import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "./bridge";
import {
  DevServerResponseError,
  getDevServerSnapshot,
  releaseDevServers,
  resolveDevServer,
  setDevServerRoots,
} from "./dev-server-host";

vi.mock("./bridge", () => ({ invoke: vi.fn() }));

const row = {
  id: "r1",
  instanceToken: "t1",
  workspacePath: "/work/app",
  displayRoot: "/work/app",
  port: 5173,
  bindings: [{ family: "IPv4", address: "127.0.0.1" }],
  sharedEndpoint: false,
  observedAt: 1_000,
  liveness: "running",
  stoppedAt: null,
  protocol: "http",
  url: "http://127.0.0.1:5173/",
  identificationError: null,
};

const snapshot = {
  generation: 2,
  sequence: 7,
  observedAt: 1_000,
  capability: { available: true },
  completeness: "complete",
  metadata: "complete",
  rows: [row],
  diagnostics: [{ code: "scan-stale", message: "old" }],
  rootDiagnostics: [{ code: "not-found", root: "/gone", message: "missing" }],
};

const rootsReply = {
  capability: { available: true },
  applied: true,
  generation: 2,
  rootDiagnostics: [],
};

function withBridge(): void {
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  withBridge();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dev-server-host without the Electron bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("__deckHost", undefined);
  });

  it("reports unsupported-host and never calls IPC", async () => {
    const reply = await setDevServerRoots(["/work/app"]);
    expect(reply.capability).toEqual({ available: false, reason: "unsupported-host" });
    const snap = await getDevServerSnapshot();
    expect(snap.capability).toEqual({ available: false, reason: "unsupported-host" });
    expect(snap.rows).toEqual([]);
    await releaseDevServers();
    await expect(resolveDevServer("r1", "t1")).resolves.toEqual({
      status: "unavailable",
      reason: "unsupported-platform",
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("dev-server-host with the bridge", () => {
  it("sends flat payloads on the literal channel names", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(rootsReply);
    await setDevServerRoots(["/work/app"]);
    vi.mocked(invoke).mockResolvedValueOnce(snapshot);
    await getDevServerSnapshot();
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await releaseDevServers();
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "stale",
    });
    await resolveDevServer("r1", "t1");

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["dev_servers_set_roots", { roots: ["/work/app"] }],
      ["dev_servers_snapshot", {}],
      ["dev_servers_release", {}],
      ["dev_servers_resolve", { id: "r1", instanceToken: "t1" }],
    ]);
  });

  it("returns a validated snapshot, keeping available-but-empty distinct", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot, rows: [] });
    const result = await getDevServerSnapshot();
    expect(result.capability).toEqual({ available: true });
    expect(result.rows).toEqual([]);
  });

  it("accepts an unsupported-platform capability from main", async () => {
    const capability = { available: false, reason: "unsupported-platform", platform: "win32" };
    vi.mocked(invoke).mockResolvedValueOnce({ ...rootsReply, capability });
    await expect(setDevServerRoots([])).resolves.toMatchObject({ capability });
  });

  it("rejects non-array roots before IPC", async () => {
    await expect(setDevServerRoots("/work" as unknown as string[])).rejects.toThrow(TypeError);
    await expect(setDevServerRoots([1] as unknown as string[])).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates an IPC rejection unchanged", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("too many roots"));
    await expect(setDevServerRoots(["/a"])).rejects.toThrow("too many roots");
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["array", []],
    ["negative generation", { ...snapshot, generation: -1 }],
    ["fractional sequence", { ...snapshot, sequence: 1.5 }],
    ["unknown completeness", { ...snapshot, completeness: "maybe" }],
    ["missing capability", { ...snapshot, capability: undefined }],
    ["bad capability reason", { ...snapshot, capability: { available: false, reason: "x" } }],
    ["rows not an array", { ...snapshot, rows: {} }],
    ["row missing token", { ...snapshot, rows: [{ ...row, instanceToken: undefined }] }],
    ["row bad port", { ...snapshot, rows: [{ ...row, port: 0 }] }],
    ["row bad liveness", { ...snapshot, rows: [{ ...row, liveness: "zombie" }] }],
    ["row javascript url", { ...snapshot, rows: [{ ...row, url: "javascript:alert(1)" }] }],
    ["row file url", { ...snapshot, rows: [{ ...row, url: "file:///etc/passwd" }] }],
    ["row bad binding", { ...snapshot, rows: [{ ...row, bindings: [{ family: "IPX" }] }] }],
    [
      "bad root diagnostic",
      { ...snapshot, rootDiagnostics: [{ code: "?", root: "", message: "" }] },
    ],
  ];

  it.each(malformed)("rejects a malformed snapshot: %s", async (_name, payload) => {
    vi.mocked(invoke).mockResolvedValueOnce(payload);
    await expect(getDevServerSnapshot()).rejects.toBeInstanceOf(DevServerResponseError);
  });

  it("rejects a snapshot with too many rows", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot, rows: new Array(1_001).fill(row) });
    await expect(getDevServerSnapshot()).rejects.toBeInstanceOf(DevServerResponseError);
  });

  it("rejects a malformed roots reply", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ...rootsReply, applied: "yes" });
    await expect(setDevServerRoots(["/a"])).rejects.toBeInstanceOf(DevServerResponseError);
    vi.mocked(invoke).mockResolvedValueOnce({ applied: true, generation: 1, rootDiagnostics: [] });
    await expect(setDevServerRoots(["/a"])).rejects.toBeInstanceOf(DevServerResponseError);
  });

  it("accepts a ready resolve result", async () => {
    const ready = {
      status: "ready",
      id: "r1",
      url: "https://localhost:3000/",
      protocol: "https",
    };
    vi.mocked(invoke).mockResolvedValueOnce(ready);
    await expect(resolveDevServer("r1", "b")).resolves.toEqual(ready);
  });

  it.each([
    { status: "stale" },
    { status: "unavailable", reason: "unsupported-platform" },
    { status: "unavailable", reason: "observation-stopped" },
    { status: "unavailable", reason: "not-running" },
    { status: "unavailable", reason: "scan-incomplete" },
    { status: "unknown-protocol", error: null },
    { status: "unknown-protocol", error: "tls:expired" },
  ])("passes the explicit resolve result %j through", async (result) => {
    vi.mocked(invoke).mockResolvedValueOnce(result);
    await expect(resolveDevServer("a", "b")).resolves.toEqual(result);
  });

  it.each([
    { status: "ready", id: "r1", url: "javascript:1", protocol: "http" },
    { status: "ready", id: "r1", url: "http://127.0.0.1:1/", protocol: "ftp" },
    { status: "ready", url: "http://127.0.0.1:1/", protocol: "http" },
    { status: "unavailable", reason: "gone" },
    { status: "unavailable" },
    { status: "unknown-protocol" },
    { status: "maybe" },
    { ok: true, url: "http://127.0.0.1:1/" },
    "ready",
  ])("rejects a malformed resolve result %j", async (bad) => {
    vi.mocked(invoke).mockResolvedValueOnce(bad);
    await expect(resolveDevServer("a", "b")).rejects.toBeInstanceOf(DevServerResponseError);
  });
});
