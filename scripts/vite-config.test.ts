import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import configExport from "../vite.config";

describe("production minification", () => {
  it("uses Terser to preserve xterm's requestMode enum binding", async () => {
    if (typeof configExport !== "function") {
      throw new TypeError("Expected vite.config.ts to export a config factory");
    }
    const config = await configExport({
      command: "build",
      mode: "production",
      isSsrBuild: false,
      isPreview: false,
    });

    expect(config.build?.minify).toBe("terser");
  });
});

describe("test discovery", () => {
  it("keeps the current checkout's tests and excludes nested worktrees and dependencies", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-test-discovery-"));
    const files = [
      "src/example.test.ts",
      ".claude/worktrees/other/src/example.test.ts",
      "node_modules/example/dependency.test.ts",
      "backend/service.test.ts",
    ];
    try {
      for (const file of files) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "// Discovery fixture; never executed.\n");
      }
      const output = execFileSync(
        process.execPath,
        [
          join(
            dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
            "vitest.mjs",
          ),
          "list",
          "--config",
          resolve("vite.config.ts"),
          "--root",
          root,
          "--exclude",
          "backend/**",
          "--filesOnly",
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      expect(output.trim().split(/\r?\n/)).toEqual(["src/example.test.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 25_000);
});
