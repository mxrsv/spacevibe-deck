/**
 * Markdown → HTML, with the §6 policy applied (design 2026-08-23 §5).
 *
 * Synchronous and pure. Everything that needs a DOM, a network of its own or
 * a second library — Monaco's colorizer, mermaid, the image read — is left as
 * a PLACEHOLDER carrying `data-md-*` attributes, and
 * `markdown-enhance.ts` fills those in against the mounted node afterwards.
 * Two consequences, both deliberate:
 *
 *  - the whole policy is assertable as strings, with no jsdom and no Monaco;
 *  - the first paint happens on the parse, not after two async round trips,
 *    which is what makes a debounced re-render of a file an agent is streaming
 *    cheap enough to do at all.
 *
 * `marked` is imported dynamically for the reason `editor-host.ts` states for
 * Monaco: nothing markdown-shaped may enter the entry chunk, and app startup
 * is unchanged for a user who never opens a markdown file.
 */
import { classifyImage, classifyLink, escapeHtml, type MarkdownLocation } from "./markdown-policy";

/** The subset of `marked` this module uses, structural so nothing here has to
 * import the library's types at module scope. */
type MarkedModule = typeof import("marked");

/** Attribute names the enhancement pass looks for. One spelling, one place —
 * a placeholder written here and read there under two names is a silent hole
 * where the code block never colorizes. */
export const MD_ATTR = {
  /** On a `<pre>`: the fence's language, already lowercased. */
  lang: "data-md-lang",
  /** On a `<pre>`: the fence's raw text, for the colorizer and for mermaid. */
  source: "data-md-source",
  /** On a `<pre>`: present when the fence is a mermaid diagram. */
  mermaid: "data-md-mermaid",
  /** On an `<img>`: the absolute path to read through the host. */
  image: "data-md-image",
  /** On an `<a>`: what activating it does — `external` | `workspace`. */
  target: "data-md-target",
  /** On an `<a>`: the URL or absolute path the target needs. */
  href: "data-md-href",
} as const;

/** The fence language that means a diagram rather than code. */
export const MERMAID_LANG = "mermaid";

/** First word of an info string: ```` ```ts title=x ```` is `ts`. */
function fenceLanguage(info: string | undefined): string {
  return (info ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

let loading: Promise<MarkedModule> | null = null;

/**
 * Load `marked` once.
 *
 * The promise is cached and a FAILED load is not, matching `loadMonaco`: a
 * transient chunk-fetch failure must not poison every later attempt, because
 * retrying is the only recovery a running app has.
 */
export function loadMarked(): Promise<MarkedModule> {
  if (loading !== null) {
    return loading;
  }
  const attempt = import("marked");
  loading = attempt.catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Deck's renderer overrides — the §6 policy, expressed as markup.
 *
 * Written as a factory over the location rather than as a module constant
 * because every rule in it is relative to the document being rendered: the
 * same `../assets/x.png` is inside one workspace and outside another.
 */
function rendererFor(location: MarkdownLocation): Record<string, unknown> {
  return {
    /**
     * Raw HTML is ESCAPED and shown verbatim, block and inline (design §6).
     *
     * Not sanitized-and-allowed: escaping needs no allowlist to maintain and
     * no sanitizer dependency, and the corpus this serves — agent-written
     * docs — loses nothing. `<div>` in a doc becomes the four characters the
     * author typed, which is also the more useful answer when the doc is
     * ABOUT html.
     */
    html({ text }: { text: string }): string {
      return `<span class="md-raw">${escapeHtml(text)}</span>`;
    },

    /**
     * A fenced block becomes a placeholder. `data-md-source` carries the raw
     * text so the enhancement pass does not have to un-escape the body it
     * finds in the DOM; the escaped body is what shows until it runs, and is
     * what stays for a language outside the enumerated set — plain monospace,
     * the same legible outcome the editor gives it.
     */
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = fenceLanguage(lang);
      const source = escapeHtml(text);
      if (language === MERMAID_LANG) {
        return `<pre class="md-code md-code--mermaid" ${MD_ATTR.mermaid}="" ${MD_ATTR.source}="${source}"><code>${source}</code></pre>`;
      }
      const languageAttribute = language === "" ? "" : ` ${MD_ATTR.lang}="${escapeHtml(language)}"`;
      return `<pre class="md-code"${languageAttribute} ${MD_ATTR.source}="${source}"><code>${source}</code></pre>`;
    },

    /**
     * A link carries its decision in `data-md-target` and its destination in
     * `data-md-href`, and NEVER in `href`.
     *
     * A real `href` is what makes in-place navigation possible at all: a stray
     * click Deck's delegated handler did not intercept would replace the
     * renderer's own document with the target. There is no `href` to follow
     * here, so there is nothing to intercept — which is the same reason a dead
     * link is a `<span>` rather than an `<a>` with the handler removed.
     */
    link(token: { href: string; title?: string | null; tokens: unknown[] }): string {
      const inner = parseInlineWith(
        this as { parser: { parseInline(tokens: unknown[]): string } },
        token.tokens,
      );
      const target = classifyLink(token.href, location);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      switch (target.kind) {
        case "dead":
          return `<span class="md-link md-link--dead"${title}>${inner}</span>`;
        case "anchor":
          return `<a class="md-link" ${MD_ATTR.target}="anchor" ${MD_ATTR.href}="${escapeHtml(target.id)}"${title}>${inner}</a>`;
        case "external":
          return `<a class="md-link" ${MD_ATTR.target}="external" ${MD_ATTR.href}="${escapeHtml(target.url)}"${title}>${inner}</a>`;
        case "workspace":
          return `<a class="md-link" ${MD_ATTR.target}="workspace" ${MD_ATTR.href}="${escapeHtml(target.path)}"${title}>${inner}</a>`;
      }
    },

    /**
     * A local image is an `<img>` with NO `src` — the enhancement pass sets
     * one from the bytes main hands back. An empty `src` would make Chromium
     * re-request the page itself, so the attribute is simply absent.
     */
    image(token: { href: string; text: string }): string {
      const alt = escapeHtml(token.text ?? "");
      const target = classifyImage(token.href, location);
      switch (target.kind) {
        case "local":
          return `<img class="md-image" alt="${alt}" ${MD_ATTR.image}="${escapeHtml(target.path)}">`;
        case "remote":
          return `<span class="md-image-remote" role="img" aria-label="${alt}">Remote image not loaded — ${escapeHtml(target.url)}</span>`;
        case "dead":
          return `<span class="md-image-remote" role="img" aria-label="${alt}">Image unavailable</span>`;
      }
    },

    /**
     * A task-list checkbox is an inert picture (design §5): the rendered view
     * is read-only, and a checkbox that writes to the file is a different
     * feature. Drawn as a span rather than a `disabled` input so nothing about
     * it invites a click.
     */
    checkbox({ checked }: { checked: boolean }): string {
      return `<span class="md-check${checked ? " md-check--on" : ""}" aria-hidden="true"></span>`;
    },

    /**
     * A heading gets a slug so the `#fragment` links classified as `anchor`
     * above have something to reach.
     */
    heading(token: { tokens: unknown[]; depth: number }): string {
      const inner = parseInlineWith(
        this as { parser: { parseInline(tokens: unknown[]): string } },
        token.tokens,
      );
      const id = slugify(inner.replace(/<[^>]*>/g, ""));
      return `<h${token.depth} id="${escapeHtml(id)}">${inner}</h${token.depth}>`;
    },

    /** Tables run wider than the prose column, so each one owns a scroll box
     * (design §8). The wrapper is the renderer's job, not the stylesheet's:
     * `overflow-x` on the table itself does nothing. */
    table(token: { header: unknown[]; rows: unknown[][] }): string {
      const renderer = this as unknown as {
        parser: { parseInline(tokens: unknown[]): string };
      };
      const cell = (item: { tokens: unknown[]; align?: string | null }, tag: string): string => {
        const align = item.align ? ` style="text-align:${escapeHtml(item.align)}"` : "";
        return `<${tag}${align}>${parseInlineWith(renderer, item.tokens)}</${tag}>`;
      };
      const head = token.header
        .map((item) => cell(item as { tokens: unknown[]; align?: string | null }, "th"))
        .join("");
      const body = token.rows
        .map(
          (row) =>
            `<tr>${row
              .map((item) => cell(item as { tokens: unknown[]; align?: string | null }, "td"))
              .join("")}</tr>`,
        )
        .join("");
      return `<div class="md-table-scroll"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
  };
}

/** `this.parser.parseInline` with the null-safety marked's own renderer takes
 * for granted; a renderer override is called with `this` bound to the
 * renderer instance, and a test double may not carry a parser at all. */
function parseInlineWith(
  renderer: { parser?: { parseInline(tokens: unknown[]): string } },
  tokens: unknown[],
): string {
  return renderer.parser?.parseInline(tokens) ?? "";
}

/** GitHub's heading-slug rule, near enough for in-document jumps. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/**
 * Render `source` as the document at `location`.
 *
 * Async only because `marked` arrives through a dynamic import — the parse
 * itself is synchronous, and nothing here awaits a host or a network.
 */
export async function renderMarkdown(source: string, location: MarkdownLocation): Promise<string> {
  const { Marked } = await loadMarked();
  const marked = new Marked({
    gfm: true,
    breaks: false,
    // `false` is the default and is restated because it is load-bearing:
    // marked's `pedantic` mode routes around the renderer overrides above.
    pedantic: false,
    renderer: rendererFor(location) as never,
  });
  return marked.parse(source, { async: false }) as string;
}
