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

import type { ColorizeLines } from "../../files/changes/colorize-lines";
import type { DiffSidesPorts } from "../../files/changes/diff-sides";
import type { ReadFileResponse } from "../../files/file-client";
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
/** Monaco's colorizer stand-in: never answers unless a test says how it colours. */
let colorize: ColorizeLines;
const files = testFileBodies().controller;

function stack(entries: ChangeEntry[]) {
  return (
    <DockChangesStack
      root={ROOT}
      entries={entries}
      initial={false}
      controller={files}
      reads={1}
      markedPath={null}
      ports={ports}
      colorize={colorize}
    />
  );
}

/** A loaded card's lines as `[old number, new number, sign, code]`, what the eye reads. */
const lineCells = (path: string): string[][] =>
  [...card(path).querySelectorAll<HTMLElement>("[data-line]")].map((line) =>
    [...line.children].map((cell) => cell.textContent ?? ""),
  );

beforeEach(() => {
  resetAgentDockState();
  colorize = vi.fn(async () => new Promise<readonly string[]>(() => {}));
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

  it("shows a loaded card's lines under a hunk header, numbered on the side each is on", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    expect(card("src/a.ts").textContent).toContain("@@ -1,3 +1,3 @@");
    expect(lineCells("src/a.ts")).toEqual([
      ["1", "1", " ", "keep"],
      ["2", "", "-", "old line"],
      ["", "2", "+", "new line"],
      ["3", "3", " ", "end"],
    ]);
    await view.unmount();
  });

  it("colours each line from its own side once the colorizer answers, plain until then", async () => {
    // Both sides colour as TypeScript, each answer held until the test lets it through.
    const pending: (() => void)[] = [];
    colorize = vi.fn(
      (text: string, language: string) =>
        new Promise<readonly string[]>((resolve) => {
          expect(language).toBe("typescript");
          pending.push(() =>
            resolve(
              text.split("\n").map((line) => `<span><span class="mtk5">${line}</span></span>`),
            ),
          );
        }),
    );
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    const code = (kind: string): HTMLElement =>
      card("src/a.ts").querySelector(`[data-line="${kind}"]`)?.lastElementChild as HTMLElement;
    expect(code("del").querySelector(".mtk5")).toBeNull();
    expect(code("del").textContent).toBe("old line");

    await act(async () => {
      for (const resolve of pending) {
        resolve();
      }
    });
    await settle();
    expect(code("del").querySelector(".mtk5")?.textContent).toBe("old line");
    expect(code("add").querySelector(".mtk5")?.textContent).toBe("new line");
    expect(code("context").querySelector(".mtk5")?.textContent).toBe("keep");
    await view.unmount();
  });

  it("leaves a file with no known language plain and asks no colorizer", async () => {
    const view = await mount(stack([entry("notes.unknownext")]));
    await reveal("notes.unknownext");
    expect(lineCells("notes.unknownext").map((cells) => cells[3])).toEqual([
      "keep",
      "old line",
      "new line",
      "end",
    ]);
    expect(colorize).not.toHaveBeenCalled();
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

  it("opens the real file as a dock tab when the file name is pressed", async () => {
    const open = vi.spyOn(files, "openFile").mockResolvedValue(undefined);
    const view = await mount(stack([entry("src/a.ts")]));
    await click(card("src/a.ts").querySelector('button[title="src/a.ts"]') as HTMLElement);
    expect(open).toHaveBeenCalledWith(ROOT, `${ROOT}/src/a.ts`, true);
    await settle();
    expect(dockSurface.value).toBe("file");
    open.mockRestore();
    await view.unmount();
  });

  it("folds a card with the chevron and unfolds it without reading the sides again", async () => {
    const view = await mount(stack([entry("src/a.ts")]));
    await reveal("src/a.ts");
    expect(ports.readFile).toHaveBeenCalledTimes(1);
    const chevron = card("src/a.ts").querySelector("button[aria-expanded]") as HTMLElement;

    await click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    expect(card("src/a.ts").querySelector("[data-line]")).toBeNull();

    await click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
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
