import { Folder } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { invoke } from "../host/bridge";
import { validateLogoDataUrl } from "../settings/logo-store";
import { DeckIcon, FEATURE_ICON, type DeckIconSize } from "./controls/deck-icon";

/**
 * The project identity in the existing DL-27.17 icon slot: the folder's own
 * favicon when the scan finds one, else `fallback` — the folder glyph unless the
 * caller has something better (the collapsed column prints initials, DL-27.29).
 * Shared by the project header and the avatar column so the two cannot draw
 * different icons for one project.
 */
export function WorkspaceIcon({
  path,
  fallback,
  className = "asr-cluster__folder",
  size = FEATURE_ICON,
  marks = false,
  fallbackSize = FEATURE_ICON,
}: {
  readonly path: string | null;
  readonly fallback?: ComponentChildren;
  /** The slot's box; the project rail draws its own instead of the old rail's. */
  readonly className?: string;
  readonly size?: number;
  /** Also accept a logo or an app icon: the project rail, which is behind its release switch. */
  readonly marks?: boolean;
  /** The size of the default folder glyph; ignored when the caller passes its own `fallback`. */
  readonly fallbackSize?: DeckIconSize;
}) {
  const favicon = useSignal("");
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const electron =
          (globalThis as { __deckHost?: unknown }).__deckHost !== undefined &&
          (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined;
        if (electron) {
          const authorized = await invoke<boolean>("activate_image_workspace_root", {
            root: path,
          });
          if (!authorized) return;
        }
        const result = await invoke<unknown>("scan_workspace_favicon", { dir: path, marks });
        if (!cancelled) favicon.value = validateLogoDataUrl(result);
      } catch (error) {
        console.warn("Failed to load workspace favicon:", path, error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `favicon` is a signal whose identity never changes, so listing it would
    // add a dependency that cannot vary. The path is the whole input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <span class={className} aria-hidden="true">
      {favicon.value ? (
        <img
          src={favicon.value}
          alt=""
          width={size}
          height={size}
          draggable={false}
          style={{ objectFit: "contain" }}
          onError={() => {
            favicon.value = "";
          }}
        />
      ) : (
        (fallback ?? <DeckIcon icon={Folder} size={fallbackSize} filled />)
      )}
    </span>
  );
}
