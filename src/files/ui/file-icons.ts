/**
 * The tree's monochrome icon vocabulary (spec §3.1, DL §8/§19 file-type icon
 * rule) — a second icon set beside §14's Lucide chrome set, permitted only in
 * a docked panel's data rows.
 *
 * `EXCLUDED_NAMES` already lives in `file-tree.ts` as the tree's one named
 * exclusion-list constant (spec §3.1); this module owns icon selection only
 * and never re-lists which entries are hidden.
 */
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-preact";
import type { TreeRow } from "../file-tree";

const CODE_EXTENSIONS: readonly string[] = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "css",
  "html",
  "toml",
  "yaml",
  "yml",
];

const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
];

const TEXT_EXTENSIONS: readonly string[] = ["md", "mdx", "txt"];

/** Extension → glyph, built once from the readable lists above. */
const EXTENSION_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ...CODE_EXTENSIONS.map((extension): [string, LucideIcon] => [
    extension,
    FileCode,
  ]),
  ["json", FileJson],
  ...IMAGE_EXTENSIONS.map((extension): [string, LucideIcon] => [
    extension,
    FileImage,
  ]),
  ...TEXT_EXTENSIONS.map((extension): [string, LucideIcon] => [
    extension,
    FileText,
  ]),
]);

/** The part after the last dot, lowercased. A leading-dot dotfile (`.env`)
 * has no extension in this sense — it is a whole name, not a suffixed one. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  return name.slice(dot + 1).toLowerCase();
}

/** A directory's glyph, open or closed. */
export function directoryIcon(expanded: boolean): LucideIcon {
  return expanded ? FolderOpen : Folder;
}

/** A file's glyph by extension, falling back to the generic file glyph. */
export function fileIcon(name: string): LucideIcon {
  const extension = extensionOf(name);
  if (extension === null) {
    return File;
  }
  return EXTENSION_ICONS.get(extension) ?? File;
}

/** The disclosure chevron for one row's expansion state. */
export function chevronForRow(row: TreeRow): LucideIcon {
  return row.expanded ? ChevronDown : ChevronRight;
}

/** The type glyph for one row, directory or file. */
export function iconForRow(row: TreeRow): LucideIcon {
  return row.directory ? directoryIcon(row.expanded) : fileIcon(row.name);
}
