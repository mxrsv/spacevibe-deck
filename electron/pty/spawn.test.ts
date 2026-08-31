import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(() => ({ ptsName: "/dev/ttys001" })) }));

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
vi.mock("node-pty", () => ({ spawn: mocks.spawn }));
vi.mock("../platform/macos", () => ({
  shellLaunch: () => ({ executable: "/bin/zsh", args: ["-l"] }),
  userHome: () => "/Users/dev",
}));
vi.mock("../platform/windows", () => ({
  shellLaunch: () => ({ executable: "pwsh.exe", args: [] }),
  userHome: () => "C:\\Users\\dev",
}));

import { resolveSpawnCwd, spawnShell, validateResizeOptions, validateSpawnOptions } from "./spawn";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "deck-spawn-cwd-"));
const FILE_PATH = join(TEST_ROOT, "not-a-directory");
const MISSING_PATH = join(TEST_ROOT, "missing");

writeFileSync(FILE_PATH, "file");

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.spawn.mockClear();
});

describe("resolveSpawnCwd", () => {
  it("uses Home only for a null cwd", () => {
    expect(resolveSpawnCwd(null, "/Users/dev")).toBe("/Users/dev");
    expect(resolveSpawnCwd(TEST_ROOT, "/Users/dev")).toBe(TEST_ROOT);
  });

  it("rejects a missing explicit cwd", () => {
    expect(() => spawnShell({ cols: 80, rows: 24, cwd: MISSING_PATH })).toThrow(MISSING_PATH);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(() => resolveSpawnCwd("", "/Users/dev")).toThrow("empty");
  });

  it("rejects an explicit file path", () => {
    expect(() => spawnShell({ cols: 80, rows: 24, cwd: FILE_PATH })).toThrow(FILE_PATH);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

describe("validateSpawnOptions", () => {
  it("preserves an explicit null Home request and an explicit directory", () => {
    expect(validateSpawnOptions({ cols: 80, rows: 24, cwd: null })).toEqual({
      cols: 80,
      rows: 24,
      cwd: null,
    });
    expect(validateSpawnOptions({ cols: 80, rows: 24, cwd: TEST_ROOT }).cwd).toBe(TEST_ROOT);
  });

  it.each([
    [{ cols: 80, rows: 24 }, "cwd"],
    [{ cols: 80, rows: 24, cwd: undefined }, "cwd"],
    [{ cols: 80, rows: 24, cwd: 42 }, "cwd"],
    [{ cols: 0, rows: 24, cwd: null }, "cols"],
    [{ cols: 32_768, rows: 24, cwd: null }, "cols"],
    [{ cols: 80, rows: Number.NaN, cwd: null }, "rows"],
    [{ cols: 80, rows: 32_768, cwd: null }, "rows"],
  ])("rejects malformed spawn_shell payload %#", (payload, field) => {
    expect(() => validateSpawnOptions(payload)).toThrow(field);
  });
});

describe("validateResizeOptions", () => {
  it("accepts portable PTY geometry", () => {
    expect(validateResizeOptions({ id: 7, cols: 120, rows: 40 })).toEqual({
      id: 7,
      cols: 120,
      rows: 40,
    });
  });

  it.each([
    [{ id: 0, cols: 80, rows: 24 }, "id"],
    [{ id: 7, cols: 32_768, rows: 24 }, "cols"],
    [{ id: 7, cols: 80, rows: 32_768 }, "rows"],
  ])("rejects malformed resize_pty payload %#", (payload, field) => {
    expect(() => validateResizeOptions(payload)).toThrow(field);
  });
});
