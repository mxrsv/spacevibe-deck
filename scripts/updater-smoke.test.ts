import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { once } from "node:events";
import { mkdtemp, mkdir, symlink, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { expectRejectedUpdate } from "./updater-smoke-rejection.cjs";
import { startOwnedProcess, processExists } from "./updater-smoke-process.mjs";
import { copySmokeInstallation } from "./updater-smoke-build.mjs";

const require = createRequire(import.meta.url);
const RUNNER = fileURLToPath(new URL("./updater-smoke.mjs", import.meta.url));

describe("updater smoke CLI", () => {
  it("describes the scope without building or signing", () => {
    const result = spawnSync(process.execPath, [RUNNER, "--help"], {
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--install --identity");
    expect(result.stdout).toContain("Does not verify Deck's renderer");
    expect(result.stdout).not.toContain("Building isolated");
  });

  it("does not let electron-builder's exit hook turn failure into exit 0", () => {
    const hook = require.resolve("async-exit-hook");
    const setup = `import hook from ${JSON.stringify(pathToFileURL(hook).href)}; hook(() => {});`;
    const result = spawnSync(
      process.execPath,
      ["--import", `data:text/javascript,${encodeURIComponent(setup)}`, RUNNER],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Real install\/relaunch requires|requires macOS/);
    expect(result.stdout).not.toContain("Building isolated");
  });
});

describe("download rejection evidence", () => {
  it("cannot accept a check-time 404 as a download rejection", async () => {
    const download = vi.fn();
    await expect(
      expectRejectedUpdate(
        {
          check: async () => {
            throw new Error("check 404");
          },
          download,
        },
        "asset-missing",
        "0.0.2",
      ),
    ).rejects.toThrow("check 404");
    expect(download).not.toHaveBeenCalled();
  });
  it("requires the exact target before testing download", async () => {
    await expect(
      expectRejectedUpdate(
        {
          check: async () => ({ status: "available", version: "0.0.3" }),
          download: async () => {
            throw new Error("download 404");
          },
        },
        "asset-missing",
        "0.0.2",
      ),
    ).rejects.toThrow(/0\.0\.3/);
  });
  it("accepts a download 404 after a successful check", async () => {
    await expect(
      expectRejectedUpdate(
        {
          check: async () => ({ status: "available", version: "0.0.2" }),
          download: async () => {
            throw new Error("download 404");
          },
        },
        "asset-missing",
        "0.0.2",
      ),
    ).resolves.toEqual({ operation: "download", message: "Error: download 404" });
  });
  it("fails if the corrupt payload was downloaded successfully", async () => {
    await expect(
      expectRejectedUpdate(
        {
          check: async () => ({ status: "available", version: "0.0.2" }),
          download: async () => {},
        },
        "checksum",
        "0.0.2",
      ),
    ).rejects.toThrow("Broken feed was accepted");
  });
});

// The harness uses POSIX process groups and explicitly refuses Windows.
describe.skipIf(process.platform === "win32")("owned native processes", () => {
  it("preserves relative framework symlinks when copying a signed installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-copy-test-"));
    try {
      await mkdir(join(root, "source", "Versions", "A"), { recursive: true });
      await symlink("A", join(root, "source", "Versions", "Current"));
      await copySmokeInstallation(join(root, "source"), join(root, "installed"));
      expect(await readlink(join(root, "installed", "Versions", "Current"))).toBe("A");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("propagates nonzero child exits", async () => {
    const run = startOwnedProcess(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" });
    await expect(run.completion).rejects.toThrow("code=3");
  });
  it("aborting waits for the process to exit", async () => {
    const abort = new AbortController();
    const run = startOwnedProcess(
      process.execPath,
      ["-e", "console.log('ready'); setInterval(() => {}, 1000)"],
      { signal: abort.signal, stdio: ["ignore", "pipe", "pipe"] },
    );
    const interruption = run.completion.catch((error) => error);
    try {
      await once(run.child.stdout, "data");
      abort.abort(new Error("test interrupted"));
      expect(await interruption).toEqual(new Error("test interrupted"));
      expect(processExists(run.child.pid)).toBe(false);
    } finally {
      run.stop();
    }
  });
});
