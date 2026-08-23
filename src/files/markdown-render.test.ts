/**
 * The parse half, asserted as strings.
 *
 * No jsdom, no Monaco, no mermaid: `renderMarkdown` is synchronous once
 * `marked` has landed, and everything it cannot do yet is a placeholder these
 * tests read directly. That is the whole point of the two-pass shape — the
 * §6 policy is provable without mounting anything.
 */
import { describe, expect, it } from "vitest";
import { MD_ATTR, renderMarkdown, slugify } from "./markdown-render";

const LOCATION = {
  docPath: "/repo/docs/guide.md",
  workspaceRoot: "/repo",
};

const render = (source: string): Promise<string> => renderMarkdown(source, LOCATION);

describe("renderMarkdown — raw HTML", () => {
  it("escapes a block-level HTML run and shows it verbatim", async () => {
    const html = await render('<div class="x">hi</div>');
    expect(html).toContain("&lt;div class=&quot;x&quot;&gt;");
    expect(html).not.toContain("<div class=");
  });

  it("escapes an inline tag", async () => {
    const html = await render("text <b>bold</b> more");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("escapes a script tag rather than dropping it", async () => {
    const html = await render("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderMarkdown — links", () => {
  it("never emits an href, so nothing can navigate in place", async () => {
    const html = await render("[a](https://example.com)");
    // A BARE `href=`, not `data-md-href=` — the whole point is that Chromium
    // has nothing to follow.
    expect(html).not.toMatch(/\shref=/);
    expect(html).toContain(`${MD_ATTR.target}="external"`);
    expect(html).toContain(`${MD_ATTR.href}="https://example.com"`);
  });

  it("draws a javascript: link as plain text", async () => {
    const html = await render("[click](javascript:alert(1))");
    expect(html).toContain("md-link--dead");
    expect(html).not.toContain(MD_ATTR.target);
    expect(html).toContain("click");
  });

  it("marks an in-workspace relative link for Deck's own editor", async () => {
    const html = await render("[app](../src/app.ts)");
    expect(html).toContain(`${MD_ATTR.target}="workspace"`);
    expect(html).toContain(`${MD_ATTR.href}="/repo/src/app.ts"`);
  });

  it("kills a link resolving outside the root", async () => {
    const html = await render("[x](../../etc/passwd)");
    expect(html).toContain("md-link--dead");
  });
});

describe("renderMarkdown — images", () => {
  it("leaves a local image with no src for the enhancement pass", async () => {
    const html = await render("![alt](img/a.png)");
    expect(html).toContain(`${MD_ATTR.image}="/repo/docs/img/a.png"`);
    expect(html).not.toContain("src=");
  });

  it("places a remote image rather than fetching it", async () => {
    const html = await render("![alt](https://cdn.example.com/a.png)");
    expect(html).toContain("md-image-remote");
    expect(html).not.toContain("<img");
  });
});

describe("renderMarkdown — code", () => {
  it("carries the fence's language and raw source on the placeholder", async () => {
    const html = await render("```ts\nconst a = 1;\n```");
    expect(html).toContain(`${MD_ATTR.lang}="ts"`);
    expect(html).toContain(`${MD_ATTR.source}="const a = 1;"`);
  });

  it("takes only the first word of an info string", async () => {
    const html = await render("```ts title=x\nconst a = 1;\n```");
    expect(html).toContain(`${MD_ATTR.lang}="ts"`);
  });

  it("marks a mermaid fence and carries no language", async () => {
    const html = await render("```mermaid\ngraph TD;\nA-->B;\n```");
    expect(html).toContain(MD_ATTR.mermaid);
    expect(html).not.toContain(MD_ATTR.lang);
  });

  it("escapes the fence body, so markup in a fence stays a fence", async () => {
    const html = await render("```\n<script>x</script>\n```");
    expect(html).not.toContain("<script");
  });

  it("leaves an unlabelled fence with no language attribute", async () => {
    const html = await render("```\nplain\n```");
    expect(html).not.toContain(MD_ATTR.lang);
    expect(html).toContain("md-code");
  });
});

describe("renderMarkdown — GFM", () => {
  it("wraps a table in its own scroll container", async () => {
    const html = await render("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("md-table-scroll");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("honours a column alignment", async () => {
    const html = await render("| a |\n| ---: |\n| 1 |");
    expect(html).toContain('style="text-align:right"');
  });

  it("draws a task list as inert pictures, never an input", async () => {
    const html = await render("- [x] done\n- [ ] todo");
    expect(html).not.toContain("<input");
    expect(html).toContain("md-check--on");
    expect(html).toContain('class="md-check"');
  });
});

describe("renderMarkdown — headings", () => {
  it("gives each heading a slug for in-document jumps", async () => {
    const html = await render("## Section One");
    expect(html).toContain('id="section-one"');
  });
});

describe("slugify", () => {
  it("lowercases, drops punctuation and joins with hyphens", () => {
    expect(slugify("The Rendered View!")).toBe("the-rendered-view");
  });
});
