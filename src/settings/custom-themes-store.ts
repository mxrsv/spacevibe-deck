/**
 * The themes folder, as the renderer sees it.
 *
 * One module owns the round trip: ask the host for the folder's files, parse
 * each one through `theme-formats/`, publish the good ones on
 * `customPresets` (declared in `themes.ts`, where the lookup is) and keep the
 * bad ones as reasons the settings surface can show.
 *
 * Window-scoped module state, per R5. Nothing here is per-tab or per-pane: the
 * themes folder is one folder for the whole app.
 */
import { signal } from "@preact/signals";
import {
  importThemeFiles,
  listThemeFiles,
  revealThemesFolder,
  type ThemeScan,
} from "../host/theme-host";
import { parseThemeFile } from "./theme-formats/parse-theme-file";
import { customPresets, type ThemePreset } from "./themes";

export interface ThemeImportFailure {
  readonly fileName: string;
  readonly reason: string;
}

/**
 * Every file this feature touched and could not turn into a theme — surfaced,
 * never silently dropped (DL-24.6).
 *
 * Two sources land in one list because the user cannot tell them apart and
 * should not have to: a file the host refused before copying (wrong type, too
 * large, uncopyable) and a file that reached the parser and failed are both
 * "I picked this and got no theme".
 */
export const themeImportFailures = signal<readonly ThemeImportFailure[]>([]);

/** True while a scan or an import round trip is in flight. */
export const themesLoading = signal(false);

/**
 * Read the folder and publish what is in it.
 *
 * Never rejects. The host call fails on the Tauri build (no such channel) and
 * in a browser-only `npm run dev` preview (no bridge at all), and in both cases
 * the honest answer is "no imported themes" — not an error banner over a
 * gallery whose four built-ins work fine.
 */
export async function loadCustomThemes(): Promise<void> {
  await collect(listThemeFiles);
}

/** Open the picker, copy the chosen files in, then republish the folder. */
export async function importCustomThemes(): Promise<void> {
  await collect(importThemeFiles);
}

/** Open the themes folder in the OS file manager. Failure is not actionable. */
export async function openThemesFolder(): Promise<void> {
  try {
    await revealThemesFolder();
  } catch {
    // The only failure modes are a host that has no such channel and an OS
    // that refused to open a file manager. Neither is something the user can
    // act on from a settings row, and neither leaves the app in a bad state.
  }
}

async function collect(read: () => Promise<ThemeScan>): Promise<void> {
  themesLoading.value = true;
  try {
    const { entries, rejected } = await read();
    const presets: ThemePreset[] = [];
    // Host refusals first: they are the files the user just picked, so they
    // are the rows that answer "where did my import go".
    const failures: ThemeImportFailure[] = [...rejected];
    for (const entry of entries) {
      const parsed = parseThemeFile(entry.fileName, entry.content);
      if (parsed.result.ok) {
        presets.push({
          id: parsed.id,
          label: parsed.result.label,
          theme: parsed.result.colors,
          fileName: entry.fileName,
        });
      } else {
        failures.push({
          fileName: entry.fileName,
          reason: parsed.result.reason,
        });
      }
    }
    customPresets.value = presets;
    themeImportFailures.value = failures;
  } catch {
    // See `loadCustomThemes` — an unreachable folder means no imported themes,
    // and the built-ins are unaffected. Leaving the previous list in place
    // would be worse: it would claim files exist that the host just failed to
    // confirm.
    customPresets.value = [];
    themeImportFailures.value = [];
  } finally {
    themesLoading.value = false;
  }
}
