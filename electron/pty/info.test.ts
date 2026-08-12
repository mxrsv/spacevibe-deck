import { describe, expect, it, vi } from "vitest";
import { buildPtyInfo, createPtyInfoReader } from "./info";
import { foregroundProcess, parsePsTable } from "../platform/macos";
import type { PtySessionSnapshot } from "./session-store";

const rows = parsePsTable(
  [
    "  501   501   501 ttys001 -zsh",
    "  610   610   777 ttys002 /bin/zsh -l",
    "  777   777   777 ttys002 claude",
    "  800   800   850 ttys003 /bin/zsh -l",
    "  850   850   850 ttys003 /usr/bin/git push",
    "  900   900   901 ttys004 /bin/zsh -l",
    "  901   901   901 ttys004 node /opt/gemini/bin/gemini --resume",
    " 1000  1000  1001 ttys005 /bin/zsh -l",
    " 1001  1001  1001 ttys005 /opt/bin/aider --watch",
  ].join("\n"),
);

const snapshot = (
  id: number,
  pid: number,
  ttyName: string,
  cwd: string | null = null,
): PtySessionSnapshot => ({ id, pid, ttyName, cwd });

describe("buildPtyInfo", () => {
  it("reports an idle login shell", () => {
    const [info] = buildPtyInfo([snapshot(1, 501, "ttys001")], rows);

    expect(info).toEqual({
      id: 1,
      cwd: null,
      process: "zsh",
      kind: "idle-shell",
      agent: null,
    });
  });

  it("reports a foreground agent with its id", () => {
    const [info] = buildPtyInfo([snapshot(2, 610, "ttys002")], rows);

    expect(info).toEqual({
      id: 2,
      cwd: null,
      process: "claude",
      kind: "agent",
      agent: "claude",
    });
  });

  it("reports an ordinary foreground job as busy", () => {
    const [info] = buildPtyInfo([snapshot(3, 800, "ttys003")], rows);

    expect(info.kind).toBe("busy");
    expect(info.agent).toBe(null);
  });

  it("uses the foreground command line to recognize a Node agent", () => {
    const [info] = buildPtyInfo([snapshot(4, 900, "ttys004")], rows);

    expect(info).toMatchObject({
      process: "node",
      kind: "agent",
      agent: "gemini",
    });
  });

  it("recognizes a user-declared agent matcher", () => {
    const [info] = buildPtyInfo(
      [snapshot(5, 1000, "ttys005")],
      rows,
      new Map(),
      undefined,
      [{ binary: "aider", agent: "Aider" }],
    );

    expect(info).toMatchObject({
      process: "aider",
      kind: "agent",
      agent: "Aider",
    });
  });

  it("degrades a pane missing from the table to unknown, keeping its cwd", () => {
    const [info] = buildPtyInfo([snapshot(4, 999, "ttys099", "/tmp")], rows);

    expect(info).toEqual({
      id: 4,
      cwd: "/tmp",
      process: null,
      kind: "unknown",
      agent: null,
    });
  });

  it("answers every snapshot from one table reading, in order", () => {
    const infos = buildPtyInfo(
      [snapshot(1, 501, "ttys001"), snapshot(2, 610, "ttys002")],
      rows,
    );

    expect(infos.map((info) => info.id)).toEqual([1, 2]);
    expect(infos.map((info) => info.kind)).toEqual(["idle-shell", "agent"]);
  });

  it("returns an empty list for no snapshots", () => {
    expect(buildPtyInfo([], rows)).toEqual([]);
  });
});

describe("createPtyInfoReader", () => {
  it("shares one process-table snapshot across concurrent callers", async () => {
    let resolveRows!: (value: typeof rows) => void;
    const readProcessTable = vi.fn(
      () =>
        new Promise<typeof rows>((resolve) => {
          resolveRows = resolve;
        }),
    );
    const reader = createPtyInfoReader(() => ({
      readProcessTable,
      foregroundProcess,
      processCwds: async () => new Map(),
    }));

    const first = reader.read([snapshot(1, 501, "ttys001")]);
    const second = reader.read([snapshot(2, 610, "ttys002")]);

    expect(readProcessTable).toHaveBeenCalledTimes(1);
    resolveRows(rows);
    await Promise.all([first, second]);
  });

  it("returns process state before a slow cwd refresh and uses its cache later", async () => {
    let resolveCwds!: (cwds: Map<number, string>) => void;
    const processCwds = vi.fn(
      () =>
        new Promise<Map<number, string>>((resolve) => {
          resolveCwds = resolve;
        }),
    );
    const reader = createPtyInfoReader(() => ({
      readProcessTable: async () => rows,
      foregroundProcess,
      processCwds,
    }));

    const first = await reader.read([snapshot(2, 610, "ttys002")]);

    expect(first[0]).toMatchObject({
      process: "claude",
      kind: "agent",
      cwd: null,
    });
    expect(processCwds).toHaveBeenCalledWith([777]);

    resolveCwds(new Map([[777, "/repo"]]));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const second = await reader.read([snapshot(2, 610, "ttys002")]);
    expect(second[0]?.cwd).toBe("/repo");
  });

  it("can wait for a live cwd at decision points", async () => {
    const reader = createPtyInfoReader(() => ({
      readProcessTable: async () => rows,
      foregroundProcess,
      processCwds: async () => new Map([[777, "/fresh"]]),
    }));

    const infos = await reader.read(
      [snapshot(2, 610, "ttys002", "/stale")],
      [],
      true,
    );

    expect(infos[0]?.cwd).toBe("/fresh");
  });
});
