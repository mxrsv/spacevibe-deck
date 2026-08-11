import { describe, expect, it } from "vitest";
import { buildPtyInfo } from "./info";
import { parsePsTable } from "../platform/macos";
import type { PtySessionSnapshot } from "./session-store";

const rows = parsePsTable(
  [
    "  501   501   501 ttys001 -zsh",
    "  610   610   777 ttys002 /bin/zsh -l",
    "  777   777   777 ttys002 claude",
    "  800   800   850 ttys003 /bin/zsh -l",
    "  850   850   850 ttys003 /usr/bin/git push",
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
