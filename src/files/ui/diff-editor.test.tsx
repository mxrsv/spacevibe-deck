// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor-host", async () => {
  const actual = await vi.importActual<typeof import("../editor-host")>("../editor-host");
  const { loadStubbedMonaco } = await import("./monaco-diff-stub");
  return { ...actual, loadMonaco: loadStubbedMonaco };
});

import { editorSettings } from "../file-surface-controller";
import { settings } from "../../settings/settings-store";
import { DiffEditor, type DiffEditorControls, type TextSides } from "./diff-editor";
import { resetStub, stub } from "./monaco-diff-stub";

const side = (text: string, language: string | null = "typescript") => ({ text, language });

function sides(over: Partial<TextSides> = {}): TextSides {
  return {
    kind: "text",
    original: side("const a = 1;\n"),
    modified: side("const a = 2;\n"),
    oneSided: false,
    note: null,
    ...over,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  resetStub();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

async function mount(
  props: { sides: TextSides; fileKey?: string },
  controls?: { current: DiffEditorControls | null },
): Promise<void> {
  act(() => render(<DiffEditor fileKey="r\0a.ts" controls={controls} {...props} />, host));
  await settle();
}

describe("a file with two sides", () => {
  it("is a read-only diff with nothing that writes to git (CHG5)", async () => {
    await mount({ sides: sides() });
    const options = stub.diffOptions!;
    expect(stub.log).toContain("create-diff");
    expect(options.readOnly).toBe(true);
    expect(options.originalEditable).toBe(false);
    expect(options.renderMarginRevertIcon).toBe(false);
    expect(options.renderGutterMenu).toBe(false);
  });

  it("keeps whitespace, folds unchanged runs, wraps nothing and draws no chrome", async () => {
    await mount({ sides: sides() });
    const options = stub.diffOptions!;
    expect(options.ignoreTrimWhitespace).toBe(false);
    expect(options.hideUnchangedRegions).toMatchObject({ enabled: true });
    expect(options.wordWrap).toBe("off");
    expect(options.minimap).toEqual({ enabled: false });
    expect(options.scrollbar).toEqual({ useShadows: false });
    expect(options.automaticLayout).toBe(true);
  });

  it("switches to one view at Monaco's 900px breakpoint, and no other", async () => {
    await mount({ sides: sides() });
    expect(stub.diffOptions!.useInlineViewWhenSpaceIsLimited).toBe(true);
    expect(stub.diffOptions!.renderSideBySideInlineBreakpoint).toBe(900);
  });

  it("gives each side its own model and language", async () => {
    await mount({ sides: sides({ original: side("a", "css"), modified: side("b", null) }) });
    expect(stub.models.map((model) => [model.text, model.language])).toEqual([
      ["a", "css"],
      ["b", undefined],
    ]);
    expect(stub.shown).toEqual(stub.models);
  });
});

describe("a file with one side", () => {
  it("is a plain read-only editor, never a diff against an empty model", async () => {
    await mount({ sides: sides({ original: side(""), modified: side("a\nb\n"), oneSided: true }) });
    expect(stub.log).toContain("create-whole");
    expect(stub.log).not.toContain("create-diff");
    expect(stub.wholeOptions!.readOnly).toBe(true);
    expect(stub.models.map((model) => model.text)).toEqual(["a\nb\n"]);
  });

  it("marks every added line with Monaco's own insert decoration", async () => {
    await mount({
      sides: sides({ original: side(""), modified: side("a\nb\nc"), oneSided: true }),
    });
    expect(stub.decorations).toMatchObject([
      {
        range: { startLineNumber: 1, endLineNumber: 3 },
        options: {
          isWholeLine: true,
          className: "line-insert",
          marginClassName: "gutter-insert",
          linesDecorationsClassName: expect.stringContaining("codicon-diff-insert"),
        },
      },
    ]);
  });

  it("shows the old side with the delete decoration for a deleted file", async () => {
    await mount({ sides: sides({ original: side("x\ny\n"), modified: side(""), oneSided: true }) });
    expect(stub.models.map((model) => model.text)).toEqual(["x\ny\n"]);
    // A trailing newline leaves an empty last line that is not part of the file.
    expect(stub.decorations).toMatchObject([
      {
        range: { endLineNumber: 2 },
        options: { className: "line-delete", marginClassName: "gutter-delete" },
      },
    ]);
  });

  it("decorates nothing when both sides are empty", async () => {
    await mount({ sides: sides({ original: side(""), modified: side(""), oneSided: true }) });
    expect(stub.decorations).toEqual([]);
  });
});

describe("the models' lifetimes", () => {
  it("swaps changed text for new models first, then lets the old ones go", async () => {
    await mount({ sides: sides() });
    stub.log = [];
    await mount({ sides: sides({ modified: side("const a = 3;\n") }) });
    expect(stub.log).toEqual(["set-model", "dispose-model", "dispose-model"]);
    expect(stub.models.map((model) => model.disposed)).toEqual([true, true, false, false]);
  });

  it("keeps scroll and cursor across a new text of the same file", async () => {
    await mount({ sides: sides() });
    await mount({ sides: sides({ modified: side("const a = 3;\n") }) });
    expect(stub.viewStatesSaved).toBe(1);
    expect(stub.viewStatesRestored).toBe(1);
  });

  it("starts at the top for another file", async () => {
    await mount({ sides: sides(), fileKey: "r\0a.ts" });
    await mount({ sides: sides({ modified: side("other") }), fileKey: "r\0b.ts" });
    expect(stub.viewStatesRestored).toBe(0);
  });

  it("disposes the editor before its models on unmount", async () => {
    await mount({ sides: sides() });
    stub.log = [];
    act(() => render(null, host));
    expect(stub.log).toEqual(["dispose-editor", "dispose-model", "dispose-model"]);
  });

  it("swaps editors when a file goes from two sides to one", async () => {
    await mount({ sides: sides() });
    stub.log = [];
    await mount({ sides: sides({ original: side(""), oneSided: true }) });
    expect(stub.log.slice(0, 3)).toEqual(["dispose-editor", "dispose-model", "dispose-model"]);
    expect(stub.log).toContain("create-whole");
  });
});

describe("under GUI zoom", () => {
  // `useSignalEffect` re-runs on an animation frame, not in the act that set the signal.
  const frame = () =>
    act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
  const before = settings.value;

  afterEach(() => {
    vi.unstubAllGlobals();
    settings.value = before;
    editorSettings.value = null;
  });

  it.each([
    ["two sides", () => sides(), () => stub.diffOptions],
    ["one side", () => sides({ original: side(""), oneSided: true }), () => stub.wholeOptions],
  ])("starts a %s at the font size divided by the zoom", async (_name, make, options) => {
    vi.stubGlobal("__deckHost", {});
    settings.value = { ...before, fontSize: 14, guiZoom: 1.25 };
    await mount({ sides: make() });
    expect(options()!.fontSize).toBe(11.2);
  });

  it("recompensates when the zoom changes while the diff is open", async () => {
    vi.stubGlobal("__deckHost", {});
    settings.value = { ...before, fontSize: 14, guiZoom: 1.25 };
    await mount({ sides: sides() });

    await act(async () => {
      settings.value = { ...settings.value, guiZoom: 0.9 };
      editorSettings.value = settings.value;
    });
    await frame();

    expect(stub.updates.at(-1)?.fontSize).toBe(15.556);
  });

  it("leaves the size alone without the Electron host", async () => {
    settings.value = { ...before, fontSize: 14, guiZoom: 1.25 };
    await mount({ sides: sides() });
    expect(stub.diffOptions!.fontSize).toBe(14);

    await act(async () => {
      editorSettings.value = { ...settings.value, guiZoom: 0.9 };
    });
    await frame();
    expect(stub.updates.at(-1)?.fontSize).toBe(14);
  });
});

describe("controls", () => {
  it("n and p ask the diff for the next and previous change", async () => {
    const controls: { current: DiffEditorControls | null } = { current: null };
    await mount({ sides: sides() }, controls);
    controls.current!.goToChange("next");
    controls.current!.goToChange("previous");
    expect(stub.goToDiff).toEqual(["next", "previous"]);
  });

  it("has no change to go to in a one-sided file", async () => {
    const controls: { current: DiffEditorControls | null } = { current: null };
    await mount({ sides: sides({ original: side(""), oneSided: true }) }, controls);
    controls.current!.goToChange("next");
    expect(stub.goToDiff).toEqual([]);
  });

  it("focuses the modified side", async () => {
    const controls: { current: DiffEditorControls | null } = { current: null };
    await mount({ sides: sides() }, controls);
    controls.current!.focus();
    expect(stub.focused).toEqual(["modified"]);
  });

  it("empties its controls on unmount", async () => {
    const controls: { current: DiffEditorControls | null } = { current: null };
    await mount({ sides: sides() }, controls);
    act(() => render(null, host));
    expect(controls.current).toBeNull();
  });
});

describe("the file editor's slot", () => {
  it("is never registered: the diff is not a document", () => {
    const source = readFileSync("src/files/ui/diff-editor.tsx", "utf8");
    expect(source).not.toMatch(/\.setEditor(Focus|Edit)\(/);
  });
});
