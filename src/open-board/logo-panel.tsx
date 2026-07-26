import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { installFileDrop } from "../terminal/file-drop";
import {
  logoDataUrl,
  pickImagePath,
  setLogoFromPath,
} from "../settings/logo-store";

/** The default Deck mark, shown until the user sets their own logo. */
function DefaultMark() {
  return (
    <svg
      class="board-logo__mark"
      viewBox="0 0 48 48"
      role="img"
      aria-label="Deck"
    >
      <rect x="6" y="6" width="16" height="16" rx="2" />
      <rect x="26" y="6" width="16" height="16" rx="2" />
      <rect x="6" y="26" width="16" height="16" rx="2" />
      <rect x="26" y="26" width="16" height="16" rx="2" />
    </svg>
  );
}

/**
 * Center column of the Open board: the dev's logo on a plain field. The whole
 * panel is a drop zone — dropping an image swallows it into the app as the new
 * logo (a coordinate hit-test keeps drops outside the panel from counting).
 * Clicking does nothing (the user chose drag-drop + Settings only).
 */
export function LogoPanel() {
  const dragOver = useSignal(false);
  const error = useSignal<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    function inside(x: number, y: number): boolean {
      const rect = panelRef.current?.getBoundingClientRect();
      return (
        rect !== undefined &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      );
    }

    installFileDrop({
      onOver(x, y) {
        dragOver.value = inside(x, y);
      },
      onLeave() {
        dragOver.value = false;
      },
      onDrop(x, y, paths) {
        dragOver.value = false;
        if (!inside(x, y)) {
          return; // a drop meant for something else on screen
        }
        const path = pickImagePath(paths);
        if (path === null) {
          error.value = "Use a .png, .jpg, .svg or .webp image";
          return;
        }
        error.value = null;
        setLogoFromPath(path).catch((err: unknown) => {
          error.value =
            err instanceof Error ? err.message : "Couldn't set the logo";
        });
      },
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err: unknown) => {
        console.warn("Failed to install logo drop:", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const dataUrl = logoDataUrl.value;
  return (
    <div
      ref={panelRef}
      class={`board-logo ${dragOver.value ? "is-drag-over" : ""}`}
    >
      {dataUrl === "" ? (
        <DefaultMark />
      ) : (
        <img class="board-logo__img" src={dataUrl} alt="App logo" />
      )}
      {dragOver.value ? (
        <span class="board-logo__hint">Drop an image to set the logo</span>
      ) : null}
      {error.value !== null ? (
        <span class="board-logo__error">{error.value}</span>
      ) : null}
    </div>
  );
}
