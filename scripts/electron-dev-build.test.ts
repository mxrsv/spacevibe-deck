import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watchMain } from "./electron-dev-build.mjs";

// A rebuild here takes ~150 ms alone, but the file-watch recovery has been seen at 1.8 s when
// the CPU is oversubscribed, and the 3 s it used to wait timed out in 2 of 3 full `npm test`
// runs. Two of these waits plus the fixture must stay inside that test's own 15_000 ms.
const LOADED_REBUILD_WAIT_MS = 6000;

const cleanup: Array<() => void> = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "deck-dev-build-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const put = (name: string, text: string) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(
    "tsconfig.electron.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        strict: true,
        skipLibCheck: true,
        rootDir: ".",
        types: [],
        sourceMap: true,
      },
    }),
  );
  put("src/settings/choice.ts", "export const choice: number = 1;");
  put(
    "electron/main.ts",
    'import { choice } from "../src/settings/choice"; export const result = choice;',
  );
  put("electron/preload.ts", "export const preload = 1;");
  put("electron/browser-preload.ts", "export const browser = 1;");
  const events: Array<{ ok: boolean; changed: boolean; durationMs: number }> = [];
  let invalidated = false;
  const watcher = watchMain({
    root,
    onInvalidated: () => {
      invalidated = true;
    },
    onBuild: (event) => {
      invalidated = false;
      events.push(event);
    },
    onDiagnostic: () => {},
  });
  cleanup.push(() => watcher.close());
  // Let macOS arm native file subscriptions before the first simulated save.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    root,
    put,
    events,
    invalidated: () => invalidated,
    output: (name: string) => readFileSync(path.join(root, "dist-electron/dev", name), "utf8"),
  };
}

describe("incremental Electron development compiler", () => {
  it("restores readiness after a same-content save", async () => {
    const f = await fixture();
    const before = f.events.length;
    f.put("src/settings/choice.ts", "export const choice: number = 1;");
    await expect.poll(() => f.events.length, { timeout: 3000 }).toBeGreaterThan(before);
    expect(f.events.at(-1)).toMatchObject({ ok: true, changed: false });
    expect(f.invalidated()).toBe(false);
  });

  it("tracks imported shared modules, preloads, and newly imported directories", async () => {
    const f = await fixture();
    expect(f.events.at(-1)?.ok).toBe(true);
    expect(f.output("electron/main.cjs")).toContain('require("../src/settings/choice.cjs")');
    f.put("src/settings/choice.ts", "export const choice: number = 2;");
    await expect.poll(() => f.output("src/settings/choice.cjs")).toContain("= 2");
    f.put("src/new-domain/value.ts", "export const value = 3;");
    f.put("electron/main.ts", 'export { value } from "../src/new-domain/value";');
    await expect.poll(() => f.output("electron/main.cjs")).toContain("new-domain/value.cjs");
    f.put("src/new-domain/value.ts", "export const value = 4;");
    await expect.poll(() => f.output("src/new-domain/value.cjs")).toContain("= 4");
    f.put("electron/browser-preload.ts", "export const browser = 2;");
    await expect.poll(() => f.output("electron/browser-preload.cjs")).toContain("= 2");
  }, 15_000);

  it("leaves the last working output intact on errors and recovers after a fix", async () => {
    const f = await fixture();
    const previous = f.output("src/settings/choice.cjs");
    f.put("src/settings/choice.ts", 'export const choice: number = "invalid";');
    await expect.poll(() => f.events.at(-1)?.ok).toBe(false);
    expect(f.output("src/settings/choice.cjs")).toBe(previous);
    f.put("src/settings/choice.ts", "export const choice: number = 5;");
    await expect.poll(() => f.output("src/settings/choice.cjs")).toContain("= 5");
    expect(f.events.at(-1)?.ok).toBe(true);
  }, 15_000);

  it("does not rebuild main for renderer CSS, components, or tests", async () => {
    const f = await fixture();
    const count = f.events.length;
    f.put("src/terminal/header.css", ".header { color: red; }");
    f.put("src/terminal/header.tsx", "export const Header = () => null;");
    f.put("src/terminal/header.test.tsx", "deliberately invalid test source");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(f.events).toHaveLength(count);
  }, 15_000);

  it("recovers when a missing dependency is created after a failed build", async () => {
    const f = await fixture();
    f.put("electron/main.ts", 'export { value } from "../src/missing/value";');
    await expect.poll(() => f.events.at(-1)?.ok, { timeout: LOADED_REBUILD_WAIT_MS }).toBe(false);
    f.put("src/missing/value.ts", "export const value = 7;");
    await expect.poll(() => f.events.at(-1)?.ok, { timeout: LOADED_REBUILD_WAIT_MS }).toBe(true);
    expect(f.output("src/missing/value.cjs")).toContain("= 7");
  }, 15_000);

  it("rejects bad compiler options and recovers when the config is fixed", async () => {
    const f = await fixture();
    const config = readFileSync(path.join(f.root, "tsconfig.electron.json"), "utf8");
    f.put("tsconfig.electron.json", '{"compilerOptions":{"unknownOption":true}}');
    await expect.poll(() => f.events.at(-1)?.ok, { timeout: 3000 }).toBe(false);
    f.put("tsconfig.electron.json", config);
    await expect.poll(() => f.events.at(-1)?.ok, { timeout: 3000 }).toBe(true);
  }, 15_000);
});
