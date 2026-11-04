// Proves Metro can bundle the app for iOS without Xcode: `expo export` into a temp directory
// outside the repo, so no build output is ever left behind to commit.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = mkdtempSync(path.join(tmpdir(), "deck-app-export-"));
const result = spawnSync(
  "npx",
  ["expo", "export", "--platform", "ios", "--output-dir", out, "--no-minify"],
  {
    stdio: "inherit",
    // CI skips interactive prompts; offline and no-telemetry keep the check from needing an Expo
    // account or network beyond the npm registry.
    env: { ...process.env, CI: "1", EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1" },
    shell: process.platform === "win32",
  },
);
rmSync(out, { recursive: true, force: true });
process.exit(result.status ?? 1);
