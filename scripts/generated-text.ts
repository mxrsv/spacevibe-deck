function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function generatedTextMatches(
  fresh: string,
  committed: string,
): boolean {
  return normalizeLineEndings(fresh) === normalizeLineEndings(committed);
}
