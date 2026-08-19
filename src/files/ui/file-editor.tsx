/**
 * The editor surface (plan T33).
 *
 * Monaco is mounted IMPERATIVELY into a DOM node — the same shape as `Pane`
 * wrapping xterm, so the pattern already exists in this codebase and the
 * component owns a lifecycle rather than a render tree.
 *
 * ONE editor instance, whichever file is showing. Switching tabs swaps the
 * model and restores that file's saved view state, which is what makes "reload
 * silently, keep scroll and cursor" (spec §5) possible at all: a reload is a
 * model-value swap between a `saveViewState` and a `restoreViewState`.
 */
import { useEffect, useRef } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import { settings } from "../../settings/settings-store";
import { FONT_FALLBACK } from "../../settings/settings-schema";
import {
  applyMonacoTheme,
  DECK_THEME_ID,
  languageForPath,
  loadMonaco,
  type MonacoApi,
} from "../editor-host";
import { documentFor } from "../file-surface-store";
import { editorSettings, type FileSurfaceController } from "../file-surface-controller";
import { ExternalChangeBar } from "./external-change-bar";

export interface FileEditorProps {
  readonly path: string;
  readonly controller: FileSurfaceController;
}

/** The bits of Monaco this component holds on to. Kept in one ref so the
 * teardown cannot forget half of them. */
interface EditorHandle {
  readonly monaco: MonacoApi;
  readonly editor: ReturnType<MonacoApi["editor"]["create"]>;
  readonly models: Map<string, ReturnType<MonacoApi["editor"]["createModel"]>>;
  readonly viewStates: Map<string, unknown>;
  /** Path whose content the editor is currently reflecting. */
  current: string | null;
  /** True while the component is writing the model, so the change listener
   * does not report Deck's own reload as a user edit. */
  applying: boolean;
}

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

export function FileEditor(props: FileEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  /**
   * Bumped once Monaco has landed.
   *
   * Load-bearing, not bookkeeping: Monaco arrives through a dynamic import, so
   * the model effect below runs FIRST — with a null handle — and returns
   * early. Without a dep that changes when the handle appears, nothing re-runs
   * it, and the very first file opened gets an editor with no model attached
   * and no `readOnly` applied. Caught by `file-editor.test.tsx`'s read-only
   * case, which is exactly the shape a manual pass would have found late.
   */
  const ready = useSignal(0);
  const document = documentFor(props.path);

  // Mount once. Monaco arrives through a dynamic import, so this effect can
  // resolve after the component has already unmounted — hence `cancelled`.
  /* oxlint-disable react-hooks/exhaustive-deps -- mount-once; the cancelled flag guards the async tail */
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
        const editor = monaco.editor.create(host, {
          theme: DECK_THEME_ID,
          automaticLayout: true,
          minimap: { enabled: false },
          // DL-1.3 forbids shadows; Monaco draws one under its scroll edge.
          scrollbar: { useShadows: false },
          renderLineHighlight: "line",
          fontFamily: `${settings.value.fontFamily}, ${FONT_FALLBACK}`,
          fontSize: settings.value.fontSize,
          tabSize: 2,
          // The file's own ending is restored on save (`applyEol`); the editor
          // works in LF throughout so nothing rewrites endings silently.
          value: "",
        });
        const handle: EditorHandle = {
          monaco,
          editor,
          models: new Map(),
          viewStates: new Map(),
          current: null,
          applying: false,
        };
        handleRef.current = handle;
        editor.onDidChangeModelContent(() => {
          if (handle.applying || handle.current === null) {
            return;
          }
          props.controller.setText(handle.current, editor.getValue());
        });
        editor.onDidChangeCursorPosition((event) => {
          if (handle.current !== null) {
            props.controller.setCursor(
              handle.current,
              event.position.lineNumber,
              event.position.column,
            );
          }
        });
        props.controller.setEditorFocus(() => editor.focus());
        editor.focus();
        // Re-runs the model effect now that there is something to attach to.
        ready.value += 1;
      })
      .catch((error: unknown) => {
        // Gate M's failure mode, surfaced rather than swallowed: a chunk that
        // 404s under `file://` would otherwise be a blank rectangle.
        console.error("Deck: the editor could not be loaded", error);
      });
    return () => {
      cancelled = true;
      props.controller.setEditorFocus(null);
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle !== null) {
        handle.editor.dispose();
        for (const model of handle.models.values()) {
          model.dispose();
        }
      }
    };
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // Swap the model when the path changes, and re-apply the content whenever the
  // document's baseline moves — a reload, or the first read landing.
  /* oxlint-disable react-hooks/exhaustive-deps -- re-runs on path and the ready bump; document is read at run time */
  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null || document === undefined) {
      return;
    }
    const { monaco, editor } = handle;
    if (handle.current !== null && handle.current !== props.path) {
      handle.viewStates.set(handle.current, editor.saveViewState());
    }
    let model = handle.models.get(props.path);
    if (model === undefined) {
      model = monaco.editor.createModel(document.text, languageForPath(props.path) ?? undefined);
      handle.models.set(props.path, model);
    }
    handle.applying = true;
    try {
      if (model.getValue() !== document.text) {
        // `pushEditOperations` over the whole range rather than `setValue`:
        // setValue resets the undo stack AND the cursor, and holding both is
        // the point of the clean+changed row (spec §5).
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: document.text }],
          () => null,
        );
      }
      if (editor.getModel() !== model) {
        editor.setModel(model);
        const saved = handle.viewStates.get(props.path);
        if (saved !== undefined) {
          editor.restoreViewState(saved as Parameters<typeof editor.restoreViewState>[0]);
        }
      }
    } finally {
      handle.applying = false;
    }
    handle.current = props.path;
    editor.updateOptions({
      readOnly: document.file === null || document.file.readOnly,
    });
  }, [props.path, document?.text, document?.file, ready.value]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // Theme, font family and font size follow the SAME `applySettings` call the
  // terminals do — a theme switch must not leave the editor in the old palette
  // until it is reopened (spec §7).
  useSignalEffect(() => {
    const next = editorSettings.value;
    const handle = handleRef.current;
    if (next === null || handle === null) {
      return;
    }
    applyMonacoTheme(handle.monaco, next);
    handle.editor.updateOptions({
      fontFamily: `${next.fontFamily}, ${FONT_FALLBACK}`,
      fontSize: next.fontSize,
    });
  });

  if (document === undefined) {
    return null;
  }

  return (
    <div class="fileview">
      {document.refusal !== null ? (
        // A stated reason, never an empty editor (spec §4.4).
        <div class="fileview__refusal" role="status">
          <span class="fileview__refusal-name">{baseName(props.path)}</span>
          <span class="fileview__refusal-text">{document.refusal}</span>
        </div>
      ) : (
        <>
          <ExternalChangeBar
            prompt={document.prompt}
            fileName={baseName(props.path)}
            onResolve={(resolution) => void props.controller.resolve(props.path, resolution)}
          />
          {document.gone && document.prompt === null && (
            <div class="filebar filebar--quiet" role="status">
              <span class="filebar__text">
                {baseName(props.path)} was deleted on disk. This is the last content Deck read.
              </span>
            </div>
          )}
          {document.file?.reason != null && (
            <div class="filebar filebar--quiet" role="status">
              <span class="filebar__text">{document.file.reason}</span>
            </div>
          )}
          <div class="fileview__editor" ref={hostRef} />
        </>
      )}
    </div>
  );
}
