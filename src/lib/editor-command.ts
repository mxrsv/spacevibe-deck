import { shellEscapePath } from "./shell-escape";
import { getDesktopEnvironment } from "./platform";

/** Editors offered in Settings; `custom` runs the user's own command. */
export type EditorId = "vscode" | "cursor" | "zed" | "custom";

export interface EditorPreset {
  readonly id: EditorId;
  readonly label: string;
  /** `{file}` / `{line}` / `{col}` are substituted at click time. */
  readonly template: string;
}

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  { id: "vscode", label: "VS Code", template: "code -g {file}:{line}:{col}" },
  { id: "cursor", label: "Cursor", template: "cursor -g {file}:{line}:{col}" },
  { id: "zed", label: "Zed", template: "zed {file}:{line}:{col}" },
  { id: "custom", label: "custom…", template: "" },
];

export const EDITOR_IDS: readonly EditorId[] = EDITOR_PRESETS.map(
  (preset) => preset.id,
);

export function isEditorId(value: unknown): value is EditorId {
  return EDITOR_IDS.includes(value as EditorId);
}

export function editorPreset(id: EditorId): EditorPreset {
  return EDITOR_PRESETS.find((preset) => preset.id === id) ?? EDITOR_PRESETS[0];
}

/** The template in force: a preset's, or the user's custom command. */
export function editorTemplate(id: EditorId, custom: string): string {
  return id === "custom" ? custom.trim() : editorPreset(id).template;
}

/**
 * The shell command that opens `file` at `line`:`col`. `file` is escaped for a
 * shell command line; a template with no `{file}` gets the path appended, so a
 * bare `vim` still works. Returns null when the template is empty (custom
 * editor selected but never filled in).
 */
export function buildEditorCommand(
  template: string,
  file: string,
  line: number | null,
  col: number | null,
): string | null {
  const trimmed = template.trim();
  if (trimmed === "") {
    return null;
  }
  const withFile = trimmed.includes("{file}") ? trimmed : `${trimmed} {file}`;
  return withFile
    .replace(
      /\{file\}/g,
      shellEscapePath(file, getDesktopEnvironment().platform),
    )
    .replace(/\{line\}/g, String(line ?? 1))
    .replace(/\{col\}/g, String(col ?? 1));
}
