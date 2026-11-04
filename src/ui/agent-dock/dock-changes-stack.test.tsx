// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The stack's import graph reaches the host (file channel, git channel): stub it as the dock's
// own tests do. Every read in these tests goes through the injected ports.
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

import type { DiffSidesPorts } from "../../files/changes/diff-sides";
import type { ReadFileResponse } from "../../files/file-client";
import { resetFileSurfaces, surfaceFor } from "../../files/file-surface-store";
import type { ChangeEntry } from "../../host/git-changes-host";
import { click, mount, settle } from "../controls/preset-test-kit";
import { dockSurface, resetAgentDockState } from "./agent-dock-state";
import { DockChangesStack } from "./dock-changes-stack";
import { testFileBodies } from "./dock-files-test-kit";

const ROOT = "/work/repo";

const entry = (path: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  path,
  status: "modified",
  oldPath: null,
  added: 1,
  removed: 1,
  binary: false,
  counted: true,
  ...over,
});

/** The stubbed observer: a test says which cards are near the viewport. */
const observed = new Map<Element, (visible: boolean) => void>();
class StubObserver {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    observed.set(target, (isIntersecting) =>
      this.callback([{ isIntersecting, target } as IntersectionObserverEntry], this as never),
    );
  }
  disconnect(): void {
    observed.clear();
  }
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const card = (path: string): HTMLElement =>
  [...document.body.querySelectorAll<HTMLElement>("[data-card-path]")].find(
    (element) => element.dataset.cardPath === path,
  ) as HTMLElement;

const pathButton = (path: string): HTMLElement =>
  card(path).querySelector(`button[title="${path}"]`) as HTMLElement;
const openIcon = (path: string): HTMLElement | null =>
  card(path).querySelector<HTMLElement>('button[aria-label="Open in File"]');
const chevron = (path: string): HTMLElement =>
  card(path).querySelector("button[aria-expanded]") as HTMLElement;

async function reveal(path: string): Promise<void> {
  await act(async () => observed.get(card(path))?.(true));
  await settle();
}

const okRead = (content: string): ReadFileResponse => ({
  kind: "ok" as const,
  content,
  eol: "lf" as const,
  encoding: "utf-8" as const,
  bytes: content.length,
  mixedEol: false,
  readOnly: false,
  reason: null,
  mtimeMs: 1,
  size: content.length,
  writable: true,
});

let ports: DiffSidesPorts;
const files = testFileBodies().controller;

function stack(entries: ChangeEntry[]) {
  return (
    <DockChangesStack
      root={ROOT}
      entries={entries}
      initial={false}
      controller={files}
      reads={1}
      ports={ports}
    />
  );
}

beforeEach(() => {
  resetAgentDockState();
  vi.stubGlobal("IntersectionObserver", StubObserver);
  ports = {
    statFiles: vi.fn(async (_root: string, paths: readonly string[]) =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 20 })),
    ),
    readFile: vi.fn(async () => okRead("keep\nnew line\nend\n")),
    readHeadFile: vi.fn(async () => ({
      kind: "ok" as const,
      content: "keep\nold line\nend\n",
      eol: "lf" as const,
      encoding: "utf-8" as const,
      bytes: 18,
      mixedEol: false,
    })),
  };
});

afterEach(() => {
  observed.clear();
  vi.unstubAllGlobals();
  resetAgentDockState();
  resetFileSurfaces();
});

describe("the Changes stack", () => {
  it("mounts one header per entry and reads only the cards the observer reports near", async () => {
    const entries = Array.from({ length: 65 }, (_, i) => entry(`src/f${i}.ts`));
    const view = await mount(stack(entries));
    expect(document.body.querySelectorAll("[data-card-path]")).toHaveLength(65);
    expect(ports.readFile).not.toHaveBeenCalled();

    await reveal("src/f0.ts");
    await reveal("src/f1.ts");
    expect(ports.readFile).toHaveBeenCalledTimes(2);
    expect(card("src/f2.ts").textContent).not.toContain("new line");
    await view.unmount();
  });

  it("shows a loaded card's added and removed lines under a hunk header", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    const kinds = (kind: string) =>
      [...card("src/a.ts").querySelectorAll(`[data-line="${kind}"]`)].map(
        (line) => line.lastElementChild?.textContent,
      );
    expect(kinds("add")).toEqual(["new line"]);
    expect(kinds("del")).toEqual(["old line"]);
    expect(card("src/a.ts").textContent).toContain("@@ -1,3 +1,3 @@");
    await view.unmount();
  });

  it("numbers each line in a gutter the copy and the reader skip: old for removed, new otherwise", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    const lines = [...card("src/a.ts").querySelectorAll<HTMLElement>("[data-line]")];
    const shown = lines.map((line) => {
      const [gutter, sign, code] = [...line.children] as HTMLElement[];
      return `${gutter.textContent} ${sign.textContent}${code.textContent}`;
    });
    expect(shown).toEqual(["1  keep", "2 -old line", "2 +new line", "3  end"]);
    const gutter = lines[0].firstElementChild as HTMLElement;
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    expect(gutter.className).toContain("select-none");
    // The number takes the change's ink, so the change reads from the gutter alone.
    expect((lines[2].firstElementChild as HTMLElement).className).toContain("text-(--term-ok)");
    expect((lines[1].firstElementChild as HTMLElement).className).toContain("text-(--term-err)");
    await view.unmount();
  });

  it("prints binary, too-large and unreadable files as one line", async () => {
    ports.readHeadFile = vi.fn(async (_root: string, path: string) =>
      path === "big.txt"
        ? { kind: "too-large" as const, bytes: 9_000_000 }
        : { kind: "absent" as const },
    );
    const view = await mount(
      stack([entry("pic.png", { binary: true }), entry("big.txt"), entry("gone.txt")]),
    );
    await reveal("pic.png");
    await reveal("big.txt");
    await reveal("gone.txt");
    expect(card("pic.png").textContent).toContain("Binary file.");
    expect(card("big.txt").textContent).toContain("too large");
    expect(card("gone.txt").textContent).toContain("not in HEAD");
    await view.unmount();
  });

  it("adds a preview tab when the path is pressed, and stays on Changes without folding", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await click(pathButton("src/a.ts"));
    await settle();
    expect(surfaceFor(ROOT).tabs).toEqual([
      expect.objectContaining({ path: `${ROOT}/src/a.ts`, preview: true }),
    ]);
    expect(dockSurface.value).toBe("view");
    expect(chevron("src/a.ts").getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });

  it("opens the file as a kept tab and shows it from the open icon, without folding", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await click(openIcon("src/a.ts") as HTMLElement);
    await settle();
    expect(surfaceFor(ROOT).tabs).toEqual([
      expect.objectContaining({ path: `${ROOT}/src/a.ts`, preview: false }),
    ]);
    expect(dockSurface.value).toBe("file");
    expect(chevron("src/a.ts").getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });

  it("offers no open icon for a deleted file", async () => {
    const view = await mount(
      stack([entry("src/a.ts"), entry("src/gone.ts", { status: "deleted" })]),
    );
    expect(openIcon("src/a.ts")).not.toBeNull();
    expect(openIcon("src/gone.ts")).toBeNull();
    await view.unmount();
  });

  it("folds a card from any empty part of its header, the counts included", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    const header = card("src/a.ts").querySelector(".sticky") as HTMLElement;
    await click(header);
    expect(chevron("src/a.ts").getAttribute("aria-expanded")).toBe("false");
    await click(
      [...header.querySelectorAll("span")].find((s) => s.textContent === "+1") as HTMLElement,
    );
    expect(chevron("src/a.ts").getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });

  it("shows the repo-relative path with the name last, and no status letter", async () => {
    const view = await mount(stack([entry("src/ui/a.ts"), entry("top.md")]));
    const path = pathButton("src/ui/a.ts");
    const shown = (button: HTMLElement): string =>
      [...button.childNodes]
        .filter((node) => !(node instanceof HTMLElement && node.classList.contains("sr-only")))
        .map((node) => node.textContent)
        .join("");
    expect(shown(path)).toBe("src/ui/a.ts");
    expect(path.lastElementChild?.textContent?.trim()).toBe("(Modified)");
    // A file at the root has no folder part and no slash.
    expect(shown(pathButton("top.md"))).toBe("top.md");
    expect(card("src/ui/a.ts").querySelector('[role="img"]')).toBeNull();
    await view.unmount();
  });

  it("prints a zero side of the counts in neutral ink, the other in green or red", async () => {
    const view = await mount(
      stack([entry("src/new.ts", { status: "added", added: 3, removed: 0 })]),
    );
    const side = (text: string): HTMLElement =>
      [...card("src/new.ts").querySelectorAll<HTMLElement>("span")].find(
        (s) => s.textContent === text,
      ) as HTMLElement;
    expect(side("+3").className).toBe("text-(--term-ok)");
    expect(side("−0").className).toBe("text-muted-foreground");
    await view.unmount();
  });

  it("strikes a deleted file's name and leaves nothing to open", async () => {
    const view = await mount(stack([entry("src/gone.ts", { status: "deleted" })]));
    const path = pathButton("src/gone.ts");
    expect(path.hasAttribute("disabled")).toBe(true);
    const name = [...path.querySelectorAll("span")].find((s) => s.textContent === "gone.ts");
    expect(name?.classList.contains("line-through")).toBe(true);
    await view.unmount();
  });

  it("says a file was renamed from outside the folder above its lines", async () => {
    const view = await mount(
      stack([entry("src/moved.ts", { status: "renamed", oldPath: null, added: 3, removed: 0 })]),
    );
    await reveal("src/moved.ts");
    expect(card("src/moved.ts").textContent).toContain("Renamed from outside this folder");
    expect(card("src/moved.ts").querySelector('[data-line="add"]')).not.toBeNull();
    await view.unmount();
  });

  it("folds a card with the chevron and unfolds it without reading the sides again", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    expect(ports.readFile).toHaveBeenCalledTimes(1);
    const fold = chevron("src/a.ts");

    await click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(card("src/a.ts").querySelector("[data-line]")).toBeNull();

    await click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(card("src/a.ts").querySelector('[data-line="add"]')).not.toBeNull();
    expect(ports.readFile).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("reads a near card again for a new read of the checkout, and a changed entry", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    await view.update(stack([entry("src/a.ts")]));
    expect(ports.readFile).toHaveBeenCalledTimes(1);
    await view.update(stack([entry("src/a.ts", { added: 4 })]));
    expect(ports.readFile).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
