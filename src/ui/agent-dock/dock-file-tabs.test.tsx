// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../host/shell-host", () => ({ writeText: vi.fn(async () => {}) }));

import type { DirEntry } from "../../files/file-tree";
import type { FileClient } from "../../files/file-client";
import {
  activeWorkspace,
  documentFor,
  resetFileSurfaces,
  surfaceFor,
  updateDocument,
} from "../../files/file-surface-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { repositoryScans } from "../../repositories/repositories-store";
import { activeTabIndex, statusInfo, tabViews } from "../../terminal/tabs-store";
import { byRole, click, mount, settle, waitUntil } from "../controls/preset-test-kit";
import { AgentDock } from "./agent-dock";
import { dockSurface, resetAgentDockState, setDockView } from "./agent-dock-state";
import { DockFileBody } from "./dock-file-body";
import { DockFileTree } from "./dock-file-tree";
import { fakeFileClient, testFileBodies } from "./dock-files-test-kit";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const ROOT = "/r/main";
const A = `${ROOT}/src/ui/a.ts`;
const B = `${ROOT}/src/b.ts`;
const C = `${ROOT}/c.md`;

function entry(name: string, directory = false): DirEntry {
  return { name, path: `${ROOT}/${name}`, directory, outOfRoot: false };
}

const treeClient: FileClient = {
  ...fakeFileClient,
  listDir: async (_root, directory) => (directory === ROOT ? [entry("tree-file.ts")] : []),
};

function dock(files = testFileBodies()) {
  return (
    <AgentDock
      entered
      onClose={() => {}}
      bodies={{
        changes: null,
        files,
        usage: () => <p>usage body</p>,
        history: null,
      }}
      selection={{ onFocusPane: () => {}, onSelectTab: () => {} }}
    />
  );
}

const strip = (): HTMLElement =>
  document.body.querySelector<HTMLElement>('[aria-label="Dock views"]') as HTMLElement;
const tabs = (): HTMLElement[] => [
  ...strip().querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]'),
];
const tabNames = (): string[] => tabs().map((tab) => tab.textContent ?? "");
const selected = (): string[] =>
  tabs()
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent ?? "");
const button = (label: string): HTMLElement =>
  document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`) as HTMLElement;
const bodyText = (): string => document.body.textContent ?? "";

async function rightClick(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await waitUntil(() => byRole("menu") !== null);
}

async function pick(label: string): Promise<void> {
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entryNode) => entryNode.textContent === label,
  );
  await click(item as HTMLElement);
}

beforeEach(() => {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  window.dispatchEvent(new Event("resize"));
  settings.value = DEFAULT_SETTINGS;
  tabViews.value = [];
  activeTabIndex.value = -1;
  activeWorkspace.value = ROOT;
  repositoryScans.value = new Map();
  statusInfo.value = { branch: null, cwd: null, agent: null, paneCount: 1, home: "/home/test" };
  resetAgentDockState();
  resetRevealDockTabForTests();
  resetFileSurfaces();
  activeWorkspace.value = ROOT;
});

afterEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  window.dispatchEvent(new Event("resize"));
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  activeWorkspace.value = null;
  resetAgentDockState();
  resetFileSurfaces();
});

describe("file tabs in the dock strip", () => {
  it("lists opened files after the divider, and pressing one swaps the body", async () => {
    const files = testFileBodies({
      document: (root) => <p>editing {surfaceFor(root).activePath}</p>,
    });
    const view = await mount(dock(files));
    await act(async () => {
      await files.controller.openFile(ROOT, A, true);
      await files.controller.openFile(ROOT, B, true);
    });
    await settle();

    expect(tabNames()).toEqual(["a.ts", "b.ts"]);
    expect(selected()).toEqual(["b.ts"]);
    expect(bodyText()).toContain(`editing ${B}`);
    // Fixed icons first, then the divider, then the file tabs.
    const divider = strip().querySelector('[data-slot="separator"]') as HTMLElement;
    const firstTab = tabs()[0];
    expect(
      divider.compareDocumentPosition(firstTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(strip().querySelector('button[aria-label="Usage"]')).not.toBeNull();
    // A file holds the body, so no fixed icon reads as pressed.
    expect(strip().querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);

    await click(tabs()[0]);
    expect(selected()).toEqual(["a.ts"]);
    expect(bodyText()).toContain(`editing ${A}`);
    await view.unmount();
  });

  it("keeps the file tabs when a fixed icon takes the body, and the tab brings the file back", async () => {
    const files = testFileBodies({ document: () => <p>editing</p> });
    const view = await mount(dock(files));
    await act(async () => {
      await files.controller.openFile(ROOT, A, true);
    });
    await settle();
    expect(bodyText()).toContain("editing");

    await click(button("Usage"));
    expect(bodyText()).toContain("usage body");
    expect(bodyText()).not.toContain("editing");
    expect(tabNames()).toEqual(["a.ts"]);
    expect(selected()).toEqual([]);

    await click(tabs()[0]);
    expect(bodyText()).toContain("editing");
    expect(dockSurface.value).toBe("file");
    await view.unmount();
  });

  it("replaces the preview tab on the next single click and keeps it on a double click", async () => {
    const files = testFileBodies();
    const view = await mount(dock(files));
    await act(async () => {
      await files.controller.openFile(ROOT, A, false);
      await files.controller.openFile(ROOT, B, false);
    });
    await settle();
    expect(tabNames()).toEqual(["b.ts"]);
    expect(tabs()[0].querySelector("span.italic")?.textContent).toBe("b.ts");

    await act(async () => {
      tabs()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    await act(async () => {
      await files.controller.openFile(ROOT, C, false);
    });
    await settle();
    expect(tabNames()).toEqual(["b.ts", "c.md"]);
    expect(tabs()[0].querySelector("span.italic")).toBeNull();
    expect(tabs()[1].querySelector("span.italic")).not.toBeNull();
    await view.unmount();
  });

  it("asks before closing a file with unsaved work, and keeps it when refused", async () => {
    const confirmDiscard = vi.fn(async () => false);
    const files = testFileBodies({ confirmDiscard });
    const view = await mount(dock(files));
    await act(async () => {
      await files.controller.openFile(ROOT, A, true);
    });
    updateDocument(A, { dirty: true });
    await settle();
    expect(tabs()[0].getAttribute("aria-label")).toBe("a.ts, unsaved changes");

    await click(button("Close a.ts"));
    expect(confirmDiscard).toHaveBeenCalledWith([A]);
    expect(tabNames()).toEqual(["a.ts"]);

    confirmDiscard.mockResolvedValue(true);
    await click(button("Close a.ts"));
    await waitUntil(() => tabNames().length === 0);
    expect(documentFor(A)).toBeUndefined();
    // With no file left the body falls back to the selected view.
    expect(dockSurface.value).toBe("view");
    await view.unmount();
  });

  it("closes others, to the right and all from the right-click menu", async () => {
    const files = testFileBodies();
    const view = await mount(dock(files));
    await act(async () => {
      for (const path of [A, B, C]) {
        await files.controller.openFile(ROOT, path, true);
      }
    });
    await settle();

    await rightClick(tabs()[0]);
    await pick("Close to the right");
    await waitUntil(() => tabNames().length === 1);
    expect(tabNames()).toEqual(["a.ts"]);

    await act(async () => {
      await files.controller.openFile(ROOT, B, true);
      await files.controller.openFile(ROOT, C, true);
    });
    await settle();
    await rightClick(tabs()[1]);
    await pick("Close others");
    await waitUntil(() => tabNames().length === 1);
    expect(tabNames()).toEqual(["b.ts"]);

    await rightClick(tabs()[0]);
    await pick("Close all");
    await waitUntil(() => tabNames().length === 0);
    await view.unmount();
  });

  it("copies the path from the menu", async () => {
    const { writeText } = await import("../../host/shell-host");
    const files = testFileBodies();
    const view = await mount(dock(files));
    await act(async () => {
      await files.controller.openFile(ROOT, A, true);
    });
    await settle();
    await rightClick(tabs()[0]);
    await pick("Copy path");
    expect(writeText).toHaveBeenCalledWith(A);
    await view.unmount();
  });
});

describe("the Explorer tab behind +", () => {
  it("shows the project tree full width, and opening a file from it makes a file tab", async () => {
    const files = testFileBodies({
      client: treeClient,
      explorer: (root) => (
        <DockFileTree controller={files.controller} workspacePath={root} canCreate={false} />
      ),
    });
    const view = await mount(dock(files));
    await click(button("Open a file"));
    expect(selected()).toEqual(["Explorer"]);
    await waitUntil(() =>
      [...document.body.querySelectorAll('[role="treeitem"]')].some((r) =>
        (r.textContent ?? "").includes("tree-file.ts"),
      ),
    );
    const row = [...document.body.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((r) =>
      (r.textContent ?? "").includes("tree-file.ts"),
    ) as HTMLElement;
    await click(row);
    await waitUntil(() => tabNames().includes("tree-file.ts"));
    expect(tabNames()).toEqual(["tree-file.ts"]);
    expect(selected()).toEqual(["tree-file.ts"]);
    expect(dockSurface.value).toBe("file");
    await view.unmount();
  });

  it("goes back to the fixed view when closed with no file open", async () => {
    setDockView("usage");
    const view = await mount(dock());
    await click(button("Open a file"));
    expect(bodyText()).toContain("explorer body");
    await click(button("Close Explorer"));
    expect(bodyText()).toContain("usage body");
    await view.unmount();
  });
});

describe("the file body", () => {
  /** The ResizeObserver the body measures with, reporting `width` as soon as it is observed. */
  function observeWidth(width: number): void {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: (entries: unknown[]) => void) {}
        observe(): void {
          this.callback([{ contentRect: { width, height: 400 } }]);
        }
        disconnect(): void {}
      },
    );
  }

  async function mountBody() {
    const files = testFileBodies({ client: treeClient });
    const view = await mount(
      <DockFileBody controller={files.controller} workspacePath={ROOT} canCreate={false} />,
    );
    await act(async () => {
      await files.controller.openFile(ROOT, A, true);
    });
    await settle();
    return view;
  }

  const tree = (): Element | null => document.body.querySelector('[role="tree"]');

  it("hides the tree pane below 560px and the breadcrumb button toggles it", async () => {
    observeWidth(400);
    const view = await mountBody();
    expect(tree()).toBeNull();
    expect(button("Show the file tree").getAttribute("aria-pressed")).toBe("false");

    await click(button("Show the file tree"));
    expect(tree()).not.toBeNull();
    await click(button("Hide the file tree"));
    expect(tree()).toBeNull();
    await view.unmount();
  });

  it("shows the tree pane by default in a wide dock", async () => {
    observeWidth(700);
    const view = await mountBody();
    await waitUntil(() => tree() !== null);
    await view.unmount();
  });

  it("writes the path as folder buttons and a bold file, and a folder shows the pane", async () => {
    observeWidth(400);
    const view = await mountBody();
    const path = document.body.querySelector('[aria-label="File path"]') as HTMLElement;
    expect([...path.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["src", "ui"]);
    expect(path.querySelector("b")?.textContent).toBe("a.ts");

    const folder = path.querySelector("button") as HTMLElement;
    await click(folder);
    expect(tree()).not.toBeNull();
    await view.unmount();
  });
});
