import { ArrowCounterClockwise, DotsThree } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { invoke } from "../../host/bridge";
import { open } from "../../host/dialog-host";
import { available as electronAvailable } from "../../host/external-apps-host";
import { clearLogo, logoDataUrl, setLogoFromDataUrl } from "../../settings/logo-store";
import { ConfigRow } from "./config-row";
import { DeckIcon, ROW_ICON } from "./deck-icon";

/**
 * App logo control: a menu-style pill that opens a native image picker, plus a
 * clear button (DL-6.1) when a custom logo is set. Errors show inline below.
 */
export function LogoRow() {
  const error = useSignal<string | null>(null);
  const hasLogo = logoDataUrl.value !== "";

  async function choose(): Promise<void> {
    try {
      const dataUrl = electronAvailable
        ? await invoke<string | null>("pick_image_as_data_url", {})
        : await (async () => {
            const picked = await open({
              filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "svg", "webp"] }],
            });
            return picked === null
              ? null
              : invoke<string>("read_image_as_data_url", { path: picked });
          })();
      if (typeof dataUrl !== "string") {
        return;
      }
      error.value = null;
      await setLogoFromDataUrl(dataUrl);
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : "Couldn't set the logo";
    }
  }

  return (
    <>
      <ConfigRow label="App logo" desc="Shown on the open board">
        <button
          type="button"
          class="cfg-btn"
          aria-label="Choose app logo"
          onClick={() => void choose()}
        >
          {hasLogo ? "custom" : "default"}
          <span class="cfg-btn__hint">
            <DeckIcon icon={DotsThree} size={ROW_ICON} />
          </span>
        </button>
        {hasLogo ? (
          <button
            type="button"
            class="cfg-clear"
            aria-label="Remove app logo"
            title="Remove logo"
            onClick={() => {
              error.value = null;
              clearLogo();
            }}
          >
            <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
          </button>
        ) : null}
      </ConfigRow>
      {error.value !== null ? <div class="cfg-custom cfg-custom--error">{error.value}</div> : null}
    </>
  );
}
