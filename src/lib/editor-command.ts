/** Editors offered in Settings; `custom` runs the user's own command. */
export type EditorId = 'vscode' | 'cursor' | 'zed' | 'custom';

/** Structured, non-executable intent sent to the Rust editor boundary. */
export interface OpenEditorRequest {
  readonly editor: EditorId;
  readonly template: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface EditorPreset {
  readonly id: EditorId;
  readonly label: string;
  /** `{file}` / `{line}` / `{col}` are substituted at click time. */
  readonly template: string;
}

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  { id: 'vscode', label: 'VS Code', template: 'code -g {file}:{line}:{col}' },
  { id: 'cursor', label: 'Cursor', template: 'cursor -g {file}:{line}:{col}' },
  { id: 'zed', label: 'Zed', template: 'zed {file}:{line}:{col}' },
  { id: 'custom', label: 'custom…', template: '' },
];

export const EDITOR_IDS: readonly EditorId[] = EDITOR_PRESETS.map((preset) => preset.id);

export function isEditorId(value: unknown): value is EditorId {
  return EDITOR_IDS.includes(value as EditorId);
}

export function editorPreset(id: EditorId): EditorPreset {
  return EDITOR_PRESETS.find((preset) => preset.id === id) ?? EDITOR_PRESETS[0];
}

/** The template in force: a preset's, or the user's custom command. */
export function editorTemplate(id: EditorId, custom: string): string {
  return id === 'custom' ? custom.trim() : editorPreset(id).template;
}

/** Build immutable editor intent without constructing executable text. */
export function buildOpenEditorRequest(
  editor: EditorId,
  customTemplate: string,
  file: string,
  line: number | null,
  column: number | null,
): OpenEditorRequest | null {
  const template = editor === 'custom' ? customTemplate.trim() : '';
  if (editor === 'custom' && template === '') {
    return null;
  }
  return Object.freeze({
    editor,
    template,
    file,
    line: line ?? 1,
    column: column ?? 1,
  });
}
