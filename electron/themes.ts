/**
 * The themes folder: `<userData>/themes`.
 *
 * The folder IS the model. Import copies a file in, removal is deleting a file
 * out of it, and the renderer's list is a re-read — there is no second registry
 * to keep in step, and a theme survives an app reinstall the same way the rest
 * of `userData` does.
 *
 * Nothing here parses a theme. The four grammars live in
 * `src/settings/theme-formats/`, which the renderer owns; this module only ever
 * moves bytes, which is why a malformed file costs a card in the gallery rather
 * than a main-process throw.
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/**
 * Extensions the picker offers and the scan reads.
 *
 * Duplicated from `THEME_FILE_EXTENSIONS` in
 * `src/settings/theme-formats/parse-theme-file.ts` on purpose: pulling the
 * renderer's parser chain into the main-process tsconfig to share one array
 * would drag `@xterm/xterm` types across a boundary that otherwise moves only
 * strings. `themes.test.ts` fails if the two lists drift.
 */
const THEME_EXTENSIONS = ["json", "itermcolors", "toml", "conf", "theme", "txt"] as const;

/**
 * Per-file ceiling. A terminal palette is twenty-odd colours — the largest
 * iTerm2 preset in circulation is under 30 KB — so anything past this is not a
 * theme, and reading it would only cost the renderer a parse that must fail.
 */
const MAX_FILE_BYTES = 512 * 1024;

/** Folder ceiling, so a directory pointed at a colour archive cannot stall boot. */
const MAX_FILES = 400;

export interface ThemeFileEntry {
  readonly fileName: string;
  readonly content: string;
}

/**
 * A file this module refused, and the sentence the settings surface shows.
 *
 * DL-24.6 requires that nothing an import touches disappears without a trace.
 * A rejection is that trace: the renderer renders one row per entry here, the
 * same way it renders a file that reached the parser and failed.
 */
export interface ThemeFileRejection {
  readonly fileName: string;
  readonly reason: string;
}

export interface ThemeScan {
  readonly entries: ThemeFileEntry[];
  readonly rejected: ThemeFileRejection[];
}

export function themesDir(): string {
  return join(app.getPath("userData"), "themes");
}

/**
 * Read every theme file in the folder.
 *
 * Total by construction: a file that cannot be read costs itself, never the
 * list. The folder is created on first read so that "reveal folder" always has
 * somewhere to open, even before the first import.
 *
 * Reads run concurrently rather than one at a time. The ceiling is 400 files,
 * and this scan is awaited before the first paint on purpose (`main.tsx`) —
 * serialising 400 `stat`+`readFile` round trips would put the whole folder on
 * the boot critical path one file at a time.
 */
export async function listThemes(): Promise<ThemeScan> {
  const dir = themesDir();
  await mkdir(dir, { recursive: true });
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { entries: [], rejected: [] };
  }
  const wanted = names
    .filter((name) => isThemeFileName(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_FILES);

  const read = await Promise.all(
    wanted.map(async (fileName) => ({
      fileName,
      result: await readIfSmall(join(dir, fileName)),
    })),
  );

  const entries: ThemeFileEntry[] = [];
  const rejected: ThemeFileRejection[] = [];
  for (const { fileName, result } of read) {
    if (typeof result === "string") {
      entries.push({ fileName, content: result });
    } else {
      // A file sitting in the themes folder that cannot be read is a theme the
      // user believes they have. Silence here is exactly what DL-24.6 forbids.
      rejected.push({ fileName, reason: result.reason });
    }
  }
  return { entries, rejected };
}

/**
 * Show the picker, copy what was chosen into the folder, return the new list.
 *
 * The dialog is modal to the window that asked, so a second window cannot end
 * up owning a sheet the user opened from the first one.
 */
export async function importThemes(window: BrowserWindow | null): Promise<ThemeScan> {
  const options: Electron.OpenDialogOptions = {
    title: "Import terminal themes",
    properties: ["openFile", "multiSelections"],
    filters: [
      // "All files" stays on the list because Ghostty ships its themes with NO
      // extension at all — a picker restricted to the named extensions could
      // not open half the collection this feature exists to read.
      { name: "Terminal themes", extensions: [...THEME_EXTENSIONS] },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const picked =
    window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);
  if (picked.canceled) {
    return listThemes();
  }

  const dir = themesDir();
  await mkdir(dir, { recursive: true });
  const taken = new Set(await readdir(dir).catch(() => [] as string[]));
  const rejected: ThemeFileRejection[] = [];
  for (const source of picked.filePaths) {
    // `basename` is the whole sanitisation this needs: the destination is
    // always `dir` + one path segment, so no traversal survives the join.
    const fileName = basename(source);
    // Screen BEFORE copying, not after. `listThemes` filters the folder by the
    // same rules, so a file copied in that fails them would sit on disk
    // forever with no card and no row — an import that looks like it never
    // happened, which is precisely what DL-24.6 forbids. Refusing here costs
    // the copy and produces a sentence the user can act on.
    const refusal = await refuseImport(source, fileName);
    if (refusal !== null) {
      rejected.push({ fileName, reason: refusal });
      continue;
    }
    const target = uniqueName(fileName, taken);
    try {
      await copyFile(source, join(dir, target));
      taken.add(target);
    } catch {
      // A full disk or a source that vanished between the pick and the copy.
      // One file's problem, never the whole import's — but it is still the
      // user's file, so it leaves with a reason rather than in silence.
      rejected.push({ fileName, reason: "the file could not be copied in" });
    }
  }
  const scan = await listThemes();
  return { entries: scan.entries, rejected: [...rejected, ...scan.rejected] };
}

/** The reason this file cannot become a theme, or null when it can. */
async function refuseImport(source: string, fileName: string): Promise<string | null> {
  if (!isThemeFileName(fileName)) {
    return `${extname(fileName) || "this file type"} is not a theme file`;
  }
  try {
    const info = await stat(source);
    if (!info.isFile()) {
      return "not a file";
    }
    if (info.size > MAX_FILE_BYTES) {
      return `too large to be a theme (over ${MAX_FILE_BYTES / 1024} KB)`;
    }
  } catch {
    return "the file could not be read";
  }
  return null;
}

/** Open the folder in Finder/Explorer — how a user removes an imported theme. */
export async function revealThemes(): Promise<void> {
  const dir = themesDir();
  await mkdir(dir, { recursive: true });
  await shell.openPath(dir);
}

/**
 * Whether a name is shaped like a theme file.
 *
 * An empty extension counts: Ghostty's whole collection is extensionless, and
 * a rule that demanded one would refuse a format this feature claims to read.
 * Dotfiles do not — `.DS_Store` also has no extension, and it is never a theme.
 */
export function isThemeFileName(fileName: string): boolean {
  if (fileName.startsWith(".")) {
    return false;
  }
  const extension = extname(fileName).slice(1).toLowerCase();
  return extension === "" || (THEME_EXTENSIONS as readonly string[]).includes(extension);
}

/** File text, or the reason it is not readable as a theme. */
async function readIfSmall(path: string): Promise<string | { reason: string }> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return { reason: "not a file" };
    }
    if (info.size > MAX_FILE_BYTES) {
      return {
        reason: `too large to be a theme (over ${MAX_FILE_BYTES / 1024} KB)`,
      };
    }
    return await readFile(path, "utf8");
  } catch {
    return { reason: "the file could not be read" };
  }
}

/**
 * `dracula.json` → `dracula-2.json` when the name is taken.
 *
 * Importing the same file twice is a user mistake worth showing, not one worth
 * silently overwriting an existing theme for — the folder is the model, and a
 * copy that clobbers is a copy that can destroy a theme the user hand-edited.
 */
export function uniqueName(fileName: string, taken: ReadonlySet<string>): string {
  if (!taken.has(fileName)) {
    return fileName;
  }
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return fileName;
}
