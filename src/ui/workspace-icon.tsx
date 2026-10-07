import { Folder } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { invoke } from "../host/bridge";
import { validateLogoDataUrl } from "../settings/logo-store";
import { DeckIcon, FEATURE_ICON } from "./controls/deck-icon";

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
}: {
  readonly path: string | null;
  readonly fallback?: ComponentChildren;
}) {
  const favicon = useSignal("");
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await invoke<unknown>("scan_workspace_favicon", { dir: path });
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
    <span class="asr-cluster__folder" aria-hidden="true">
      {favicon.value ? (
        <img
          src={favicon.value}
          alt=""
          width={FEATURE_ICON}
          height={FEATURE_ICON}
          draggable={false}
          style={{ objectFit: "contain" }}
          onError={() => {
            favicon.value = "";
          }}
        />
      ) : (
        (fallback ?? <DeckIcon icon={Folder} size={FEATURE_ICON} filled />)
      )}
    </span>
  );
}
