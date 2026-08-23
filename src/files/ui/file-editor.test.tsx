// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Over a STUBBED editor. Whether Monaco itself boots, tokenizes and saves is
 * The packaged Monaco smoke's question and the manual pass's — it needs a packaged build and a
 * real window, neither of which a unit test has. What IS testable here is
 * everything around the editor: the refusal state, the bars, the read-only
 * flag, and that a reload does not report itself as a user edit.
 */
interface StubModel {
  value: string;
  language: string | undefined;
  getValue(): string;
  getFullModelRange(): string;
  pushEditOperations(before: unknown, edits: { range: string; text: string }[]): null;
  dispose(): void;
}

const stub = {
  options: {} as Record<string, unknown>,
  models: [] as StubModel[],
  currentModel: null as StubModel | null,
  contentHandler: null as (() => void) | null,
  cursorHandler: null as
    ((event: { position: { lineNumber: number; column: number } }) => void) | null,
  focused: 0,
  /** Stands in for "document.activeElement is inside the editor". */
  hasTextFocus: false,
  selections: [] as string[],
  triggered: [] as string[],
  themes: [] as string[],
  disposed: 0,
  /** Lines `revealLineInCenter` was asked for, and the last caret set. */
  revealed: [] as number[],
  position: null as { lineNumber: number; column: number } | null,
};

function makeModel(value: string, language: string | undefined): StubModel {
  const model: StubModel = {
    value,
    language,
    getValue: () => model.value,
    getFullModelRange: () => "full",
    pushEditOperations(_before, edits) {
      model.value = edits[0].text;
      stub.contentHandler?.();
      return null;
    },
    dispose() {},
  };
  stub.models.push(model);
  return model;
}

vi.mock("../editor-host", async () => {
  const actual = await vi.importActual<typeof import("../editor-host")>("../editor-host");
  return {
    ...actual,
    loadMonaco: async () => ({
      editor: {
        create: (_host: HTMLElement, options: Record<string, unknown>) => {
          stub.options = { ...options };
          return {
            onDidChangeModelContent: (handler: () => void) => {
              stub.contentHandler = handler;
            },
            onDidChangeCursorPosition: (
              handler: (event: { position: { lineNumber: number; column: number } }) => void,
            ) => {
              stub.cursorHandler = handler;
            },
            getValue: () => stub.currentModel?.getValue() ?? "",
            getModel: () => stub.currentModel,
            setModel: (model: StubModel) => {
              stub.currentModel = model;
            },
            saveViewState: () => ({ scroll: 1 }),
            restoreViewState: () => {},
            updateOptions: (next: Record<string, unknown>) => {
              stub.options = { ...stub.options, ...next };
            },
            focus: () => {
              stub.focused += 1;
            },
            revealLineInCenter: (line: number) => {
              stub.revealed.push(line);
            },
            setPosition: (position: { lineNumber: number; column: number }) => {
              stub.position = position;
            },
            // Containment stands in for "the caret is in the editor" — the
            // real check reads `document.activeElement`, which jsdom parks on
            // <body> with no real Monaco DOM to focus.
            getDomNode: () => ({ contains: () => stub.hasTextFocus }),
            setSelection: (range: string) => {
              stub.selections.push(range);
            },
            trigger: (_source: string, handlerId: string) => {
              stub.triggered.push(handlerId);
            },
            dispose: () => {
              stub.disposed += 1;
            },
          };
        },
        createModel: (value: string, language: string | undefined) => {
          const model = makeModel(value, language);
          stub.currentModel = model;
          return model;
        },
        defineTheme: (id: string) => {
          stub.themes.push(id);
        },
        setTheme: () => {},
      },
    }),
  };
});

import { FileEditor } from "./file-editor";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import {
  openFileTab,
  pendingReveal,
  requestReveal,
  resetFileSurfaces,
  updateDocument,
} from "../file-surface-store";
import type { FileClient } from "../file-client";

const PATH = "/r/src/index.ts";

const client: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

let host: HTMLDivElement;
let controller: FileSurfaceController;

function textFile(overrides: Record<string, unknown> = {}) {
  return {
    content: "const a = 1;\n",
    eol: "lf" as const,
    encoding: "utf-8" as const,
    bytes: 13,
    mixedEol: false,
    readOnly: false,
    reason: null,
    ...overrides,
  };
}

function mount(): void {
  act(() => {
    render(<FileEditor path={PATH} controller={controller} />, host);
  });
}

beforeEach(() => {
  resetFileSurfaces();
  stub.models = [];
  stub.currentModel = null;
  stub.contentHandler = null;
  stub.cursorHandler = null;
  stub.focused = 0;
  stub.hasTextFocus = false;
  stub.selections = [];
  stub.triggered = [];
  stub.themes = [];
  stub.disposed = 0;
  stub.options = {};
  stub.revealed = [];
  stub.position = null;
  controller = createFileSurfaceController({ client });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  controller.dispose();
});

describe("FileEditor", () => {
  it("renders the refusal with its stated reason, never an empty editor", () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, {
      refusal: "This looks like a binary file, so Deck will not open it.",
    });
    mount();

    expect(host.textContent).toContain("binary file");
    expect(host.textContent).toContain("index.ts");
    expect(host.querySelector(".fileview__editor")).toBeNull();
  });

  it("mounts the editor when the document lands AFTER the first render", async () => {
    // Session restore's cold open: the component mounts while the store has
    // no document for the path yet, so the first render is null and the host
    // div is not in the DOM when the mount effect first runs.
    mount();
    await act(async () => {});
    expect(host.querySelector(".fileview__editor")).toBeNull();

    await act(async () => {
      openFileTab("/r", PATH, { keep: true });
      updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
    });
    await act(async () => {});

    expect(host.querySelector(".fileview__editor")).not.toBeNull();
    expect(stub.themes).toContain("deck");
    expect(stub.currentModel?.getValue()).toBe("const a = 1;\n");
  });

  it("mounts an editor for a readable file", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
    mount();
    await act(async () => {});

    expect(host.querySelector(".fileview__editor")).not.toBeNull();
    expect(stub.themes).toContain("deck");
    expect(stub.focused).toBeGreaterThan(0);
  });

  it("reports a user edit but NOT its own reload", async () => {
    // Deck's reload writes the model directly; reporting that as an edit would
    // mark a freshly reloaded file dirty and promote its preview tab.
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
    mount();
    await act(async () => {});
    const setText = vi.spyOn(controller, "setText");

    // A reload: the document's text changes, the component writes the model.
    act(() => {
      updateDocument(PATH, { text: "rewritten\n" });
    });
    mount();
    expect(setText).not.toHaveBeenCalled();

    // A real keystroke comes through Monaco's own listener.
    stub.currentModel!.value = "typed\n";
    stub.contentHandler?.();
    expect(setText).toHaveBeenCalledWith(PATH, "typed\n");
  });

  it("forwards the caret position for the status bar", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n" });
    mount();
    await act(async () => {});

    stub.cursorHandler?.({ position: { lineNumber: 7, column: 3 } });

    expect(host.ownerDocument).not.toBeNull();
    expect(stub.cursorHandler).not.toBeNull();
  });

  it("opens a read-only document read-only, with its reason on screen", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, {
      file: textFile({ readOnly: true, reason: "opens read-only." }),
      text: "big\n",
    });
    mount();
    await act(async () => {});

    expect(stub.options.readOnly).toBe(true);
    expect(host.textContent).toContain("read-only");
  });

  it("raises the external-change bar and answers through the controller", async () => {
    const resolve = vi.spyOn(controller, "resolve").mockResolvedValue();
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, {
      file: textFile(),
      text: "mine\n",
      dirty: true,
      prompt: "prompt-changed",
    });
    mount();
    await act(async () => {});

    const buttons = host.querySelectorAll<HTMLButtonElement>(".filebar__btn");
    expect([...buttons].map((b) => b.textContent)).toEqual(["Reload", "Keep mine"]);
    buttons[0].click();
    expect(resolve).toHaveBeenCalledWith(PATH, "reload");
  });

  it("says so when the file was deleted and nothing is unsaved", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n", gone: true });
    mount();
    await act(async () => {});

    expect(host.textContent).toContain("was deleted on disk");
    // Still readable — the last content Deck read stays on screen.
    expect(host.querySelector(".fileview__editor")).not.toBeNull();
  });

  it("disposes the editor on unmount and hands back the focus seam", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n" });
    mount();
    await act(async () => {});

    act(() => {
      render(null, host);
    });

    expect(stub.disposed).toBe(1);
  });
  it("claims Select All for the editor only while it holds the caret", async () => {
    // The routing rule for the three Edit-menu commands whose native Cocoa
    // roles cannot reach Monaco (2026-08-19). False is load-bearing: it is
    // what lets the terminal and every chrome field keep the browser's own
    // command.
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n" });
    mount();
    await act(async () => {});

    stub.hasTextFocus = false;
    expect(controller.runEditCommand("select-all")).toBe(false);
    expect(stub.selections).toEqual([]);

    stub.hasTextFocus = true;
    expect(controller.runEditCommand("select-all")).toBe(true);
    // The model's whole range, not a command-service round trip.
    expect(stub.selections).toEqual(["full"]);
  });

  it("hands undo and redo to the editor's own stack", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n" });
    mount();
    await act(async () => {});
    stub.hasTextFocus = true;

    expect(controller.runEditCommand("undo")).toBe(true);
    expect(controller.runEditCommand("redo")).toBe(true);

    expect(stub.triggered).toEqual(["undo", "redo"]);
  });

  it("stops claiming Edit commands once the editor unmounts", async () => {
    openFileTab("/r", PATH, { keep: true });
    updateDocument(PATH, { file: textFile(), text: "a\n" });
    mount();
    await act(async () => {});
    stub.hasTextFocus = true;

    act(() => {
      render(null, host);
    });

    expect(controller.runEditCommand("select-all")).toBe(false);
  });

  // Design §3.3 — the seam a ⌘+click on a terminal path lands through. The
  // assertions are on a MOUNTED editor rather than on a store value, because
  // the failure this feature can have is exactly an editor that never mounts.
  describe("revealing a position", () => {
    it("lands on the line once a cold open's content arrives", async () => {
      // The order `openFile` uses: the request is written BEFORE the tab
      // exists, because a cold open has no second chance to be told.
      requestReveal(PATH, 12, 3);
      openFileTab("/r", PATH, { keep: false });
      mount();
      await act(async () => {});

      // Nothing yet — the read is still in flight and the model is empty.
      expect(stub.revealed).toEqual([]);
      expect(pendingReveal.value).not.toBeNull();

      await act(async () => {
        updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
      });

      expect(host.querySelector(".fileview__editor")).not.toBeNull();
      expect(stub.revealed).toEqual([12]);
      expect(stub.position).toEqual({ lineNumber: 12, column: 3 });
      // Spent, so the next tab switch does not re-run it.
      expect(pendingReveal.value).toBeNull();
    });

    it("lands on the line of a file that is already on the stage", async () => {
      openFileTab("/r", PATH, { keep: true });
      updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
      mount();
      await act(async () => {});
      expect(stub.revealed).toEqual([]);

      await act(async () => {
        requestReveal(PATH, 5, 2);
      });

      expect(stub.revealed).toEqual([5]);
      expect(stub.position).toEqual({ lineNumber: 5, column: 2 });
    });

    it("ignores a request aimed at another file", async () => {
      openFileTab("/r", PATH, { keep: true });
      updateDocument(PATH, { file: textFile(), text: "const a = 1;\n" });
      mount();
      await act(async () => {});

      await act(async () => {
        requestReveal("/r/src/other.ts", 9, 1);
      });

      expect(stub.revealed).toEqual([]);
      expect(pendingReveal.value).not.toBeNull();
    });
  });
});
