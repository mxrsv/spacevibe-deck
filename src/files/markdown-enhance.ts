/**
 * The second pass: everything `markdown-render.ts` could only leave a
 * placeholder for (design 2026-08-23 §5).
 *
 * Three jobs, each independent and each allowed to fail on its own:
 *
 *  - **fenced code** is tokenized by Monaco's own colorizer against the
 *    enumerated `EDITOR_LANGUAGES` set. No new dependency and no new cost:
 *    opening a `.md` already lazy-loads Monaco today, and the toggle's source
 *    mode needs it anyway. A language outside the set keeps the plain
 *    monospace body the parse already wrote.
 *  - **mermaid** is imported ONLY when the rendered document actually holds a
 *    ` ```mermaid ` fence, so most documents never pay for it. A diagram that
 *    fails to parse keeps its code block and gains the error beneath it —
 *    never a blank hole.
 *  - **local images** are read through the host and set as data URLs. The
 *    rendered view performs no network fetch, ever: a remote URL never reaches
 *    here, because `classifyImage` already turned it into a placeholder.
 *
 * Every pass takes an `AbortSignal`-shaped `cancelled()` because all three are
 * async against a node the view may have re-rendered underneath them — a
 * debounced re-render of a file an agent is streaming does exactly that.
 */
import { EDITOR_LANGUAGES, languageForPath, loadMonaco, type MonacoApi } from "./editor-host";
import { MD_ATTR } from "./markdown-render";

/** Monaco language ids that `colorize` can actually tokenize — the enumerated
 * set, not "every language". */
const COLORIZABLE: ReadonlySet<string> = new Set(EDITOR_LANGUAGES.map((language) => language.id));

/**
 * A fence's language mapped onto a Monaco id.
 *
 * The fence says `ts` / `tsx` / `sh`, and `languageForPath` already knows which
 * extension belongs to which language — so the mapping is "pretend it is a
 * file named `x.<lang>`" rather than a second table that would drift from the
 * editor's own. A bare id that IS a Monaco language (`typescript`, `python`)
 * is honoured directly.
 */
export function monacoLanguageForFence(language: string): string | null {
  const lower = language.toLowerCase();
  if (lower === "") {
    return null;
  }
  if (COLORIZABLE.has(lower)) {
    return lower;
  }
  return languageForPath(`fence.${lower}`);
}

/** Seams, so every pass is drivable without Monaco, mermaid or a host. */
export interface EnhanceDeps {
  /** True once the node this pass was started for is stale. */
  readonly cancelled: () => boolean;
  /** Defaults to the shared `loadMonaco()`. */
  readonly monaco?: () => Promise<MonacoApi>;
  /** Defaults to the dynamic `mermaid` import. */
  readonly mermaid?: () => Promise<MermaidLike>;
  /** Reads one local image as a data URL, or null when it cannot be shown. */
  readonly readImage: (path: string) => Promise<string | null>;
  /** `deck-light` or `deck-dark`, for the diagram's own palette. */
  readonly dark: boolean;
}

/** The slice of mermaid's API this module uses. */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

let mermaidLoading: Promise<MermaidLike> | null = null;

/** Load mermaid once. A failed load is not cached, matching `loadMarked` and
 * `loadMonaco` — retrying is the only recovery a running app has. */
function loadMermaid(): Promise<MermaidLike> {
  if (mermaidLoading !== null) {
    return mermaidLoading;
  }
  const attempt = import("mermaid").then((module) => module.default as unknown as MermaidLike);
  mermaidLoading = attempt.catch((error: unknown) => {
    mermaidLoading = null;
    throw error;
  });
  return mermaidLoading;
}

/**
 * Colorize every fenced block that named a language Monaco knows.
 *
 * `colorizeElement` is deliberately NOT used: it reads the language off a
 * `data-lang` attribute of Monaco's own choosing and writes back into the
 * element it was given, which would fight the placeholder markup. `colorize`
 * takes text and gives back HTML, which is exactly the shape this needs.
 */
async function colorizeFences(root: ParentNode, deps: EnhanceDeps): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(`pre[${MD_ATTR.lang}]`)];
  const targets = blocks
    .map((block) => ({
      block,
      language: monacoLanguageForFence(block.getAttribute(MD_ATTR.lang) ?? ""),
    }))
    .filter((entry): entry is { block: HTMLElement; language: string } => entry.language !== null);
  if (targets.length === 0) {
    return;
  }
  const monaco = await (deps.monaco ?? loadMonaco)();
  if (deps.cancelled()) {
    return;
  }
  for (const { block, language } of targets) {
    const code = block.querySelector("code");
    const source = block.getAttribute(MD_ATTR.source) ?? "";
    if (code === null) {
      continue;
    }
    try {
      // `tabSize` matches the editor's own, so a tab-indented fence lines up
      // with what source mode shows for the same file.
      const html = await monaco.editor.colorize(source, language, { tabSize: 2 });
      if (deps.cancelled()) {
        return;
      }
      code.innerHTML = html;
      block.classList.add("md-code--lit");
    } catch {
      // The plain monospace body the parse wrote is already correct; a
      // tokenizer that refused this text is not worth a message.
    }
  }
}

/** Mermaid's theme variables, taken from the resolved Deck theme rather than
 * from one of mermaid's own presets — a diagram in a Deck document is chrome,
 * and DL binds it. The values are CSS custom properties, resolved by the
 * browser at paint, so a theme switch reaches a diagram already on screen. */
function mermaidConfig(dark: boolean): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "var(--ui-font)",
    themeVariables: {
      darkMode: dark,
      background: "var(--bg)",
      primaryColor: "var(--chrome-1)",
      primaryTextColor: "var(--text-primary)",
      primaryBorderColor: "var(--hair-strong)",
      secondaryColor: "var(--chrome-2)",
      tertiaryColor: "var(--chrome-1)",
      lineColor: "var(--text-faint)",
      textColor: "var(--text-primary)",
      mainBkg: "var(--chrome-1)",
      nodeBorder: "var(--hair-strong)",
      clusterBkg: "var(--chrome-2)",
      clusterBorder: "var(--hair)",
      titleColor: "var(--text-primary)",
      edgeLabelBackground: "var(--chrome-2)",
    },
  };
}

/** A DOM id per diagram. Mermaid injects a temporary node keyed by this and
 * throws when two renders share one, so the counter is module-scoped rather
 * than per pass. */
let diagramSequence = 0;

/**
 * Render every mermaid fence, or leave it as a code block with the reason.
 *
 * The fallback is the whole point: a diagram Deck cannot draw must still show
 * the text the author wrote, because that text is the document.
 */
async function renderDiagrams(root: ParentNode, deps: EnhanceDeps): Promise<void> {
  const fences = [...root.querySelectorAll<HTMLElement>(`pre[${MD_ATTR.mermaid}]`)];
  if (fences.length === 0) {
    return;
  }
  let mermaid: MermaidLike;
  try {
    mermaid = await (deps.mermaid ?? loadMermaid)();
  } catch {
    // No mermaid, so every fence stays the code block it already is.
    return;
  }
  if (deps.cancelled()) {
    return;
  }
  mermaid.initialize(mermaidConfig(deps.dark));
  for (const fence of fences) {
    const source = fence.getAttribute(MD_ATTR.source) ?? "";
    diagramSequence += 1;
    try {
      const { svg } = await mermaid.render(`md-mermaid-${diagramSequence}`, source);
      if (deps.cancelled()) {
        return;
      }
      const figure = fence.ownerDocument.createElement("div");
      figure.className = "md-diagram";
      figure.innerHTML = svg;
      fence.replaceWith(figure);
    } catch (error: unknown) {
      if (deps.cancelled()) {
        return;
      }
      const note = fence.ownerDocument.createElement("p");
      note.className = "md-diagram-error";
      note.setAttribute("role", "status");
      note.textContent = error instanceof Error ? error.message : String(error);
      fence.after(note);
    }
  }
}

/** Fill in every local image. A read that fails leaves the alt text standing,
 * which is what an `<img>` with no `src` already shows. */
async function loadImages(root: ParentNode, deps: EnhanceDeps): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>(`img[${MD_ATTR.image}]`)];
  for (const image of images) {
    const path = image.getAttribute(MD_ATTR.image) ?? "";
    const dataUrl = await deps.readImage(path);
    if (deps.cancelled()) {
      return;
    }
    if (dataUrl !== null) {
      image.src = dataUrl;
    }
  }
}

/**
 * Run all three passes over one rendered document.
 *
 * They run CONCURRENTLY and each catches its own failure: a mermaid import
 * that 404s must not leave the code blocks uncolored, and a slow image read
 * must not hold the diagram back.
 */
export async function enhanceMarkdown(root: ParentNode, deps: EnhanceDeps): Promise<void> {
  await Promise.all([
    colorizeFences(root, deps).catch(() => {}),
    renderDiagrams(root, deps).catch(() => {}),
    loadImages(root, deps).catch(() => {}),
  ]);
}
