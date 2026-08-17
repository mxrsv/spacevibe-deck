// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Over a STUBBED editor. Whether Monaco itself boots, tokenizes and saves is
 * Gate M's question and the manual pass's — it needs a packaged build and a
 * real window, neither of which a unit test has. What IS testable here is
 * everything around the editor: the refusal state, the bars, the read-only
 * flag, and that a reload does not report itself as a user edit.
 */
interface StubModel {
  value: string;
  language: string | undefined;
  getValue(): string;
  getFullModelRange(): string;
  pushEditOperations(
    before: unknown,
    edits: { range: string; text: string }[],
  ): null;
  dispose(): void;
}

const stub = {
  options: {} as Record<string, unknown>,
  models: [] as StubModel[],
  currentModel: null as StubModel | null,
  contentHandler: null as (() => void) | null,
  cursorHandler: null as
    | ((event: { position: { lineNumber: number; column: number } }) => void)
    | null,
  focused: 0,
  themes: [] as string[],
  disposed: 0,
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
  const actual =
    await vi.importActual<typeof import("../editor-host")>("../editor-host");
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
              handler: (event: {
                position: { lineNumber: number; column: number };
              }) => void,
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
  stub.themes = [];
  stub.disposed = 0;
  stub.options = {};
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
    expect([...buttons].map((b) => b.textContent)).toEqual([
      "Reload",
      "Keep mine",
    ]);
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
});
