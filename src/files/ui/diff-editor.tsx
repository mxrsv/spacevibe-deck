// oxlint-disable react-hooks/exhaustive-deps -- the effects below narrow their
// deps on purpose and each says why at its own call site; oxlint 1.78 ignores
// per-line disables for this rule, so the scope is this one file, this one rule.
/**
 * The diff column's body: one read-only Monaco, mounted imperatively like
 * `FileEditor` (plan 2026-10-10-diff-column, D1, D3, D6).
 *
 * A file with two sides is a Monaco diff editor: unified below Monaco's 900px
 * breakpoint, side by side above it, long unchanged runs folded. A file with
 * one side (added, untracked, deleted, unborn) is a plain read-only editor
 * whose every line carries Monaco's own insert or delete decoration: a diff
 * against an empty model prints a stray empty removed line, because an empty
 * model still has one line.
 *
 * The editor never touches the file surface's editor slots (`setEditorFocus`,
 * `setEditorEdit`): those belong to `FileEditor`, and the diff is not a
 * document. It writes nothing and offers no revert, stage or gutter menu —
 * Deck never writes to git (spec CHG5).
 */
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { settings } from "../../settings/settings-store";
import { monoFontFallback } from "../../settings/mono-font-fallback";
import { textFontSize } from "../../settings/gui-zoom";
import { applyMonacoTheme, DECK_THEME_ID, loadMonaco, type MonacoApi } from "../editor-host";
import { editorSettings } from "../file-surface-controller";
import type { DiffSide, DiffSidesView } from "../changes/diff-sides";
import { DIFF_COLUMN_ATTR } from "../changes/diff-column-focus";

export type TextSides = Extract<DiffSidesView, { kind: "text" }>;

/** What the column asks of the editor: the `n` / `p` keys and focus. */
export interface DiffEditorControls {
  goToChange(direction: "next" | "previous"): void;
  focus(): void;
}

export interface DiffEditorProps {
  readonly sides: TextSides;
  /** Root and path: a new text of the same file keeps its scroll and cursor. */
  readonly fileKey: string;
  /** Filled while Monaco is mounted, and emptied when it is not. */
  readonly controls?: { current: DiffEditorControls | null };
}

type DiffEditorInstance = ReturnType<MonacoApi["editor"]["createDiffEditor"]>;
type CodeEditorInstance = ReturnType<MonacoApi["editor"]["create"]>;
type TextModel = ReturnType<MonacoApi["editor"]["createModel"]>;

/** Monaco's own switch from two sides to one (D3 (a)); its default, named. */
const SIDE_BY_SIDE_BREAKPOINT = 900;
/** The insert / delete sign's gutter, as the diff editor reserves it. */
const SIGN_GUTTER_WIDTH = 18;

/** The editor a mode mounts; `view` is the one view-state-bearing editor. */
type Mounted =
  | { readonly mode: "diff"; readonly editor: DiffEditorInstance }
  | {
      readonly mode: "whole";
      readonly editor: CodeEditorInstance;
      decorations: ReturnType<CodeEditorInstance["createDecorationsCollection"]> | null;
    };

interface EditorHandle {
  readonly monaco: MonacoApi;
  readonly mounted: Mounted;
  /** The models on screen; replaced, never edited. */
  models: readonly TextModel[];
  /** The file the models belong to. */
  fileKey: string | null;
}

const fontOptions = (next: { fontFamily: string; fontSize: number; guiZoom: number }) => ({
  fontFamily: `${next.fontFamily}, ${monoFontFallback()}`,
  fontSize: textFontSize(next),
});

/** Options both editors share: read-only to the DOM, no chrome, no shadows. */
function commonOptions() {
  return {
    theme: DECK_THEME_ID,
    ...fontOptions(settings.value),
    readOnly: true,
    // A key typed into a read-only editor makes Monaco print "Cannot edit";
    // the column handles the keys it owns before Monaco sees them.
    domReadOnly: true,
    readOnlyMessage: { value: "" },
    minimap: { enabled: false },
    // DL-1.3 forbids shadows; Monaco draws one under its scroll edge.
    scrollbar: { useShadows: false },
    scrollBeyondLastLine: false,
    // Wrapping stays off: in the unified view Monaco wraps the hidden original
    // editor too, and a wrapped removed line leaves its gutter cell unpainted.
    wordWrap: "off" as const,
    automaticLayout: true,
  };
}

function mountDiff(monaco: MonacoApi, host: HTMLElement): Mounted {
  const editor = monaco.editor.createDiffEditor(host, {
    ...commonOptions(),
    originalEditable: false,
    renderSideBySide: true,
    useInlineViewWhenSpaceIsLimited: true,
    renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_BREAKPOINT,
    enableSplitViewResizing: false,
    // CHG5: no revert icon, no gutter menu — Deck never writes to git.
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    // The header's counts include whitespace-only changes, so the highlight must.
    ignoreTrimWhitespace: false,
    hideUnchangedRegions: {
      enabled: true,
      contextLineCount: 3,
      minimumLineCount: 4,
      revealLineCount: 20,
    },
    // A column this narrow gains nothing from a ruler, and it paints from the
    // theme in script rather than from CSS.
    renderOverviewRuler: false,
  });
  return { mode: "diff", editor };
}

function mountWhole(monaco: MonacoApi, host: HTMLElement): Mounted {
  const editor = monaco.editor.create(host, {
    ...commonOptions(),
    value: "",
    renderLineHighlight: "none",
    lineDecorationsWidth: SIGN_GUTTER_WIDTH,
    folding: false,
  });
  return { mode: "whole", editor, decorations: null };
}

/** Which of the two a one-sided file shows: its added or its removed lines. */
function wholeSide(sides: TextSides): { side: DiffSide; removed: boolean } {
  const removed = sides.modified.text === "" && sides.original.text !== "";
  return { side: removed ? sides.original : sides.modified, removed };
}

/** Monaco's own decoration classes, so the theme's washes and signs apply. */
function wholeDecoration(monaco: MonacoApi, model: TextModel, removed: boolean) {
  const lastLine = model.getLineCount();
  // A trailing newline leaves one empty line that is not part of the file.
  const last = lastLine > 1 && model.getLineMaxColumn(lastLine) === 1 ? lastLine - 1 : lastLine;
  const kind = removed ? "delete" : "insert";
  return {
    range: new monaco.Range(1, 1, last, 1),
    options: {
      isWholeLine: true,
      className: `line-${kind}`,
      marginClassName: `gutter-${kind}`,
      linesDecorationsClassName: `${kind}-sign codicon codicon-diff-${removed ? "remove" : "insert"}`,
    },
  };
}

/** Puts `sides` on screen: new models first, then the old ones are let go. */
function showSides(handle: EditorHandle, sides: TextSides, fileKey: string): void {
  const { monaco, mounted } = handle;
  const sameFile = handle.fileKey === fileKey;
  const old = handle.models;
  if (mounted.mode === "diff") {
    const viewState = sameFile ? mounted.editor.saveViewState() : null;
    const original = monaco.editor.createModel(
      sides.original.text,
      sides.original.language ?? undefined,
    );
    const modified = monaco.editor.createModel(
      sides.modified.text,
      sides.modified.language ?? undefined,
    );
    mounted.editor.setModel({ original, modified });
    if (viewState !== null) {
      mounted.editor.restoreViewState(viewState);
    }
    handle.models = [original, modified];
  } else {
    const { side, removed } = wholeSide(sides);
    const viewState = sameFile ? mounted.editor.saveViewState() : null;
    const model = monaco.editor.createModel(side.text, side.language ?? undefined);
    mounted.editor.setModel(model);
    mounted.decorations?.clear();
    mounted.decorations =
      side.text === ""
        ? null
        : mounted.editor.createDecorationsCollection([wholeDecoration(monaco, model, removed)]);
    if (viewState !== null) {
      mounted.editor.restoreViewState(viewState);
    }
    handle.models = [model];
  }
  handle.fileKey = fileKey;
  // A model still attached to an editor cannot be disposed, so only now.
  for (const model of old) {
    model.dispose();
  }
}

function controlsFor(mounted: Mounted): DiffEditorControls {
  if (mounted.mode === "diff") {
    return {
      goToChange: (direction) => mounted.editor.goToDiff(direction),
      focus: () => mounted.editor.getModifiedEditor().focus(),
    };
  }
  // A one-sided file has no change to go to: all of it is the change.
  return { goToChange: () => {}, focus: () => mounted.editor.focus() };
}

export function DiffEditor(props: DiffEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  /**
   * Bumped once Monaco has landed: Monaco arrives through a dynamic import, so
   * the sides effect below runs FIRST with a null handle and returns. Without a
   * dep that changes when the handle appears, nothing re-runs it and the editor
   * stays empty (the same trap `FileEditor` documents).
   */
  const ready = useSignal(0);
  const mode = props.sides.oneSided ? "whole" : "diff";

  // One editor per mode: a file that goes from two sides to one (staged after
  // it was untracked) swaps editors, and the cleanup disposes the first. Narrow
  // deps on purpose: `ready` is written here, and `props` is read for `controls`
  // only, whose identity is the column's own.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let cancelled = false;
    void loadMonaco()
      .then((monaco) => {
        if (cancelled || hostRef.current === null) {
          return;
        }
        applyMonacoTheme(monaco, settings.value);
        const mounted = mode === "diff" ? mountDiff(monaco, host) : mountWhole(monaco, host);
        handleRef.current = { monaco, mounted, models: [], fileKey: null };
        if (props.controls !== undefined) {
          props.controls.current = controlsFor(mounted);
        }
        ready.value += 1;
      })
      .catch((error: unknown) => {
        // A chunk that 404s under `file://` would otherwise be a blank rectangle.
        console.error("Deck: the diff could not be loaded", error);
      });
    return () => {
      cancelled = true;
      if (props.controls !== undefined) {
        props.controls.current = null;
      }
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle !== null) {
        // Focus inside the editor would fall to `<body>` with it: parked on the
        // column's root, the next editor takes it back (a swap of mode or file).
        if (host.contains(document.activeElement)) {
          host.closest<HTMLElement>(`[${DIFF_COLUMN_ATTR}]`)?.focus();
        }
        // The editor first: Monaco throws on a model still attached to a widget.
        handle.mounted.editor.dispose();
        for (const model of handle.models) {
          model.dispose();
        }
      }
    };
  }, [mode]);

  // The text on screen: swapped only when a side's text or language changed
  // (the sides module already drops an identical re-read), around a saved view
  // state so a refresh keeps scroll and cursor.
  //
  // Focus parked on the column's root (a fresh open, a swap) moves in here,
  // only now: Monaco's `focus()` does nothing on an editor with no model.
  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) {
      return;
    }
    showSides(handle, props.sides, props.fileKey);
    const column = hostRef.current?.closest(`[${DIFF_COLUMN_ATTR}]`) ?? null;
    if (column !== null && document.activeElement === column) {
      controlsFor(handle.mounted).focus();
    }
  }, [props.sides, props.fileKey, ready.value]);

  // Theme, font family and size follow the same `applySettings` call the
  // terminals and the file editor do.
  useSignalEffect(() => {
    const next = editorSettings.value;
    const handle = handleRef.current;
    if (next === null || handle === null) {
      return;
    }
    applyMonacoTheme(handle.monaco, next);
    handle.mounted.editor.updateOptions(fontOptions(next));
  });

  return <div class="diff-editor" ref={hostRef} />;
}
