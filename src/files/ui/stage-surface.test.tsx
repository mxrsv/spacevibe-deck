// @vitest-environment jsdom
/**
 * The regression guard for this feature's headline behaviour: opening a file
 * puts an editor ON THE STAGE, and closing the file tree does not take it
 * away. Both were previously untestable — the editor was nested in
 * `ExplorerPanel`, whose own mount `App` gates on `dockOpen`, and `App`
 * has no render harness in this repo.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StageSurface } from "./stage-surface";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import { activateTerminalSurface, openFileTab, resetFileSurfaces } from "../file-surface-store";
import type { FileClient } from "../file-client";

const WS = "/repo";
const FILE = "/repo/a.ts";

const fileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

describe("StageSurface", () => {
  let host: HTMLDivElement;
  let controller: FileSurfaceController;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    resetFileSurfaces();
    controller = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => render(null, host));
    controller.dispose();
    resetFileSurfaces();
  });

  const mount = (): void => {
    act(() => {
      render(<StageSurface controller={controller} />, host);
    });
  };

  it("renders nothing while a terminal tab holds the stage", () => {
    mount();
    expect(host.querySelector(".stage__surface")).toBeNull();
  });

  it("mounts the editor on the stage for the active file tab", () => {
    openFileTab(WS, FILE, { keep: true });
    mount();

    // The layer AND a real `FileEditor` inside it — `.fileview` is the
    // editor's own root, so this fails if the surface renders an empty box.
    expect(host.querySelector(".stage__surface .fileview")).not.toBeNull();
  });

  it("does not depend on the explorer panel: nothing here reads dockOpen", () => {
    // The old preview block inherited `ExplorerPanel`'s `dockOpen` gate,
    // so ⌘⇧B disposed the editor along with the tree. This component takes one
    // input, the controller, and reads one signal, `activeFileTab` — there is
    // no settings path into it to regress.
    openFileTab(WS, FILE, { keep: true });
    mount();
    expect(host.querySelector(".stage__surface .fileview")).not.toBeNull();

    // Still there across a re-render with no file-state change at all.
    mount();
    expect(host.querySelector(".stage__surface .fileview")).not.toBeNull();
  });

  it("gives the stage back when a terminal tab takes it", () => {
    openFileTab(WS, FILE, { keep: true });
    mount();
    expect(host.querySelector(".stage__surface")).not.toBeNull();

    act(() => {
      activateTerminalSurface();
    });
    expect(host.querySelector(".stage__surface")).toBeNull();
  });
});
