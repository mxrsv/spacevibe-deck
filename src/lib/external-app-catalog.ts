/**
 * The apps Deck can hand a path to — the renderer's half of the catalog
 * `electron/external-apps.ts` mirrors, the same arrangement `electron/agents.ts`
 * has with `BUILTIN_AGENTS` (design §4.2).
 *
 * The renderer holds the id, the label and the group; the main process holds
 * the bundle paths, the icons and the argv. That split is not tidiness: the
 * split-button lists whatever the HOST reports installed, but Settings is also
 * the only picker on Tauri, where no `external_apps` channel exists at all — so
 * the renderer needs a list it can print without asking anyone.
 *
 * Group order is the menu's order (design §4.1) and the fallback order: an app
 * that has left the machine falls back to the first installed one, walking this
 * table from the top.
 */

/** The four kinds of app, in menu order; a hairline separates them (DL-23.5). */
export type ExternalAppGroup = "editor" | "git" | "files" | "terminal";

export const EXTERNAL_APP_GROUP_ORDER: readonly ExternalAppGroup[] =
  Object.freeze(["editor", "git", "files", "terminal"]);

/**
 * What an app is actually handed, for a target of a given kind.
 *
 * `repository` is a rule VALUE rather than a third field because the git group
 * is the only one that ever wants something other than the path in front of
 * it — declaring a `repository` column on Finder would be a rule nobody reads.
 */
export type TargetRule = "as-is" | "directory" | "repository" | "reveal";

export interface ExternalApp {
  readonly id: string;
  readonly label: string;
  readonly group: ExternalAppGroup;
  /** What a ⌘+click on a file outside every open workspace hands over. */
  readonly opensFile: TargetRule;
  /** What the toolbar button, which always names a folder, hands over. */
  readonly opensFolder: TargetRule;
}

/**
 * Every app Deck knows how to reach, in menu order.
 *
 * Editors first because they are what a path usually wants; Finder is its own
 * group because "show me where this is" is a different question from "open it".
 */
export const EXTERNAL_APPS = [
  {
    id: "vscode",
    label: "VS Code",
    group: "editor",
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "cursor",
    label: "Cursor",
    group: "editor",
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "zed",
    label: "Zed",
    group: "editor",
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "github-desktop",
    label: "GitHub Desktop",
    group: "git",
    opensFile: "repository",
    opensFolder: "repository",
  },
  {
    id: "gitkraken",
    label: "GitKraken",
    group: "git",
    opensFile: "repository",
    opensFolder: "repository",
  },
  {
    id: "finder",
    label: "Finder",
    group: "files",
    opensFile: "reveal",
    opensFolder: "as-is",
  },
  {
    id: "terminal",
    label: "Terminal",
    group: "terminal",
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "iterm2",
    label: "iTerm2",
    group: "terminal",
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "ghostty",
    label: "Ghostty",
    group: "terminal",
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "hyper",
    label: "Hyper",
    group: "terminal",
    opensFile: "directory",
    opensFolder: "as-is",
  },
] as const satisfies readonly ExternalApp[];

export type ExternalAppId = (typeof EXTERNAL_APPS)[number]["id"];

export const EXTERNAL_APP_IDS: readonly ExternalAppId[] = EXTERNAL_APPS.map(
  (app) => app.id,
);

export function isExternalAppId(value: unknown): value is ExternalAppId {
  return EXTERNAL_APP_IDS.includes(value as ExternalAppId);
}

export function externalApp(id: ExternalAppId): ExternalApp {
  return EXTERNAL_APPS.find((app) => app.id === id) ?? EXTERNAL_APPS[0];
}

/**
 * The `open_editor` id an app maps onto, or null when it is not an editor.
 *
 * The three editors keep the validated CLI template that already ships
 * (`electron/links.ts`), because it is the only route that carries a LINE —
 * `open -a` can name a file but never a position in it. Everything else goes
 * through `open_in_app`, which never claims to.
 */
export function editorIdOf(
  id: ExternalAppId,
): "vscode" | "cursor" | "zed" | null {
  switch (id) {
    case "vscode":
      return "vscode";
    case "cursor":
      return "cursor";
    case "zed":
      return "zed";
    default:
      return null;
  }
}
