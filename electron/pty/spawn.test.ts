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

import {
  buildEnv,
  resolveSpawnCwd,
  spawnShell,
  validateResizeOptions,
  validateSpawnOptions,
} from "./spawn";

describe("buildEnv — the pane's identity for its hooks (stage 2, 2026-09-03)", () => {
  it("adds the three pane variables when the endpoint is up", () => {
    const env = buildEnv({ PATH: "/bin" }, "1.2.3", {
      paneId: 7,
      hookToken: "0123456789abcdef0123456789abcdef",
      hookPort: 45123,
    });
    expect(env.DECK_PANE_ID).toBe("7");
    expect(env.DECK_HOOK_TOKEN).toBe("0123456789abcdef0123456789abcdef");
    expect(env.DECK_HOOK_PORT).toBe("45123");
    expect(env.TERM_PROGRAM).toBe("SpaceVibeDeck");
    expect(env.PATH).toBe("/bin");
  });

  it("omits the port when the listener never bound, even if the base env carried one", () => {
    const env = buildEnv({ DECK_HOOK_PORT: "1" }, "1.2.3", {
      paneId: 7,
      hookToken: "t",
      hookPort: null,
    });
    expect(env.DECK_PANE_ID).toBe("7");
    expect(env).not.toHaveProperty("DECK_HOOK_PORT");
  });

  it("adds nothing without a pane, so every other caller is unchanged", () => {
    const env = buildEnv({}, "1.2.3");
    expect(env).not.toHaveProperty("DECK_PANE_ID");
    expect(env).not.toHaveProperty("DECK_HOOK_TOKEN");
  });

  it("passes the pane into the spawned shell's environment", () => {
    spawnShell(
      { cols: 80, rows: 24, cwd: TEST_ROOT },
      { paneId: 3, hookToken: "tok", hookPort: 9 },
    );
    const options = mocks.spawn.mock.calls[0]?.[2] as { env: Record<string, string> } | undefined;
    expect(options?.env.DECK_PANE_ID).toBe("3");
    expect(options?.env.DECK_HOOK_TOKEN).toBe("tok");
    expect(options?.env.DECK_HOOK_PORT).toBe("9");
  });
});

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
