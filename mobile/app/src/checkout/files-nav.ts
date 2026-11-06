/** Paths on the phone are always relative to the checkout (the `root`); "" is the root itself. */

/** A directory entry's name as a single path segment, or false for anything that could climb or split a path. */
export function isSafeSegment(name: string): boolean {
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\u0000")
  );
}

/** `current/name`, or null when `name` is not a plain segment. The desktop guards too; this never asks it to. */
export function childPath(current: string, name: string): string | null {
  if (!isSafeSegment(name) || !isNormalPath(current)) return null;
  return current === "" ? name : `${current}/${name}`;
}

/** The directory above `current`; the root has no parent. */
export function parentPath(current: string): string | null {
  if (current === "") return null;
  const cut = current.lastIndexOf("/");
  return cut < 0 ? "" : current.slice(0, cut);
}

/** True for "" and for paths made only of plain segments: nothing absolute, no `..`, no empty parts. */
export function isNormalPath(path: string): boolean {
  return path === "" || path.split("/").every(isSafeSegment);
}

export function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

export function dirName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** `1.2 MB`, `340 KB`, `12 B`: file sizes in a listing. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit]}`;
}
