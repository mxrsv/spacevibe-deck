import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebglAddon } from "@xterm/addon-webgl";
import { disposeWebglAddon } from "./webgl-addon-dispose";

// Vite resolves the package's `module` field, so that is the bundle that ships.
function shippedBundle(): string {
  const pkgPath = createRequire(import.meta.url).resolve("@xterm/addon-webgl/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { module: string };
  return readFileSync(join(dirname(pkgPath), pkg.module), "utf8");
}

describe("addon-webgl private names the dispose workaround relies on", () => {
  const bundle = shippedBundle();

  it("still has the renderer and blink-manager fields", () => {
    // If this fails, an addon-webgl bump renamed them and disposeWebglAddon is
    // now a silent no-op: re-read WebglAddon.ts/WebglRenderer.ts, update the
    // names in webgl-addon-dispose.ts, or delete the workaround if the leak is fixed.
    expect(bundle).toContain("this._renderer=");
    expect(bundle).toContain("_cursorBlinkStateManager");
  });

  it("still leaves the blink manager unregistered (the leak shape)", () => {
    // Registered siblings read `=this._register(new X)`; the leak reads `=new X;`.
    // If this fails, upstream registers the manager: delete webgl-addon-dispose.ts
    // and call addon.dispose() directly in pane.ts.
    expect(bundle).toMatch(/_cursorBlinkStateManager=new [\w$]+[;,]/);
  });
});

describe("disposeWebglAddon", () => {
  afterEach(() => vi.useRealTimers());

  it("stops the renderer's blink timer, before the addon is disposed", () => {
    // Stands in for the 0.19.0 shape: the addon's own dispose leaves the
    // blink manager's interval running.
    vi.useFakeTimers();
    const events: string[] = [];
    const blink = setInterval(() => events.push("tick"), 600);
    const addon = {
      _renderer: {
        _cursorBlinkStateManager: {
          clear: () => {
            clearInterval(blink);
            events.push("clear");
          },
        },
      },
      dispose: () => events.push("dispose"),
    };

    disposeWebglAddon(addon as unknown as WebglAddon);
    vi.advanceTimersByTime(6000);

    expect(events).toEqual(["clear", "dispose"]);
  });

  it("disposes an addon whose renderer was never created", () => {
    // The init-failure path: `loadAddon` threw before `_renderer` existed.
    const dispose = vi.fn();
    disposeWebglAddon({ dispose } as unknown as WebglAddon);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
