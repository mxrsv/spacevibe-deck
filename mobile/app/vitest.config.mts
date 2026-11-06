import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// Pure modules only: nothing under test imports react-native or an expo module (those sit behind
// small interfaces so the session, pairing and store logic run in plain Node).
export default defineConfig({
  resolve: {
    alias: {
      "@protocol": path.resolve(here, "../protocol/src"),
      "@": path.resolve(here, "src"),
    },
  },
  test: { include: ["src/**/*.test.ts", "plugins/**/*.test.ts"] },
});
