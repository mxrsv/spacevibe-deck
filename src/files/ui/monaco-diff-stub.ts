/**
 * A stand-in for the slice of Monaco the diff editor uses, shared by
 * `diff-editor.test.tsx` and `diff-column.test.tsx`. Whether Monaco computes a
 * diff, tokenizes and paints is the packaged smoke's question and the
 * gallery's; what a unit test can pin is everything around it: the options
 * handed over, the models' lifetimes, and what the keys call.
 */

export interface StubModel {
  readonly text: string;
  readonly language: string | undefined;
  disposed: boolean;
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
  dispose(): void;
}

export const stub = {
  /** Ordered: "create-diff", "create-whole", "set-model", "dispose-editor", "dispose-model". */
  log: [] as string[],
  diffOptions: null as Record<string, unknown> | null,
  wholeOptions: null as Record<string, unknown> | null,
  models: [] as StubModel[],
  shown: [] as readonly StubModel[],
  goToDiff: [] as string[],
  focused: [] as string[],
  decorations: [] as readonly unknown[],
  viewStatesSaved: 0,
  viewStatesRestored: 0,
  themes: [] as string[],
  loads: 0,
  /** Every `updateOptions` call, from either editor, in order. */
  updates: [] as Record<string, unknown>[],
};

export function resetStub(): void {
  stub.log = [];
  stub.diffOptions = null;
  stub.wholeOptions = null;
  stub.models = [];
  stub.shown = [];
  stub.goToDiff = [];
  stub.focused = [];
  stub.decorations = [];
  stub.viewStatesSaved = 0;
  stub.viewStatesRestored = 0;
  stub.themes = [];
  stub.loads = 0;
  stub.updates = [];
}

function makeModel(text: string, language: string | undefined): StubModel {
  const lines = text.split("\n");
  const model: StubModel = {
    text,
    language,
    disposed: false,
    getLineCount: () => lines.length,
    getLineMaxColumn: (line) => (lines[line - 1] ?? "").length + 1,
    dispose() {
      model.disposed = true;
      stub.log.push("dispose-model");
    },
  };
  stub.models.push(model);
  return model;
}

export const fakeMonaco = {
  Range: class {
    constructor(
      readonly startLineNumber: number,
      readonly startColumn: number,
      readonly endLineNumber: number,
      readonly endColumn: number,
    ) {}
  },
  editor: {
    createModel: makeModel,
    defineTheme: (id: string) => {
      stub.themes.push(id);
    },
    setTheme: () => {},
    createDiffEditor: (_host: HTMLElement, options: Record<string, unknown>) => {
      stub.diffOptions = options;
      stub.log.push("create-diff");
      return {
        setModel: (pair: { original: StubModel; modified: StubModel }) => {
          stub.log.push("set-model");
          stub.shown = [pair.original, pair.modified];
        },
        saveViewState: () => {
          stub.viewStatesSaved += 1;
          return { scroll: 1 };
        },
        restoreViewState: () => {
          stub.viewStatesRestored += 1;
        },
        updateOptions: (next: Record<string, unknown>) => {
          stub.updates.push(next);
        },
        goToDiff: (direction: string) => {
          stub.goToDiff.push(direction);
        },
        getModifiedEditor: () => ({
          focus: () => {
            stub.focused.push("modified");
          },
        }),
        dispose: () => {
          stub.log.push("dispose-editor");
        },
      };
    },
    create: (_host: HTMLElement, options: Record<string, unknown>) => {
      stub.wholeOptions = options;
      stub.log.push("create-whole");
      return {
        setModel: (model: StubModel) => {
          stub.log.push("set-model");
          stub.shown = [model];
        },
        saveViewState: () => {
          stub.viewStatesSaved += 1;
          return { scroll: 1 };
        },
        restoreViewState: () => {
          stub.viewStatesRestored += 1;
        },
        updateOptions: (next: Record<string, unknown>) => {
          stub.updates.push(next);
        },
        createDecorationsCollection: (decorations: readonly unknown[]) => {
          stub.decorations = decorations;
          return {
            clear: () => {
              stub.decorations = [];
            },
          };
        },
        focus: () => {
          stub.focused.push("whole");
        },
        dispose: () => {
          stub.log.push("dispose-editor");
        },
      };
    },
  },
};

export async function loadStubbedMonaco(): Promise<typeof fakeMonaco> {
  stub.loads += 1;
  return fakeMonaco;
}
