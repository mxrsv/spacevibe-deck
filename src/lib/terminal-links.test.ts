import { describe, expect, it } from "vitest";
import { extractLinkCandidates, stripDiffPrefix } from "./terminal-links";

describe("extractLinkCandidates", () => {
  it("matches http and https urls", () => {
    const found = extractLinkCandidates("see https://example.com/a?b=1 and http://localhost:5173/");
    expect(found.map((c) => c.target)).toEqual([
      "https://example.com/a?b=1",
      "http://localhost:5173/",
    ]);
    expect(found.every((c) => c.kind === "url")).toBe(true);
  });

  it("drops trailing punctuation from a url", () => {
    const [url] = extractLinkCandidates("open https://example.com/docs.");
    expect(url.target).toBe("https://example.com/docs");
  });

  it("matches absolute, tilde, dot and bare relative paths", () => {
    const found = extractLinkCandidates("/etc/hosts ~/notes.md ./src/a.ts ../b.ts src/foo.ts");
    expect(found.map((c) => c.target)).toEqual([
      "/etc/hosts",
      "~/notes.md",
      "./src/a.ts",
      "../b.ts",
      "src/foo.ts",
    ]);
  });

  it("matches Windows drive paths with either separator", () => {
    const found = extractLinkCandidates(
      String.raw`C:\Users\dev\src\pane.ts:12:4 C:/Users/dev/docs/readme.md`,
    );

    expect(found.map((candidate) => candidate.target)).toEqual([
      String.raw`C:\Users\dev\src\pane.ts`,
      "C:/Users/dev/docs/readme.md",
    ]);
    expect(found[0]).toMatchObject({ line: 12, col: 4 });
  });

  it("matches UNC and Windows relative paths without rewriting them", () => {
    const found = extractLinkCandidates(
      String.raw`\\server\share\src\pane.ts .\docs\readme.md src\main.ts`,
    );

    expect(found.map((candidate) => candidate.target)).toEqual([
      String.raw`\\server\share\src\pane.ts`,
      String.raw`.\docs\readme.md`,
      String.raw`src\main.ts`,
    ]);
  });

  it("keeps unquoted Windows paths with spaces ambiguous", () => {
    const found = extractLinkCandidates(String.raw`C:\My Files\pane.ts`);

    expect(found).toEqual([]);
  });

  it("does not carve a relative path out of a malformed drive path", () => {
    expect(extractLinkCandidates(String.raw`C:src\pane.ts`)).toEqual([]);
  });

  it("matches a bare filename with an extension", () => {
    const [file] = extractLinkCandidates("edited pane.ts today");
    expect(file.target).toBe("pane.ts");
  });

  it("keeps a non-ascii path whole instead of truncating it", () => {
    const found = extractLinkCandidates("docs/ghi-chú.md:12 docs/日本語.md");
    expect(found.map((c) => c.target)).toEqual(["docs/ghi-chú.md", "docs/日本語.md"]);
    expect(found[0].line).toBe(12);
  });

  it("keeps a decomposed (NFD) filename whole", () => {
    const nfd = "docs/ghi-chú.md".normalize("NFD");
    const [file] = extractLinkCandidates(nfd);
    expect(file.target).toBe(nfd);
  });

  it("does not swallow the box and bullet characters an agent TUI paints", () => {
    expect(extractLinkCandidates("│ src/foo.ts │")[0].target).toBe("src/foo.ts");
    expect(extractLinkCandidates("⏺ Read(src/foo.ts)")[0].target).toBe("src/foo.ts");
  });

  it("parses a line suffix", () => {
    const [file] = extractLinkCandidates("src/foo.ts:12");
    expect(file).toMatchObject({ target: "src/foo.ts", line: 12, col: null });
    expect(file.text).toBe("src/foo.ts:12");
  });

  it("parses a line and column suffix", () => {
    const [file] = extractLinkCandidates("at src/foo.ts:12:34 failed");
    expect(file).toMatchObject({ target: "src/foo.ts", line: 12, col: 34 });
  });

  it("keeps a sentence-final dot out of the path", () => {
    const [file] = extractLinkCandidates("look at src/foo.ts.");
    expect(file.target).toBe("src/foo.ts");
    expect(file.text).toBe("src/foo.ts");
  });

  it("does not match a version number", () => {
    expect(extractLinkCandidates("bumped to v0.2.1 today")).toEqual([]);
  });

  it("does not match a bare word without a dot or slash", () => {
    expect(extractLinkCandidates("the quick brown fox")).toEqual([]);
  });

  it("does not carve a path out of a url", () => {
    const found = extractLinkCandidates("https://github.com/owner/repo.git");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("url");
  });

  it("reports the source range of each candidate", () => {
    const source = "ok src/foo.ts:9 done";
    const [file] = extractLinkCandidates(source);
    expect(source.slice(file.start, file.end)).toBe(file.text);
  });

  it("finds a candidate on either side of a separator", () => {
    // The boundary character is consumed by the match, so the two candidates
    // must not fight over the comma between them.
    const found = extractLinkCandidates("a.ts,b.ts");
    expect(found.map((c) => c.target)).toEqual(["a.ts", "b.ts"]);
    expect(found[1].start).toBe(5);
  });

  it("does not start a candidate inside a longer token", () => {
    expect(extractLinkCandidates("build+src/foo.ts")).toEqual([
      expect.objectContaining({ target: "build+src/foo.ts" }),
    ]);
  });

  it("stays linear on a long run of path characters", () => {
    // These runs used to backtrack quadratically (~85ms at 8k) — provideLinks
    // is synchronous on the UI thread, so a `%%%%` separator or a `@@@` diff
    // header would stutter the hover.
    for (const char of ["+", "@", "%", "a", "."]) {
      const started = performance.now();
      extractLinkCandidates(char.repeat(8000));
      expect(performance.now() - started).toBeLessThan(20);
    }
  });

  it("caps the number of candidates", () => {
    const source = Array.from({ length: 40 }, (_, i) => `f${i}.ts`).join(" ");
    expect(extractLinkCandidates(source, 5)).toHaveLength(5);
  });

  it("ignores a zero line number", () => {
    const [file] = extractLinkCandidates("src/foo.ts:0");
    expect(file.line).toBeNull();
  });

  // Every case below is built from a real sample in the design's §2 table.
  describe("grammars agents actually print", () => {
    it("captures tsc's parenthesised position", () => {
      const source =
        "src/ui/agent-quick-picker.test.tsx(340,15): error TS2554: Expected 1 arguments.";
      const [file] = extractLinkCandidates(source);
      expect(file.target).toBe("src/ui/agent-quick-picker.test.tsx");
      expect(file.line).toBe(340);
      expect(file.col).toBe(15);
      // The clickable text carries the position, exactly as `:line:col` does.
      expect(file.text).toBe("src/ui/agent-quick-picker.test.tsx(340,15)");
      expect(source.slice(file.start, file.end)).toBe(file.text);
    });

    it("leaves a Claude Code tool line alone", () => {
      // `Read(src/foo.ts)` — the parens are boundaries, not a position, and a
      // single parenthesised number is not one either.
      expect(extractLinkCandidates("Read(src/foo.ts)").map((c) => c.text)).toEqual(["src/foo.ts"]);
      expect(extractLinkCandidates("src/foo.ts(3)")[0].text).toBe("src/foo.ts");
    });

    it("keeps matching the colon position", () => {
      const [file] = extractLinkCandidates("--> src/main.rs:12:5");
      expect(file.target).toBe("src/main.rs");
      expect(file.line).toBe(12);
      expect(file.col).toBe(5);
    });

    it("captures Python's quoted path and its line", () => {
      const source = '  File "src/x.py", line 12, in handler';
      const [file] = extractLinkCandidates(source);
      expect(file.target).toBe("src/x.py");
      expect(file.line).toBe(12);
      // The quotes bound the token; the underline stops at the path.
      expect(source.slice(file.start, file.end)).toBe("src/x.py");
    });

    it("is the only route to a path holding a space", () => {
      const [file] = extractLinkCandidates('opened "src/my notes/todo.md"');
      expect(file.target).toBe("src/my notes/todo.md");
      // Unquoted, the same text is two candidates and neither is the file.
      expect(
        extractLinkCandidates("opened src/my notes/todo.md").map((c) => c.target),
      ).not.toContain("src/my notes/todo.md");
    });

    it("ignores a quoted token that cannot be a path", () => {
      expect(extractLinkCandidates('echo "hello world"')).toEqual([]);
    });

    it("emits one candidate for a quoted path, not two", () => {
      // The bare-path rule would match inside the quotes as well; two links
      // over the same cells is what the quoted rule suppresses.
      expect(extractLinkCandidates('"src/x.py"')).toHaveLength(1);
    });
  });

  describe("stripDiffPrefix", () => {
    it("strips git's diff prefixes", () => {
      expect(stripDiffPrefix("a/src/terminal/tab-manager.ts")).toBe("src/terminal/tab-manager.ts");
      expect(stripDiffPrefix("b/src/terminal/tab-manager.ts")).toBe("src/terminal/tab-manager.ts");
    });

    it("leaves anything else alone", () => {
      expect(stripDiffPrefix("src/a/b.ts")).toBeNull();
      expect(stripDiffPrefix("app/main.ts")).toBeNull();
    });

    it("is what makes a diff header clickable", () => {
      const [file] = extractLinkCandidates("--- a/src/terminal/tab-manager.ts");
      expect(file.target).toBe("a/src/terminal/tab-manager.ts");
      expect(stripDiffPrefix(file.target)).toBe("src/terminal/tab-manager.ts");
    });
  });
});
