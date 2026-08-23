/**
 * The rendered document (design 2026-08-23 §1).
 *
 * A read-only picture of the buffer AS IT CURRENTLY IS — saved or dirty. The
 * input is `documentFor(path).text`, never the disk, which is what makes the
 * external-change path free: the watcher reloads the buffer and this
 * re-renders, with no second file read and no second staleness rule to keep in
 * step with the editor's.
 *
 * Imperative, like `FileEditor` beside it: the HTML is written into a ref'd
 * node and then walked by `enhanceMarkdown`. Preact's
 * `dangerouslySetInnerHTML` would work for the write, but the enhancement pass
 * mutates the same subtree afterwards (colorized code, a diagram replacing its
 * fence, an image gaining a `src`), and a VDOM that believes it owns those
 * children would undo that work on the next render.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { baseName } from "../../lib/path-name";
import { requestPathOpen } from "../../chrome/events";
import { openUrl } from "../../host/shell-host";
import { settings } from "../../settings/settings-store";
import { themeModeOf } from "../../settings/themes";
import { documentFor } from "../file-surface-store";
import { enhanceMarkdown } from "../markdown-enhance";
import { defaultMarkdownImageSource, type MarkdownImageSource } from "../markdown-image-source";
import { MD_ATTR, renderMarkdown } from "../markdown-render";
import { ExternalChangeBar } from "./external-change-bar";
import type { FileSurfaceController } from "../file-surface-controller";

/**
 * How long the buffer must hold still before it is re-parsed.
 *
 * An agent streaming a file writes it many times a second; parsing and
 * re-laying-out a long document on each write is what this exists to prevent
 * (design §5). Short enough that a save feels immediate.
 */
export const RENDER_DEBOUNCE_MS = 150;

export interface MarkdownViewProps {
  readonly path: string;
  readonly controller: FileSurfaceController;
  /** Test seam — the host-backed reader otherwise. */
  readonly images?: MarkdownImageSource;
}

export function MarkdownView(props: MarkdownViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const document = documentFor(props.path);
  const text = document?.text ?? "";
  const workspaceRoot = document?.workspacePath ?? "";
  /**
   * Bumped by the debounce timer; the render effect below is keyed on it
   * rather than on `text` directly.
   *
   * The two-step is what makes the debounce real: keying the effect on `text`
   * would run it on every keystroke and merely delay the AWAIT inside it,
   * leaving one parse in flight per edit and their completions racing.
   *
   * `useState` rather than `useSignal`: the counter is component-local and the
   * updater form is what keeps the debounce effect from having to depend on
   * its own output.
   */
  const [generation, setGeneration] = useState(0);
  const settledText = useRef<string>("");
  const dark = themeModeOf(settings.value) === "dark";
  const images = props.images ?? defaultMarkdownImageSource;

  // Hold the buffer still for one debounce window, then let the render effect
  // run. The FIRST content to arrive renders immediately — a cold open must
  // not sit blank for 150ms waiting for a change that already happened.
  useEffect(() => {
    if (settledText.current === text) {
      return;
    }
    const first = settledText.current === "";
    const commit = (): void => {
      settledText.current = text;
      setGeneration((previous) => previous + 1);
    };
    if (first) {
      commit();
      return;
    }
    const timer = setTimeout(commit, RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // Parse, write, enhance. `stale` covers all three: `renderMarkdown` awaits a
  // dynamic import and `enhanceMarkdown` awaits Monaco, mermaid and a host, so
  // any of them can resolve after this node has been re-rendered or unmounted.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let stale = false;
    void (async () => {
      try {
        const html = await renderMarkdown(settledText.current, {
          docPath: props.path,
          workspaceRoot,
        });
        if (stale || hostRef.current === null) {
          return;
        }
        host.innerHTML = html;
        await enhanceMarkdown(host, {
          cancelled: () => stale,
          dark,
          readImage: (imagePath) => images.read(imagePath, workspaceRoot),
        });
      } catch (error: unknown) {
        // Surfaced rather than swallowed, for the reason `FileEditor` states
        // about Monaco: a chunk that 404s under `file://` would otherwise be a
        // blank rectangle with nothing to search for.
        console.error("Deck: the document could not be rendered", error);
      }
    })();
    return () => {
      stale = true;
    };
  }, [props.path, generation, workspaceRoot, dark, images]);

  /**
   * The rendered document claims the surface's focus seam while it is mounted.
   *
   * `setEditorFocus` is the registration `FileEditor` uses for Monaco; the
   * seam is "the mounted surface's focus", not "Monaco's". Without this,
   * `surfaces.focus()` — which ⌘⇧B and the dock's own toggles call to hand the
   * caret back to the stage — would reach a null the moment a document is
   * showing rendered, and the keyboard would be stranded in the chrome.
   */
  useEffect(() => {
    props.controller.setEditorFocus(() => hostRef.current?.focus());
    return () => props.controller.setEditorFocus(null);
  }, [props.controller]);

  /**
   * One delegated handler for every link in the document (design §6).
   *
   * Delegated rather than per-anchor because the anchors are innerHTML, not
   * VDOM — there is nowhere to hang a prop. Nothing here has an `href`, so
   * there is no default navigation to prevent: an anchor Deck did not
   * recognise simply does nothing, which is the fail-closed direction.
   */
  const onClick = (event: MouseEvent): void => {
    const anchor = (event.target as Element | null)?.closest?.(`a[${MD_ATTR.target}]`);
    if (anchor === null || anchor === undefined) {
      return;
    }
    const target = anchor.getAttribute(MD_ATTR.target);
    const href = anchor.getAttribute(MD_ATTR.href) ?? "";
    if (href === "") {
      return;
    }
    if (target === "external") {
      // The same path an OSC 8 hyperlink takes, which re-validates the scheme
      // in main — the renderer is not the trust boundary.
      void openUrl(href).catch(() => {});
      return;
    }
    if (target === "workspace") {
      // The same request a ⌘+click on an agent-printed path raises, so a
      // relative link lands in Deck's own editor through `App`'s single
      // routing decision rather than a second copy of it here.
      requestPathOpen({ path: href, line: null, column: null });
      return;
    }
    if (target === "anchor") {
      hostRef.current?.querySelector(`[id="${CSS.escape(href)}"]`)?.scrollIntoView({
        block: "start",
      });
    }
  };

  if (document === undefined) {
    return null;
  }

  return (
    <div class="fileview fileview--rendered">
      <ExternalChangeBar
        prompt={document.prompt}
        fileName={baseName(props.path)}
        onResolve={(resolution) => void props.controller.resolve(props.path, resolution)}
      />
      {document.gone && document.prompt === null && (
        <div class="filebar filebar--quiet" role="status">
          <span class="filebar__text">
            {baseName(props.path)} was deleted on disk. This is the last content Deck read.
          </span>
        </div>
      )}
      {/* `tabIndex` so the document can take focus and be scrolled by the
          keyboard: it holds no focusable control of its own, and a reading
          surface nobody can page through is not a reading surface. */}
      <div
        class="md-doc"
        ref={hostRef}
        tabIndex={0}
        role="document"
        aria-label={`${baseName(props.path)}, rendered`}
        onClick={onClick}
      />
    </div>
  );
}
