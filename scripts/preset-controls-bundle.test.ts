import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleForPreact,
  PRESET_CONTROLS_FILE,
  REACT_RUNTIME,
  // @ts-expect-error -- plain ES module with no declarations
} from "./preset-controls-bundle.mjs";

/**
 * Migration plan gate W0-T, the bundle half: the file the control tests import is built
 * with the React aliases, and the build refuses a bundle holding real React. The refusal
 * has to be able to fire, so one bundle is built on purpose without the aliases.
 */
describe("the controls test bundle", () => {
  it("was built by the global setup", () => {
    expect(existsSync(PRESET_CONTROLS_FILE)).toBe(true);
  });

  it("recognises real React and react-dom by path", () => {
    expect(REACT_RUNTIME.test("node_modules/react/index.js")).toBe(true);
    expect(REACT_RUNTIME.test("node_modules/react-dom/client.js")).toBe(true);
    expect(REACT_RUNTIME.test("node_modules/preact/compat/dist/compat.mjs")).toBe(false);
  });

  it("flags real React when a bundle is built without the aliases", async () => {
    // Inside the cache directory, so `react` resolves from the repository's node_modules.
    const dir = mkdtempSync(join(dirname(PRESET_CONTROLS_FILE), "react-leak-"));
    try {
      const entry = join(dir, "entry.mjs");
      writeFileSync(entry, 'import * as React from "react"; export default React;\n');
      const leaked: string[] = await bundleForPreact(entry, join(dir, "out.mjs"), { alias: {} });
      expect(leaked.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
