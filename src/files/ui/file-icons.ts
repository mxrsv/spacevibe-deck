/**
 * The monochrome file-type icon vocabulary (spec §3.1, DL-18.10).
 *
 * Written for the tree's data rows and docked-panel-only until 2026-08-16,
 * when the tab strip's chips became glyph-led: a document's chip takes the
 * same glyph its row in the tree has, so the two can never name the same file
 * with two different pictures. Still the one library DL-14.1 names, so this
 * is a vocabulary inside it rather than a second library.
 *
 * `EXCLUDED_NAMES` already lives in `file-tree.ts` as the tree's one named
 * exclusion-list constant (spec §3.1); this module owns icon selection only
 * and never re-lists which entries are hidden.
 */
import {
  BracketsCurly,
  CaretDown,
  CaretRight,
  File,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
} from "@phosphor-icons/react";
import type { DeckIconComponent } from "../../ui/controls/deck-icon";
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

const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];

const TEXT_EXTENSIONS: readonly string[] = ["md", "mdx", "txt"];

/** Extension → glyph, built once from the readable lists above. */
const EXTENSION_ICONS: ReadonlyMap<string, DeckIconComponent> = new Map([
  ...CODE_EXTENSIONS.map((extension): [string, DeckIconComponent] => [extension, FileCode]),
  ["json", BracketsCurly],
  ...IMAGE_EXTENSIONS.map((extension): [string, DeckIconComponent] => [extension, FileImage]),
  ...TEXT_EXTENSIONS.map((extension): [string, DeckIconComponent] => [extension, FileText]),
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
export function directoryIcon(expanded: boolean): DeckIconComponent {
  return expanded ? FolderOpen : Folder;
}

/** A file's glyph by extension, falling back to the generic file glyph. */
export function fileIcon(name: string): DeckIconComponent {
  const extension = extensionOf(name);
  if (extension === null) {
    return File;
  }
  return EXTENSION_ICONS.get(extension) ?? File;
}

/** The disclosure chevron for one row's expansion state. */
export function chevronForRow(row: TreeRow): DeckIconComponent {
  return row.expanded ? CaretDown : CaretRight;
}

/** The type glyph for one row, directory or file. */
export function iconForRow(row: TreeRow): DeckIconComponent {
  return row.directory ? directoryIcon(row.expanded) : fileIcon(row.name);
}
