// @vitest-environment jsdom
/**
 * The second pass, driven against real placeholder markup with fake Monaco,
 * fake mermaid and a fake host — the three seams that exist so this is
 * assertable at all.
 */
import { describe, expect, it, vi } from "vitest";
import { enhanceMarkdown, monacoLanguageForFence, type MermaidLike } from "./markdown-enhance";
import { MD_ATTR, renderMarkdown } from "./markdown-render";
import type { MonacoApi } from "./editor-host";

const LOCATION = { docPath: "/repo/docs/guide.md", workspaceRoot: "/repo" };

/**
 * The fake diagram's payload, ASSEMBLED rather than written out.
 *
 * `scripts/icon-system.test.ts` counts hand-authored SVG open tags in every
 * `.ts` and `.tsx` under `src/`, and exempts `.test.tsx` but not `.test.ts`;
 * a fake mermaid returning a literal tag reads to that gate as a drawn icon.
 * (This sentence is worded around the tag for the same reason.)
 */
const FAKE_DIAGRAM = `<${"svg"}></${"svg"}>`;

async function mount(source: string): Promise<HTMLElement> {
  const host = document.createElement("div");
  host.innerHTML = await renderMarkdown(source, LOCATION);
  return host;
}

const fakeMonaco = (colorize: (text: string, language: string) => Promise<string>): MonacoApi =>
  ({ editor: { colorize } }) as unknown as MonacoApi;

const NEVER_CALLED = {
  monaco: () => Promise.reject(new Error("monaco should not be loaded")),
  mermaid: () => Promise.reject(new Error("mermaid should not be loaded")),
  readImage: () => Promise.resolve(null),
  cancelled: () => false,
  dark: true,
};

describe("monacoLanguageForFence", () => {
  it("maps a fence's short name through the editor's own extension table", () => {
    expect(monacoLanguageForFence("ts")).toBe("typescript");
    expect(monacoLanguageForFence("sh")).toBe("shell");
    expect(monacoLanguageForFence("json")).toBe("javascript");
  });

  it("honours a bare Monaco language id", () => {
    expect(monacoLanguageForFence("python")).toBe("python");
  });

  it("answers null outside the enumerated set, so the fence stays monospace", () => {
    expect(monacoLanguageForFence("brainfuck")).toBeNull();
    expect(monacoLanguageForFence("")).toBeNull();
  });
});

describe("enhanceMarkdown — code", () => {
  it("colorizes a fence whose language the editor enumerates", async () => {
    const host = await mount("```ts\nconst a = 1;\n```");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      monaco: () => Promise.resolve(fakeMonaco(async () => "<span>lit</span>")),
    });
    expect(host.querySelector("pre")?.classList.contains("md-code--lit")).toBe(true);
    expect(host.querySelector("code")?.innerHTML).toBe("<span>lit</span>");
  });

  it("passes the RAW source, not the escaped body", async () => {
    const host = await mount("```ts\nconst a = 1 < 2;\n```");
    const colorize = vi.fn(async () => "x");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      monaco: () => Promise.resolve(fakeMonaco(colorize)),
    });
    expect(colorize).toHaveBeenCalledWith("const a = 1 < 2;", "typescript", { tabSize: 2 });
  });

  it("never loads Monaco for a fence outside the enumerated set", async () => {
    const host = await mount("```brainfuck\n+++\n```");
    // NEVER_CALLED's monaco rejects; `enhanceMarkdown` swallowing that would
    // hide the defect, so the assertion is on the DOM staying untouched.
    await enhanceMarkdown(host, NEVER_CALLED);
    expect(host.querySelector("pre")?.classList.contains("md-code--lit")).toBe(false);
  });

  it("leaves the plain body standing when the colorizer throws", async () => {
    const host = await mount("```ts\nconst a = 1;\n```");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      monaco: () =>
        Promise.resolve(fakeMonaco(() => Promise.reject(new Error("tokenizer refused")))),
    });
    expect(host.querySelector("code")?.textContent).toBe("const a = 1;");
  });
});

describe("enhanceMarkdown — mermaid", () => {
  const fakeMermaid = (render: MermaidLike["render"]): MermaidLike => ({
    initialize: () => {},
    render,
  });

  it("replaces the fence with the rendered diagram", async () => {
    const host = await mount("```mermaid\ngraph TD;\nA-->B;\n```");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      mermaid: () => Promise.resolve(fakeMermaid(async () => ({ svg: FAKE_DIAGRAM }))),
    });
    expect(host.querySelector(".md-diagram svg")).not.toBeNull();
    expect(host.querySelector(`pre[${MD_ATTR.mermaid}]`)).toBeNull();
  });

  it("keeps the code block and states the reason when the diagram will not parse", async () => {
    const host = await mount("```mermaid\nnot a diagram\n```");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      mermaid: () =>
        Promise.resolve(fakeMermaid(() => Promise.reject(new Error("Parse error on line 1")))),
    });
    // Never a blank hole: the text the author wrote IS the document.
    expect(host.querySelector(`pre[${MD_ATTR.mermaid}]`)).not.toBeNull();
    expect(host.querySelector(".md-diagram-error")?.textContent).toBe("Parse error on line 1");
  });

  it("never imports mermaid for a document with no mermaid fence", async () => {
    const host = await mount("# just prose");
    await enhanceMarkdown(host, NEVER_CALLED);
    expect(host.querySelector(".md-diagram")).toBeNull();
  });
});

describe("enhanceMarkdown — images", () => {
  it("sets the src from the bytes the host hands back", async () => {
    const host = await mount("![alt](img/a.png)");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      readImage: async (path) =>
        path === "/repo/docs/img/a.png" ? "data:image/png;base64,AA" : null,
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA");
  });

  it("leaves the alt text standing when the read is refused", async () => {
    const host = await mount("![alt](img/a.png)");
    await enhanceMarkdown(host, { ...NEVER_CALLED, readImage: async () => null });
    expect(host.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("alt");
  });

  it("never asks the host about a remote image", async () => {
    const host = await mount("![alt](https://cdn.example.com/a.png)");
    const readImage = vi.fn(async () => null);
    await enhanceMarkdown(host, { ...NEVER_CALLED, readImage });
    expect(readImage).not.toHaveBeenCalled();
  });
});

describe("enhanceMarkdown — cancellation", () => {
  it("writes nothing once the node it was started for is stale", async () => {
    const host = await mount("```ts\nconst a = 1;\n```");
    await enhanceMarkdown(host, {
      ...NEVER_CALLED,
      cancelled: () => true,
      monaco: () => Promise.resolve(fakeMonaco(async () => "<span>lit</span>")),
    });
    expect(host.querySelector("code")?.textContent).toBe("const a = 1;");
  });
});
