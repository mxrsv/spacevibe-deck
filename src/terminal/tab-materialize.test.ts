import { describe, expect, it } from "vitest";
import {
  buildClosedTabSnapshot,
  capturePresetLayout,
  materializeChromeFrom,
  resolveInheritedCwds,
  resolvePaneCwds,
  zipFreshCwds,
  zipPolledCwds,
} from "./tab-materialize";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";

describe("zipPolledCwds / zipFreshCwds", () => {
  it("zips polled map with null for unknown ids", () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [
        7,
        {
          id: 7,
          cwd: "/tmp",
          process: "zsh",
          kind: "idle-shell",
          agent: null,
        },
      ],
      [
        9,
        {
          id: 9,
          cwd: null,
          process: null,
          kind: "unknown",
          agent: null,
        },
      ],
    ]);
    expect(zipPolledCwds([7, 8, 9], infoByPane)).toEqual(["/tmp", null, null]);
  });

  it("zips fresh infos in pane-id order", () => {
    const infos: PaneProcessInfo[] = [
      {
        id: 2,
        cwd: "/b",
        process: "zsh",
        kind: "idle-shell",
        agent: null,
      },
      {
        id: 1,
        cwd: "/a",
        process: "zsh",
        kind: "idle-shell",
        agent: null,
      },
    ];
    expect(zipFreshCwds([1, 2, 3], infos)).toEqual(["/a", "/b", null]);
  });
});

describe("resolvePaneCwds", () => {
  it("none → empty (Session chrome)", async () => {
    expect(await resolvePaneCwds([1, 2], "none")).toEqual([]);
  });

  it("given → provided list", async () => {
    expect(await resolvePaneCwds([1], "given", { provided: ["/ws"] })).toEqual([
      "/ws",
    ]);
  });

  it("polled → zip against cache", async () => {
    const polled = new Map<number, PaneProcessInfo>([
      [
        1,
        {
          id: 1,
          cwd: "/polled",
          process: "zsh",
          kind: "idle-shell",
          agent: null,
        },
      ],
    ]);
    expect(await resolvePaneCwds([1, 2], "polled", { polled })).toEqual([
      "/polled",
      null,
    ]);
  });

  it("fresh → uses injected PtyClient (no module mock)", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [
        4,
        {
          id: 4,
          cwd: "/fresh/4",
          process: "zsh",
          kind: "idle-shell",
          agent: null,
        },
      ],
      [
        5,
        {
          id: 5,
          cwd: "/fresh/5",
          process: "zsh",
          kind: "idle-shell",
          agent: null,
        },
      ],
    ]);
    const pty = createMemoryPtyClient({ infos });
    expect(await resolvePaneCwds([4, 5], "fresh", { pty })).toEqual([
      "/fresh/4",
      "/fresh/5",
    ]);
  });
});

describe("capturePresetLayout", () => {
  it("threads PtyClient for fresh CWDs", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [
        1,
        {
          id: 1,
          cwd: "/a",
          process: "zsh",
          kind: "idle-shell",
          agent: null,
        },
      ],
    ]);
    const pty = createMemoryPtyClient({ infos });
    await expect(
      capturePresetLayout([1], { type: "leaf" }, pty),
    ).resolves.toEqual({ layout: { type: "leaf" }, cwds: ["/a"] });
  });
});

describe("resolveInheritedCwds", () => {
  it("fills missing preset CWDs from inherit", () => {
    expect(
      resolveInheritedCwds(
        {
          type: "split",
          direction: "row",
          ratio: 0.5,
          first: { type: "leaf" },
          second: { type: "leaf" },
        },
        ["/preset"],
        "/inherit",
      ),
    ).toEqual(["/preset", "/inherit"]);
  });

  it("uses inherit for every leaf when preset has no cwds", () => {
    expect(resolveInheritedCwds({ type: "leaf" }, undefined, "/home")).toEqual([
      "/home",
    ]);
  });
});

describe("materializeChromeFrom", () => {
  it("returns undefined when both absent", () => {
    expect(materializeChromeFrom(null, null)).toBeUndefined();
    expect(materializeChromeFrom(undefined, undefined)).toBeUndefined();
  });

  it("keeps name and/or dotColor", () => {
    expect(materializeChromeFrom("A", null)).toEqual({ name: "A" });
    expect(materializeChromeFrom(null, "cyan")).toEqual({ dotColor: "cyan" });
  });
});

describe("buildClosedTabSnapshot", () => {
  it("carries layout chrome + resolved cwds + the workspace", () => {
    expect(
      buildClosedTabSnapshot({
        layout: { type: "leaf" },
        name: "x",
        dotColor: null,
        cwds: ["/a"],
        workspacePath: "/Users/k/dev/x",
      }),
    ).toEqual({
      layout: { type: "leaf" },
      name: "x",
      dotColor: null,
      cwds: ["/a"],
      workspacePath: "/Users/k/dev/x",
    });
  });
});
