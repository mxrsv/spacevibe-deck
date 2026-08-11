/**
 * The file-type icon vocabulary (DL-16.5).
 *
 * A SECOND vocabulary beside §14's action icons — indexed by what a file IS
 * rather than by what a control DOES — and permitted only in a docked panel's
 * data rows. It is drawn from the Lucide set the app already bundles: a
 * dedicated icon package would add weight for glyphs that are already here, and
 * DL-1's frugality rule is a hard constraint, not a preference.
 *
 * Monochrome at `--text-faint`, taking the row's color when selected. Colored
 * per-type icons are the familiar look, but §3's color roles are strict and
 * each hue already means something; a palette of file types would spend those
 * meanings on file extensions. Colored icons remain a DL-3 exception someone
 * has to take explicitly.
 */
import {
  Braces,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileLock,
  FileMusic,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideoCamera,
  Folder,
  FolderOpen,
  FolderSymlink,
  type LucideIcon,
} from "lucide-preact";

/** Exact filenames worth their own glyph, matched before any extension. */
const BY_FILENAME: readonly (readonly [string, LucideIcon])[] = [
  ["Dockerfile", FileCog],
  ["Containerfile", FileCog],
  ["Makefile", FileTerminal],
  ["LICENSE", FileText],
  [".gitignore", FileCog],
  [".env", FileKey],
];

const BY_EXTENSION: Readonly<Record<string, LucideIcon>> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  cjs: FileCode,
  rs: FileCode,
  go: FileCode,
  py: FileCode,
  rb: FileCode,
  php: FileCode,
  java: FileCode,
  kt: FileCode,
  swift: FileCode,
  c: FileCode,
  h: FileCode,
  cc: FileCode,
  cpp: FileCode,
  hpp: FileCode,
  cs: FileCode,
  lua: FileCode,
  json: Braces,
  jsonc: Braces,
  yaml: FileCog,
  yml: FileCog,
  toml: FileCog,
  ini: FileCog,
  cfg: FileCog,
  conf: FileCog,
  properties: FileCog,
  md: FileText,
  markdown: FileText,
  mdx: FileText,
  txt: FileText,
  rst: FileText,
  css: FileType,
  scss: FileType,
  less: FileType,
  html: FileType,
  htm: FileType,
  xml: FileType,
  svg: FileImage,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  ico: FileImage,
  mp3: FileMusic,
  wav: FileMusic,
  flac: FileMusic,
  mp4: FileVideoCamera,
  mov: FileVideoCamera,
  webm: FileVideoCamera,
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  tgz: FileArchive,
  csv: FileSpreadsheet,
  tsv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
  sql: FileSpreadsheet,
  pem: FileKey,
  key: FileKey,
  lock: FileLock,
};

/** The glyph for one tree row. */
export function iconForRow(row: {
  readonly name: string;
  readonly directory: boolean;
  readonly expanded: boolean;
  readonly outOfRoot: boolean;
}): LucideIcon {
  if (row.outOfRoot) {
    // A symlink out of the root renders as a leaf and does not open (spec
    // §3.1); saying so with the glyph beats saying nothing.
    return FolderSymlink;
  }
  if (row.directory) {
    return row.expanded ? FolderOpen : Folder;
  }
  for (const [filename, icon] of BY_FILENAME) {
    if (row.name === filename || row.name.startsWith(`${filename}.`)) {
      return icon;
    }
  }
  const dot = row.name.lastIndexOf(".");
  if (dot <= 0) {
    return File;
  }
  return BY_EXTENSION[row.name.slice(dot + 1).toLowerCase()] ?? File;
}
