// @vitest-environment jsdom
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { mount } from "./preset-test-kit";

/**
 * Migration plan gate W0-T. The Base UI controls run on Preact through the
 * `react` -> `preact/compat` alias; if the alias is missed anywhere, a second
 * renderer loads and the first hook call dies far from the cause. This file
 * proves the test boundary holds, and that its runtime guard can fail; the bundle-time
 * guard is held by `scripts/preset-controls-bundle.test.ts`.
 */

/** A module of real React or its renderer, by path. */
const REACT_RUNTIME = /node_modules[\\/](react|react-dom|scheduler)[\\/]/;
const requireFromHere = createRequire(import.meta.url);

/** Modules of real React or its renderer that this process has loaded through Node. */
const loadedReactModules = (): string[] =>
  Object.keys(requireFromHere.cache ?? {}).filter((path) => REACT_RUNTIME.test(path));

describe("the Preact test boundary for the Base UI controls", () => {
  it("renders a switch and a button through the aliased bundle", async () => {
    const { Switch, Button } = await loadPresetControls();
    const view = await mount(
      <>
        <Switch aria-label="Notify" />
        <Button>Save</Button>
      </>,
    );
    expect(view.host.querySelector('[role="switch"]')).not.toBeNull();
    expect(view.host.querySelector("button")?.textContent).toBe("Save");
    await view.unmount();
  });

  it("loads no module of real React or react-dom after exercising an overlay", async () => {
    const { Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent } =
      await loadPresetControls();
    const view = await mount(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
        <DropdownMenu open>
          <DropdownMenuContent>menu</DropdownMenuContent>
        </DropdownMenu>
      </>,
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(loadedReactModules()).toEqual([]);
    await view.unmount();
  });

  describe("negative control: the guard can fail", () => {
    it("sees real React once something requires it", () => {
      expect(loadedReactModules()).toEqual([]);
      requireFromHere("react");
      expect(loadedReactModules().length).toBeGreaterThan(0);
    });
  });
});
