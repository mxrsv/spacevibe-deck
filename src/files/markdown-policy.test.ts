/**
 * The §6 policy as a table. Every row here is a security decision, which is
 * why they are asserted as pure values rather than through a rendered
 * document: a `javascript:` link that stops being dead must fail in one
 * obvious place.
 */
import { describe, expect, it } from "vitest";
import {
  classifyImage,
  classifyLink,
  defaultViewMode,
  escapeHtml,
  isInsideRoot,
  isMarkdownPath,
  resolveRelativePath,
} from "./markdown-policy";

const LOCATION = {
  docPath: "/repo/docs/guide.md",
  workspaceRoot: "/repo",
};

describe("defaultViewMode", () => {
  it("opens .md and .markdown rendered", () => {
    expect(defaultViewMode("/repo/README.md")).toBe("rendered");
    expect(defaultViewMode("/repo/notes.markdown")).toBe("rendered");
    // Case is not a signal: `.MD` turns up in real repositories.
    expect(defaultViewMode("/repo/README.MD")).toBe("rendered");
  });

  it("opens .mdx as source", () => {
    // JSX renders as broken prose, so source is the honest default (design §1).
    expect(defaultViewMode("/repo/page.mdx")).toBe("source");
  });

  it("opens anything else as source", () => {
    expect(defaultViewMode("/repo/app.ts")).toBe("source");
  });
});

describe("isMarkdownPath", () => {
  it("offers the toggle on .mdx even though it opens as source", () => {
    expect(isMarkdownPath("/repo/page.mdx")).toBe(true);
    expect(isMarkdownPath("/repo/app.ts")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could reopen markup, quotes included", () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;",
    );
  });

  it("escapes the ampersand first, so an escape is not double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("resolveRelativePath", () => {
  it("resolves against the document's own directory", () => {
    expect(resolveRelativePath("/repo/docs/guide.md", "img/a.png")).toBe("/repo/docs/img/a.png");
  });

  it("walks up", () => {
    expect(resolveRelativePath("/repo/docs/guide.md", "../src/app.ts")).toBe("/repo/src/app.ts");
  });

  it("cannot walk past the filesystem root", () => {
    expect(resolveRelativePath("/repo/a.md", "../../../../etc/passwd")).toBe("/etc/passwd");
  });

  it("honours a backslash-spelled path", () => {
    expect(resolveRelativePath("C:\\repo\\docs\\guide.md", "..\\src\\app.ts")).toBe(
      "C:\\repo\\src\\app.ts",
    );
  });
});

describe("isInsideRoot", () => {
  it("compares segment-wise, so a sibling prefix is not inside", () => {
    expect(isInsideRoot("/repo", "/repo/src/a.ts")).toBe(true);
    expect(isInsideRoot("/repo", "/repo-backup/a.ts")).toBe(false);
  });

  it("does not count the root itself as inside", () => {
    expect(isInsideRoot("/repo", "/repo")).toBe(false);
  });
});

describe("classifyLink", () => {
  it("kills javascript: and data:", () => {
    expect(classifyLink("javascript:alert(1)", LOCATION)).toEqual({ kind: "dead" });
    expect(classifyLink("JavaScript:alert(1)", LOCATION)).toEqual({ kind: "dead" });
    expect(classifyLink("data:text/html,<script>", LOCATION)).toEqual({ kind: "dead" });
  });

  it("kills every other scheme Deck does not hand to the OS", () => {
    expect(classifyLink("file:///etc/passwd", LOCATION)).toEqual({ kind: "dead" });
    expect(classifyLink("vbscript:x", LOCATION)).toEqual({ kind: "dead" });
    expect(classifyLink("deck-internal:x", LOCATION)).toEqual({ kind: "dead" });
  });

  it("routes http(s) and mailto out through the external path", () => {
    expect(classifyLink("https://example.com/a", LOCATION)).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
    expect(classifyLink("mailto:a@b.c", LOCATION)).toEqual({
      kind: "external",
      url: "mailto:a@b.c",
    });
  });

  it("routes a relative path inside the root into Deck", () => {
    expect(classifyLink("../src/app.ts", LOCATION)).toEqual({
      kind: "workspace",
      path: "/repo/src/app.ts",
    });
  });

  it("kills a relative path that resolves outside the root", () => {
    expect(classifyLink("../../secrets/key.txt", LOCATION)).toEqual({ kind: "dead" });
  });

  it("keeps a fragment jump inside the document", () => {
    expect(classifyLink("#section-one", LOCATION)).toEqual({ kind: "anchor", id: "section-one" });
  });

  it("drops a fragment before resolving a file link", () => {
    expect(classifyLink("../src/app.ts#L4", LOCATION)).toEqual({
      kind: "workspace",
      path: "/repo/src/app.ts",
    });
  });

  it("kills an empty href", () => {
    expect(classifyLink("   ", LOCATION)).toEqual({ kind: "dead" });
  });
});

describe("classifyImage", () => {
  it("reads a relative image inside the root", () => {
    expect(classifyImage("./img/a.png", LOCATION)).toEqual({
      kind: "local",
      path: "/repo/docs/img/a.png",
    });
  });

  it("places a remote URL rather than fetching it", () => {
    expect(classifyImage("https://cdn.example.com/a.png", LOCATION)).toEqual({
      kind: "remote",
      url: "https://cdn.example.com/a.png",
    });
  });

  it("kills a data: image — one payload scheme starts the allowlist", () => {
    expect(classifyImage("data:image/png;base64,AAAA", LOCATION)).toEqual({ kind: "dead" });
  });

  it("kills an image resolving outside the root", () => {
    expect(classifyImage("../../../etc/icon.png", LOCATION)).toEqual({ kind: "dead" });
  });

  it("kills an extension the host would refuse anyway", () => {
    expect(classifyImage("./notes.txt", LOCATION)).toEqual({ kind: "dead" });
  });
});
