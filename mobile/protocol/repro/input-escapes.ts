/** `\r`, `\n`, `\t`, `\e`, `\xHH` and `\\`, so a shell argument can carry an Enter key. */
export function unescapeInput(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|[rnte\\])/g, (_match, code: string) => {
    if (code.startsWith("x")) return String.fromCharCode(parseInt(code.slice(1), 16));
    return { r: "\r", n: "\n", t: "\t", e: String.fromCharCode(0x1b), "\\": "\\" }[code] ?? "";
  });
}
