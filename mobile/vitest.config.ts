import { defineConfig } from "vitest/config";

// The shared protocol's suite. The relay and the app run their own suites from their packages.
export default defineConfig({
  test: {
    include: ["protocol/**/*.test.ts"],
  },
});
