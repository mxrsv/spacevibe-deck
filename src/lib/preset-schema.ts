import { countLeaves, type SerializedNode } from './split-tree';
import { validateLayout } from './layout-validation';

export const PRESETS_VERSION = 1;
export const BUILT_IN_PRESET_ID = 'built-in';

// Sanity bounds so a corrupt file cannot flood the Open board
const MAX_PRESETS = 32;
const MAX_PRESET_NAME_LENGTH = 64;

/** One named layout template: split tree + optional per-leaf CWDs (ARCH D4). */
export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly layout: SerializedNode;
  /** Zips leaves left-to-right; null = inherit the workspace folder. */
  readonly cwds?: readonly (string | null)[];
}

export interface PresetsData {
  readonly version: number;
  readonly presets: readonly Preset[];
  /** Open-board preselect; undefined = built-in. */
  readonly lastUsedId?: string;
}

/** Code-defined default so Open can never soft-lock. */
export const BUILT_IN_PRESET: Preset = {
  id: BUILT_IN_PRESET_ID,
  name: 'Single pane',
  layout: { type: 'leaf' },
};

export function isBuiltIn(preset: Preset): boolean {
  return preset.id === BUILT_IN_PRESET_ID;
}

function validatePresetName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_PRESET_NAME_LENGTH) {
    return null;
  }
  return trimmed;
}

function validateCwds(
  raw: unknown,
  layout: SerializedNode,
): readonly (string | null)[] | undefined {
  if (!Array.isArray(raw) || raw.length !== countLeaves(layout)) {
    return undefined;
  }
  const cwds = raw.map((entry) => (typeof entry === 'string' ? entry : null));
  return cwds.every((entry) => entry === null) ? undefined : cwds;
}

function validatePreset(raw: unknown): Preset | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== 'string' || source.id === '' || source.id === BUILT_IN_PRESET_ID) {
    return null;
  }
  const name = validatePresetName(source.name);
  if (name === null) {
    return null;
  }
  const layout = validateLayout(source.layout);
  if (layout === null) {
    return null;
  }
  const cwds = validateCwds(source.cwds, layout);
  return { id: source.id, name, layout, ...(cwds ? { cwds } : {}) };
}

/** Invalid envelope → empty store; invalid entries are dropped one by one. */
export function validatePresets(raw: unknown): PresetsData {
  const empty: PresetsData = { version: PRESETS_VERSION, presets: [] };
  if (typeof raw !== 'object' || raw === null) {
    return empty;
  }
  const source = raw as Record<string, unknown>;
  if (source.version !== PRESETS_VERSION || !Array.isArray(source.presets)) {
    return empty;
  }
  const presets: Preset[] = [];
  for (const entry of source.presets.slice(0, MAX_PRESETS)) {
    const preset = validatePreset(entry);
    if (preset !== null && !presets.some((p) => p.id === preset.id)) {
      presets.push(preset);
    }
  }
  const lastUsedId =
    typeof source.lastUsedId === 'string' &&
    presets.some((preset) => preset.id === source.lastUsedId)
      ? source.lastUsedId
      : undefined;
  return {
    version: PRESETS_VERSION,
    presets,
    ...(lastUsedId !== undefined ? { lastUsedId } : {}),
  };
}

/** Replace by id when present, else append. */
export function upsertPreset(list: readonly Preset[], preset: Preset): readonly Preset[] {
  return list.some((entry) => entry.id === preset.id)
    ? list.map((entry) => (entry.id === preset.id ? preset : entry))
    : [...list, preset];
}

export function renamePresetIn(
  list: readonly Preset[],
  id: string,
  name: string,
): readonly Preset[] {
  return list.map((entry) => (entry.id === id ? { ...entry, name } : entry));
}

export function removePreset(list: readonly Preset[], id: string): readonly Preset[] {
  return list.filter((entry) => entry.id !== id);
}

/** Pane CWD = preset cwd when set, else the workspace folder. */
export function resolveCwds(preset: Preset, workspace: string): readonly (string | null)[] {
  const total = countLeaves(preset.layout);
  return Array.from({ length: total }, (_, index) => preset.cwds?.[index] ?? workspace);
}
