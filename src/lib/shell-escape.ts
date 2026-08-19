import type { DesktopPlatform } from "./platform";

// Characters that never need escaping on a command line (iTerm2-style).
const SAFE_CHAR = /[A-Za-z0-9/._+:@%,=~-]/;

/** Escape a path so it can be pasted safely onto a shell command line (iTerm2-style). */
export function shellEscapePath(path: string, platform: DesktopPlatform): string {
  if (platform === "windows") {
    return `'${path.replace(/'/g, "''")}'`;
  }
  let out = "";
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    // Keep safe ASCII characters and all unicode (> 127) as-is;
    // backslash-escape the rest (space, quotes, $, &, parentheses, ...).
    if (SAFE_CHAR.test(ch) || code > 127) {
      out += ch;
    } else {
      out += `\\${ch}`;
    }
  }
  return out;
}

/** Escape and join multiple paths with spaces, adding one trailing space. */
export function shellEscapePaths(paths: readonly string[], platform: DesktopPlatform): string {
  if (paths.length === 0) {
    return "";
  }
  return `${paths.map((path) => shellEscapePath(path, platform)).join(" ")} `;
}
