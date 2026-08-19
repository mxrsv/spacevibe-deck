import { fileURLToPath } from "node:url";

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

const RUST_EDITION = "2021";

export function generatedTextMatches(fresh: string, committed: string): boolean {
  return normalizeLineEndings(fresh) === normalizeLineEndings(committed);
}

export function rustfmtArguments(...paths: string[]): string[] {
  return ["--edition", RUST_EDITION, ...paths];
}

export function generatedFilePath(url: URL, windows = process.platform === "win32"): string {
  return fileURLToPath(url, { windows });
}
