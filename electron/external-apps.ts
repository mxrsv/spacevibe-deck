/**
 * The external-app catalog, its detection, its icons and its launcher —
 * the main-process half of `src/lib/external-app-catalog.ts` (design §4.2),
 * the same arrangement `agents.ts` has with `BUILTIN_AGENTS`.
 *
 * Two rules carry the safety here, both inherited rather than invented:
 *
 *  - **Launching is `execFile` with argv, never a shell string.** The path
 *    arrives from terminal output, which is untrusted by construction; the
 *    same rule `links.ts` already enforces for editor templates.
 *  - **Detection is a directory check.** A macOS `.app` IS a directory, so
 *    "installed" is answered by `fs.stat`, with no new probe, no login shell
 *    and no third-party logo entering the repo — the icon is read off the
 *    bundle the user actually has.
 *
 * Electron-only. Tauri has no counterpart and will not grow one: the host is
 * feature-frozen, and its ⌘+click keeps the `open_editor` path it always had.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { hasRejectedRoot } from "./shell-integration";

/** Mirrors `MAX_PATH_BYTES` in `links.ts` — one cap, stated in both halves. */
const MAX_PATH_BYTES = 32_768;

/** A GUI app returns from `open` immediately; anything slower has hung. */
const LAUNCH_TIMEOUT_MS = 10_000;

/** How far up the tree a repository search walks before giving up. */
const MAX_REPO_DEPTH = 64;

export type ExternalAppGroup = "editor" | "git" | "files" | "terminal";
export type TargetRule = "as-is" | "directory" | "repository" | "reveal";

interface CatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly group: ExternalAppGroup;
  /**
   * Bundle locations to try, in order. `~` is expanded at scan time: an app
   * installed per-user lives under `~/Applications`, and only checking
   * `/Applications` would report a working install as absent.
   */
  readonly bundles: readonly string[];
  readonly opensFile: TargetRule;
  readonly opensFolder: TargetRule;
}

/**
 * Mirrors `EXTERNAL_APPS` in `src/lib/external-app-catalog.ts`, id for id and
 * rule for rule. `external-apps.test.ts` pins the two together, because a
 * catalog that disagrees with itself shows an app in the menu that nothing can
 * launch.
 */
export const EXTERNAL_APP_CATALOG: readonly CatalogEntry[] = [
  {
    id: "vscode",
    label: "VS Code",
    group: "editor",
    bundles: ["/Applications/Visual Studio Code.app", "~/Applications/Visual Studio Code.app"],
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "cursor",
    label: "Cursor",
    group: "editor",
    bundles: ["/Applications/Cursor.app", "~/Applications/Cursor.app"],
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "zed",
    label: "Zed",
    group: "editor",
    bundles: ["/Applications/Zed.app", "~/Applications/Zed.app"],
    opensFile: "as-is",
    opensFolder: "as-is",
  },
  {
    id: "github-desktop",
    label: "GitHub Desktop",
    group: "git",
    bundles: ["/Applications/GitHub Desktop.app", "~/Applications/GitHub Desktop.app"],
    opensFile: "repository",
    opensFolder: "repository",
  },
  {
    id: "gitkraken",
    label: "GitKraken",
    group: "git",
    bundles: ["/Applications/GitKraken.app", "~/Applications/GitKraken.app"],
    opensFile: "repository",
    opensFolder: "repository",
  },
  {
    id: "finder",
    label: "Finder",
    group: "files",
    // Finder is not optional on macOS, but the path is declared rather than
    // assumed so the catalog has exactly one shape.
    bundles: ["/System/Library/CoreServices/Finder.app"],
    opensFile: "reveal",
    opensFolder: "as-is",
  },
  {
    id: "terminal",
    label: "Terminal",
    group: "terminal",
    // Apple moved the bundle out of `/Applications` in Big Sur; both spellings
    // are live on machines that have been upgraded in place.
    bundles: [
      "/System/Applications/Utilities/Terminal.app",
      "/Applications/Utilities/Terminal.app",
    ],
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "iterm2",
    label: "iTerm2",
    group: "terminal",
    bundles: ["/Applications/iTerm.app", "~/Applications/iTerm.app"],
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "ghostty",
    label: "Ghostty",
    group: "terminal",
    bundles: ["/Applications/Ghostty.app", "~/Applications/Ghostty.app"],
    opensFile: "directory",
    opensFolder: "as-is",
  },
  {
    id: "hyper",
    label: "Hyper",
    group: "terminal",
    bundles: ["/Applications/Hyper.app", "~/Applications/Hyper.app"],
    opensFile: "directory",
    opensFolder: "as-is",
  },
];

export interface InstalledApp {
  readonly id: string;
  readonly label: string;
  readonly group: ExternalAppGroup;
  /** The real icon of the version installed, as a `data:` URL (design §4.2). */
  readonly iconDataUrl: string | null;
}

function expandHome(target: string, home: string): string {
  return target.startsWith("~/") ? path.join(home, target.slice(2)) : target;
}

/** The first bundle of `entry` that exists, or null. */
export function bundlePath(entry: CatalogEntry, home: string = os.homedir()): string | null {
  for (const candidate of entry.bundles) {
    const full = expandHome(candidate, home);
    try {
      // A `.app` is a DIRECTORY — the same fact `dirs_exist` already relies on,
      // which is why detection needs no channel of its own.
      if (fs.statSync(full).isDirectory()) {
        return full;
      }
    } catch {
      // Absent or unreadable: try the next spelling.
    }
  }
  return null;
}

/**
 * Icons are read once per bundle and kept for the life of the process.
 *
 * NOT `app.getFileIcon`, which the design named: measured on this machine
 * (2026-08-20, Electron 43.4.1), it returns the GENERIC document icon for a
 * `.app` bundle — VS Code's and Finder's answers were byte-identical — and
 * `{ size: "large" }` crashes the process outright (SIGTRAP). The bundle's own
 * `.icns` is read instead: `CFBundleIconFile` from `Contents/Info.plist` (the
 * value ships with or without its extension, and iTerm2's carries spaces),
 * falling back to the first `.icns` in `Contents/Resources`. Electron's
 * `nativeImage` cannot decode ICNS (also measured — `createFromPath` answers
 * empty), so `/usr/bin/sips` converts it, argv only, into the app's temp dir.
 * All 10 catalog apps on this machine resolve an `.icns` this way.
 */
const iconCache = new Map<string, string | null>();

/** 64px: crisp at the control's 15px and the menu's 16px on a 2× display,
 * without shipping a megabyte of 1024px artwork over IPC per app. */
const ICON_PX = "64";

function run(executable: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], { timeout: 5_000 }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(String(stdout));
    });
  });
}

/** The bundle's own icon file, or null. */
async function icnsPath(bundle: string): Promise<string | null> {
  const resources = path.join(bundle, "Contents", "Resources");
  try {
    const declared = (
      await run("/usr/bin/defaults", [
        "read",
        path.join(bundle, "Contents", "Info"),
        "CFBundleIconFile",
      ])
    ).trim();
    if (declared.length > 0) {
      const base = declared.endsWith(".icns") ? declared.slice(0, -".icns".length) : declared;
      const full = path.join(resources, `${base}.icns`);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  } catch {
    // No key, unreadable plist — fall through to the directory scan.
  }
  try {
    const first = fs.readdirSync(resources).find((entry) => entry.endsWith(".icns"));
    return first === undefined ? null : path.join(resources, first);
  } catch {
    return null;
  }
}

async function iconFor(bundle: string): Promise<string | null> {
  const cached = iconCache.get(bundle);
  if (cached !== undefined) {
    return cached;
  }
  let url: string | null = null;
  try {
    const icns = await icnsPath(bundle);
    if (icns !== null) {
      const out = path.join(
        app.getPath("temp"),
        `deck-appicon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
      );
      try {
        await run("/usr/bin/sips", [
          "-s",
          "format",
          "png",
          "-z",
          ICON_PX,
          ICON_PX,
          icns,
          "--out",
          out,
        ]);
        const png = fs.readFileSync(out);
        url = `data:image/png;base64,${png.toString("base64")}`;
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
  } catch {
    // An icon that cannot be read is not a reason to hide a working app; the
    // menu falls back to the label alone. `getFileIcon` is deliberately NOT
    // the fallback — a generic document icon on every row is worse than none.
    url = null;
  }
  iconCache.set(bundle, url);
  return url;
}

/**
 * Every installed app, in catalog order, with its icon.
 *
 * An app that is not installed is ABSENT rather than disabled, mirroring how
 * Settings › Agents splits Installed from Available: the question the menu
 * answers is "what can Deck reach", not "what exists in the world".
 */
export async function listExternalApps(): Promise<InstalledApp[]> {
  if (process.platform !== "darwin") {
    // Windows and Linux bundle layouts are unmodelled (Gate C). An empty list
    // is honest: the caller then shows no menu rather than a menu of guesses.
    return [];
  }
  const home = os.homedir();
  const found: InstalledApp[] = [];
  for (const entry of EXTERNAL_APP_CATALOG) {
    const bundle = bundlePath(entry, home);
    if (bundle === null) {
      continue;
    }
    found.push({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      iconDataUrl: await iconFor(bundle),
    });
  }
  return found;
}

/**
 * The git repository root that holds `target`, or null.
 *
 * `.git` is matched as an ENTRY, not as a directory: a worktree's `.git` is a
 * file pointing at the main checkout, and treating it as absent would send
 * every worktree's clicks to the parent repository — or to nothing at all.
 */
export function repositoryRoot(target: string): string | null {
  let current = path.resolve(target);
  for (let depth = 0; depth < MAX_REPO_DEPTH; depth += 1) {
    try {
      fs.lstatSync(path.join(current, ".git"));
      return current;
    } catch {
      // Not here — keep walking.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

export interface OpenInAppRequest {
  readonly appId: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

/** What the app is handed, given its rule and the target it was asked about. */
export function resolveTarget(
  rule: TargetRule,
  target: string,
  isDirectory: boolean,
): { readonly path: string; readonly reveal: boolean } | { readonly error: string } {
  switch (rule) {
    case "as-is":
      return { path: target, reveal: false };
    case "reveal":
      // A folder has nothing to reveal it INSIDE — open it instead.
      return isDirectory ? { path: target, reveal: false } : { path: target, reveal: true };
    case "directory":
      return {
        path: isDirectory ? target : path.dirname(target),
        reveal: false,
      };
    case "repository": {
      const root = repositoryRoot(isDirectory ? target : path.dirname(target));
      if (root !== null) {
        return { path: root, reveal: false };
      }
      // A folder git does not know is still a folder the app can be pointed
      // at; a FILE outside every repository is not something a git client can
      // do anything with, and saying so beats opening the wrong window.
      return isDirectory
        ? { path: target, reveal: false }
        : { error: "That file is not inside a git repository." };
    }
  }
}

/**
 * Open `request.path` in the selected app.
 *
 * Every argument is argv — `open` is given `-a <bundle>` and the target as
 * separate arguments, so a path holding a space, a quote or a semicolon is
 * data and can never become a second command.
 */
export function openInApp(request: OpenInAppRequest): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Opening an app is unavailable on this platform.");
  }
  const entry = EXTERNAL_APP_CATALOG.find((item) => item.id === request.appId);
  if (entry === undefined) {
    throw new Error("That app is not one Deck knows how to open.");
  }
  const target = request.path;
  if (
    typeof target !== "string" ||
    target.length === 0 ||
    target.length > MAX_PATH_BYTES ||
    target.includes("\0") ||
    !path.isAbsolute(target)
  ) {
    throw new Error("The path to open must be absolute.");
  }
  if (hasRejectedRoot(target)) {
    throw new Error("The path to open must not be a network location.");
  }
  const bundle = bundlePath(entry);
  if (bundle === null) {
    throw new Error(`${entry.label} is not installed.`);
  }
  const rule = request.isDirectory ? entry.opensFolder : entry.opensFile;
  const resolved = resolveTarget(rule, target, request.isDirectory);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const args = resolved.reveal ? ["-R", resolved.path] : ["-a", bundle, resolved.path];
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/open",
      args,
      { timeout: LAUNCH_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        const detail = String(stderr).trim();
        reject(
          new Error(
            detail.length > 0
              ? `Couldn't open ${entry.label}: ${detail}`
              : `Couldn't open ${entry.label}.`,
          ),
        );
      },
    );
    child.unref();
  });
}
