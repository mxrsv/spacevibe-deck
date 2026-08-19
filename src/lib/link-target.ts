/**
 * Where an activated path goes (design §3.1) — the whole routing decision, as
 * one pure function.
 *
 * The order is deliberate and has no switch behind it: a file that belongs to
 * a workspace this window already has open ALWAYS opens in Deck, and only a
 * path outside every open root reaches another application. There is no kill
 * switch and no second chord in v1 — ⌘⌥+click is the obvious later addition
 * if that turns out to be wrong in use.
 *
 * Containment is answered by the main process, never by prefix-matching here:
 * `resolve_paths` returns canonical (realpath'd) absolutes while the renderer
 * holds workspace roots as the raw strings the user opened, and the two stop
 * agreeing the moment a root is itself a symlink — `/tmp` on macOS is one.
 * This function is handed the ANSWER, not the roots.
 */
import {
  editorIdOf,
  externalApp,
  type ExternalAppId,
} from "./external-app-catalog";

export interface LinkDecision {
  /** Absolute, canonical, and already known to be a file. */
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  /**
   * The open workspace root that contains `path`, as the RENDERER spells it,
   * or null when no open workspace does. The renderer's spelling matters:
   * every file-surface lookup is keyed by it, so handing back the canonical
   * root would open a tab in a workspace the store has never heard of.
   */
  readonly workspaceRoot: string | null;
  /** The app selected on the toolbar/Settings, or null when none is usable. */
  readonly appId: ExternalAppId | null;
}

export type LinkTarget =
  | {
      readonly kind: "deck";
      readonly workspacePath: string;
      readonly path: string;
      readonly line: number;
      readonly column: number;
    }
  | {
      readonly kind: "editor";
      readonly editor: "vscode" | "cursor" | "zed";
      readonly path: string;
      readonly line: number;
      readonly column: number;
    }
  | {
      readonly kind: "app";
      readonly appId: ExternalAppId;
      readonly path: string;
      readonly line: number;
      readonly column: number;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

/** A missing position is the top of the file, never a refusal to open it. */
function position(value: number | null): number {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function decideLinkTarget(decision: LinkDecision): LinkTarget {
  const line = position(decision.line);
  const column = position(decision.column);
  if (decision.workspaceRoot !== null) {
    return {
      kind: "deck",
      workspacePath: decision.workspaceRoot,
      path: decision.path,
      line,
      column,
    };
  }
  if (decision.appId === null) {
    return {
      kind: "unavailable",
      reason:
        "No app is available to open this file — pick one under Settings, in Links & editor.",
    };
  }
  const editor = editorIdOf(decision.appId);
  if (editor !== null) {
    // The editors keep the validated CLI template, because it is the only
    // route that carries a line number (design §4.3).
    return { kind: "editor", editor, path: decision.path, line, column };
  }
  return {
    kind: "app",
    appId: decision.appId,
    path: decision.path,
    line,
    column,
  };
}

/**
 * The app a selection actually resolves to: the selected one when it is
 * installed, else the first installed app in catalog order, else null.
 *
 * The fallback is what a migrated `custom` editor command lands on (design
 * §5), and it is also what happens when the chosen app is uninstalled while
 * Deck is running. Naming an app that is not there would make ⌘+click do
 * nothing with no way to find out why.
 *
 * `hostAnswered` is the third state, and it is not the same as "nothing is
 * installed". A host with no `external_apps` channel — Tauri, a browser
 * preview — cannot tell us what exists, and treating its silence as an empty
 * machine would turn a ⌘+click that opened VS Code yesterday into an error bar
 * on the host users are still running. There, the selection is taken at its
 * word: an editor keeps its own validated template, and anything else falls
 * back to VS Code's, because that template is the only thing Tauri can launch
 * (design §5).
 */
export function resolveExternalApp(
  selected: ExternalAppId | null,
  installed: readonly ExternalAppId[],
  hostAnswered: boolean = true,
): ExternalAppId | null {
  if (!hostAnswered) {
    return selected !== null && editorIdOf(selected) !== null
      ? selected
      : FALLBACK_EDITOR;
  }
  if (selected !== null && installed.includes(selected)) {
    return selected;
  }
  return installed[0] ?? null;
}

/** The one app a host with no catalog can still launch — the `open_editor`
 * template Tauri has always carried. */
const FALLBACK_EDITOR: ExternalAppId = "vscode";

/** The label a message names the app by. */
export function externalAppLabel(id: ExternalAppId): string {
  return externalApp(id).label;
}
