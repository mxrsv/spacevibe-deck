/**
 * The rendered view's security and routing policy, as pure functions
 * (design 2026-08-23 §6).
 *
 * Every decision this feature makes about a link, an image or a raw HTML run
 * is taken HERE, with no DOM, no `marked` and no host, so the whole policy is
 * assertable as a table. `markdown-render.ts` is the only caller; it turns
 * these answers into markup and never re-decides one.
 *
 * The policy exists so the feature needs **no CSP**: adding one later
 * invalidates the packaged Monaco smoke and forces a rerun, which is an owner
 * decision rather than a footnote. Nothing here may grow a rule that only a
 * CSP would enforce.
 */

/** Extensions that open in the rendered view. `.mdx` is deliberately absent —
 * its JSX renders as broken prose, so source is the honest default. */
export const RENDERED_EXTENSIONS: readonly string[] = [".md", ".markdown"];

/** Extensions the toggle is offered on at all. `.mdx` opens as source and can
 * still be flipped: the rendered picture of an MDX file is wrong, not
 * forbidden. */
export const MARKDOWN_EXTENSIONS: readonly string[] = [...RENDERED_EXTENSIONS, ".mdx"];

/** Which of the surface's two views a file tab is showing. */
export type ViewMode = "rendered" | "source";

function hasExtension(filePath: string, extensions: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

/** Whether the rendered view is available for this path at all. */
export function isMarkdownPath(filePath: string): boolean {
  return hasExtension(filePath, MARKDOWN_EXTENSIONS);
}

/**
 * The view a freshly opened tab lands on (design §1).
 *
 * Reading is the common gesture in the loop this serves — "read what the agent
 * changed" — so it costs zero clicks, except on `.mdx`, where the rendered
 * picture would be a lie.
 */
export function defaultViewMode(filePath: string): ViewMode {
  return hasExtension(filePath, RENDERED_EXTENSIONS) ? "rendered" : "source";
}

/**
 * HTML-escape, for both attribute and text position.
 *
 * `"` and `'` are included because the same function fills attribute values;
 * splitting text-escaping from attribute-escaping is how one of the two ends
 * up applied in the wrong place.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Schemes handed to the OS through `shell_open_url`, which enforces its own
 * copy of this list — the renderer is not the trust boundary. */
const EXTERNAL_SCHEMES: readonly string[] = ["http:", "https:", "mailto:", "tel:"];

/** A leading `scheme:` if the reference declares one, lowercased. */
function schemeOf(reference: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(reference.trim());
  return match === null ? null : `${match[1].toLowerCase()}:`;
}

/** Where a document sits, and what counts as inside for it. */
export interface MarkdownLocation {
  /** Absolute path of the markdown file being rendered. */
  readonly docPath: string;
  /** The workspace root that holds it, spelled as the renderer holds it. */
  readonly workspaceRoot: string;
}

export type LinkTarget =
  /** Rendered as plain text: it goes nowhere and says so by not being a link. */
  | { readonly kind: "dead" }
  /** Handed to the OS through the existing external-open path. */
  | { readonly kind: "external"; readonly url: string }
  /** Opened in Deck's own editor, through the same routing ⌘+click uses. */
  | { readonly kind: "workspace"; readonly path: string }
  /** A `#heading` jump inside the document itself. */
  | { readonly kind: "anchor"; readonly id: string };

/** The separator this path is spelled with. Windows paths reach the renderer
 * as opaque strings, so both are honoured — the same reason `path-name.ts`
 * exists at all. */
function separatorOf(filePath: string): string {
  return filePath.includes("\\") && !filePath.includes("/") ? "\\" : "/";
}

function splitSegments(filePath: string): string[] {
  return filePath.split(/[/\\]+/);
}

/**
 * Resolve `reference` against `docPath`'s directory and collapse `.` / `..`.
 *
 * Pure string work: `node:path` is not available in the renderer, and the
 * answer is only ever a CANDIDATE — containment is decided by
 * `isInsideRoot` below and, for anything that is actually read or opened, a
 * second time in the main process by the guard that owns it.
 */
export function resolveRelativePath(docPath: string, reference: string): string {
  const separator = separatorOf(docPath);
  const directory = splitSegments(docPath).slice(0, -1);
  const rooted = reference.startsWith("/") || reference.startsWith("\\");
  const base = rooted ? [directory[0] ?? ""] : directory;
  const out: string[] = [...base];
  for (const segment of splitSegments(reference)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Never past the drive/root segment: `out[0]` is `""` for a POSIX
      // absolute path (the leading empty split) or `C:` on Windows.
      if (out.length > 1) {
        out.pop();
      }
      continue;
    }
    out.push(segment);
  }
  return out.join(separator);
}

/**
 * Segment-wise containment, never `startsWith` — which accepts `/repo-backup`
 * for a root of `/repo`. Case is honoured as written: the renderer does not
 * know whether the volume folds case, and the main-process guard answers that
 * for everything actually read.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rootSegments = splitSegments(root).filter(
    (segment, index) => segment !== "" || index === 0,
  );
  const candidateSegments = splitSegments(candidate).filter(
    (segment, index) => segment !== "" || index === 0,
  );
  if (candidateSegments.length <= rootSegments.length) {
    return false;
  }
  return rootSegments.every((segment, index) => candidateSegments[index] === segment);
}

/** A trailing `#fragment`, split off before the path is resolved. */
function splitFragment(reference: string): { path: string; fragment: string | null } {
  const hash = reference.indexOf("#");
  if (hash === -1) {
    return { path: reference, fragment: null };
  }
  return { path: reference.slice(0, hash), fragment: reference.slice(hash + 1) };
}

/**
 * What a link in the document does (design §6).
 *
 * `javascript:` and `data:` are dead — plain text, not a link. So is any other
 * scheme Deck does not hand to the OS, and so is a relative path that resolves
 * outside the workspace root. Nothing here ever navigates in place.
 */
export function classifyLink(href: string, location: MarkdownLocation): LinkTarget {
  const reference = href.trim();
  if (reference === "") {
    return { kind: "dead" };
  }
  if (reference.startsWith("#")) {
    return { kind: "anchor", id: reference.slice(1) };
  }
  const scheme = schemeOf(reference);
  if (scheme !== null) {
    // Everything with a scheme is decided here and never falls through to the
    // relative branch: `file:`, `vbscript:`, `javascript:` and an unknown
    // custom scheme all land on the same answer.
    return EXTERNAL_SCHEMES.includes(scheme)
      ? { kind: "external", url: reference }
      : { kind: "dead" };
  }
  const { path } = splitFragment(reference);
  if (path === "") {
    return { kind: "dead" };
  }
  const resolved = resolveRelativePath(location.docPath, path);
  if (!isInsideRoot(location.workspaceRoot, resolved)) {
    return { kind: "dead" };
  }
  return { kind: "workspace", path: resolved };
}

export type ImageTarget =
  /** Read through the host and shown; the path is a CANDIDATE until main
   * agrees it is inside the root. */
  | { readonly kind: "local"; readonly path: string }
  /** A labelled placeholder. The rendered view performs no network fetch, ever. */
  | { readonly kind: "remote"; readonly url: string }
  /** Nothing is drawn but the alt text. */
  | { readonly kind: "dead" };

/** Extensions `read_image_as_data_url` will encode. Mirrored from
 * `electron/images.ts`'s `mimeFor`; anything else is dead rather than a
 * request main is going to refuse. */
const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico"];

/**
 * What an `![]()` in the document draws (design §6).
 *
 * Local-only. A remote URL is a labelled placeholder rather than a fetch,
 * which is the rule that keeps this surface off the network entirely.
 */
export function classifyImage(source: string, location: MarkdownLocation): ImageTarget {
  const reference = source.trim();
  if (reference === "") {
    return { kind: "dead" };
  }
  const scheme = schemeOf(reference);
  if (scheme === "http:" || scheme === "https:") {
    return { kind: "remote", url: reference };
  }
  if (scheme !== null) {
    // `data:` included: an inline image is not a fetch, but it is also not
    // something an agent writes into a doc, and allowing one payload scheme
    // starts the allowlist this policy exists to avoid.
    return { kind: "dead" };
  }
  const { path } = splitFragment(reference);
  const resolved = resolveRelativePath(location.docPath, path);
  if (!isInsideRoot(location.workspaceRoot, resolved)) {
    return { kind: "dead" };
  }
  if (!hasExtension(resolved, IMAGE_EXTENSIONS)) {
    return { kind: "dead" };
  }
  return { kind: "local", path: resolved };
}
