import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  BracketsIcon,
  File01Icon,
  FileCodeIcon,
  FileEditIcon,
  FileImageIcon,
  Folder01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import type { DeckGlyph } from "../../ui/controls/deck-icon";
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
const EXTENSION_ICONS: ReadonlyMap<string, DeckGlyph> = new Map([
  ...CODE_EXTENSIONS.map((extension): [string, DeckGlyph] => [extension, FileCodeIcon]),
  ["json", BracketsIcon],
  ...IMAGE_EXTENSIONS.map((extension): [string, DeckGlyph] => [extension, FileImageIcon]),
  ...TEXT_EXTENSIONS.map((extension): [string, DeckGlyph] => [extension, FileEditIcon]),
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
export function directoryIcon(expanded: boolean): DeckGlyph {
  return expanded ? FolderOpenIcon : Folder01Icon;
}

/** A file's glyph by extension, falling back to the generic file glyph. */
export function fileIcon(name: string): DeckGlyph {
  const extension = extensionOf(name);
  if (extension === null) {
    return File01Icon;
  }
  return EXTENSION_ICONS.get(extension) ?? File01Icon;
}

/** The disclosure chevron for one row's expansion state. */
export function chevronForRow(row: TreeRow): DeckGlyph {
  return row.expanded ? ArrowDown01Icon : ArrowRight01Icon;
}

/** The type glyph for one row, directory or file. */
export function iconForRow(row: TreeRow): DeckGlyph {
  return row.directory ? directoryIcon(row.expanded) : fileIcon(row.name);
}
