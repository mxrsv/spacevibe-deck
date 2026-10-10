// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePanel } from "./file-panel";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import {
  activeFileTab,
  activateTerminalSurface,
  documentFor,
  openFileTab,
  resetFileSurfaces,
  updateDocument,
} from "../file-surface-store";
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
  createEntry: async (_root: string, parent: string, name: string) => ({
    path: `${parent}/${name}`,
  }),
  listenFileChanged: async () => () => {},
};

describe("FilePanel", () => {
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
      render(<FilePanel workspacePath={WS} controller={controller} />, host);
    });
  };

  it("renders nothing while a terminal tab holds the stage", () => {
    mount();
    expect(host.querySelector(".file-panel")).toBeNull();
  });

  it("mounts the selected document in the panel", () => {
    openFileTab(WS, FILE, { keep: true });
    mount();

    // The layer AND a real `FileEditor` inside it — `.fileview` is the
    // editor's own root, so this fails if the surface renders an empty box.
    expect(host.querySelector(".file-panel .fileview")).not.toBeNull();
  });

  it("keeps header controls focused when entering from the terminal", () => {
    openFileTab(WS, FILE, { keep: true });
    mount();
    const focusEditor = vi.fn();
    controller.setEditorFocus(focusEditor);
    act(() => controller.deactivate());
    const select = host.querySelector<HTMLSelectElement>("select")!;
    act(() => select.focus());
    expect(globalThis.document.activeElement).toBe(select);
    expect(activeFileTab.value).toBe(FILE);
    expect(focusEditor).not.toHaveBeenCalled();
    const terminal = globalThis.document.createElement("button");
    globalThis.document.body.appendChild(terminal);
    act(() => terminal.focus());
    expect(activeFileTab.value).toBeNull();
    expect(host.querySelector(".fileview")).not.toBeNull();
  });

  it("does not release ownership for a null blur destination while focus remains inside", async () => {
    openFileTab(WS, FILE, { keep: true });
    mount();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.focus();
      select.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      await Promise.resolve();
    });
    expect(activeFileTab.value).toBe(FILE);
    expect(globalThis.document.activeElement).toBe(select);
  });

  it("retains a dirty file across preview replacement and dock unmount", async () => {
    controller.dispose();
    const confirmDiscard = vi.fn(async () => false);
    controller = createFileSurfaceController({ client: fileClient, confirmDiscard });
    openFileTab(WS, FILE, { keep: false });
    updateDocument(FILE, { text: "unsaved", dirty: true });
    mount();
    act(() => {
      openFileTab(WS, "/repo/b.ts", { keep: false });
    });
    expect(host.querySelectorAll("option")).toHaveLength(2);
    expect(host.querySelector("option")?.textContent).toContain("•");
    act(() => render(null, host));
    expect(documentFor(FILE)?.text).toBe("unsaved");
    mount();
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>("select")!;
      select.value = FILE;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(activeFileTab.value).toBe(FILE);
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(FILE);
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "Close")!
        .click();
    });
    expect(confirmDiscard).toHaveBeenCalledWith([FILE]);
    expect(documentFor(FILE)?.text).toBe("unsaved");
  });

  it("keeps a selected retained file when focusing the editor before the render catches up", () => {
    openFileTab(WS, "/repo/b.ts", { keep: true });
    openFileTab(WS, FILE, { keep: true });
    mount();
    const editor = globalThis.document.createElement("textarea");
    host.querySelector(".file-panel__content")!.appendChild(editor);
    controller.setEditorFocus(() => editor.focus());
    act(() => {
      const select = host.querySelector<HTMLSelectElement>("select")!;
      select.focus();
      select.value = "/repo/b.ts";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(activeFileTab.value).toBe("/repo/b.ts");
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("/repo/b.ts");
    expect(globalThis.document.activeElement).toBe(editor);
  });

  it("does not reclaim the old workspace during a synchronous cross-workspace focus", () => {
    openFileTab("/other", "/other/new.ts", { keep: true });
    openFileTab(WS, FILE, { keep: true });
    mount();
    const editor = globalThis.document.createElement("textarea");
    host.querySelector(".file-panel__content")!.appendChild(editor);
    controller.setEditorFocus(() => editor.focus());
    act(() => {
      host.querySelector<HTMLSelectElement>("select")!.focus();
      controller.activateFile("/other", "/other/new.ts");
    });
    expect(activeFileTab.value).toBe("/other/new.ts");
  });

  it("keeps the new workspace document active when the previous panel cleans up", () => {
    openFileTab(WS, FILE, { keep: true });
    updateDocument(FILE, { text: "unsaved", dirty: true });
    mount();
    act(() => {
      openFileTab("/other", "/other/new.ts", { keep: false });
      render(<FilePanel workspacePath="/other" controller={controller} />, host);
    });
    expect(activeFileTab.value).toBe("/other/new.ts");
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("/other/new.ts");
    expect(documentFor(FILE)?.text).toBe("unsaved");
  });

  it("returns focus once when the last file closes, but not when a dirty close is cancelled", async () => {
    controller.dispose();
    controller = createFileSurfaceController({
      client: fileClient,
      confirmDiscard: async () => false,
    });
    openFileTab(WS, FILE, { keep: true });
    updateDocument(FILE, { dirty: true });
    const onEmpty = vi.fn();
    act(() =>
      render(<FilePanel workspacePath={WS} controller={controller} onEmpty={onEmpty} />, host),
    );
    await act(async () => {
      await controller.closePath(WS, FILE);
    });
    expect(onEmpty).not.toHaveBeenCalled();
    updateDocument(FILE, { dirty: false });
    await act(async () => {
      await controller.closePath(WS, FILE);
    });
    expect(onEmpty).toHaveBeenCalledOnce();
    expect(host.querySelector(".file-panel")).toBeNull();
  });

  it("keeps the document mounted while the terminal receives focus", () => {
    openFileTab(WS, FILE, { keep: true });
    mount();
    expect(host.querySelector(".file-panel")).not.toBeNull();

    act(() => {
      activateTerminalSurface();
    });
    expect(host.querySelector(".file-panel .fileview")).not.toBeNull();
  });
});
