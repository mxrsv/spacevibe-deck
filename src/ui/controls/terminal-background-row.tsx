import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useSignal } from "@preact/signals";
import { reportPersistError } from "../../chrome/events";
import { settings, updateSettings } from "../../settings/settings-store";
import type {
  TerminalBackgroundFit,
  TerminalBackgroundSettings,
  TerminalBackgroundTarget,
} from "../../settings/settings-schema";
import { ConfigRow } from "./config-row";

const TARGETS: readonly TerminalBackgroundTarget[] = [
  "all",
  "xterm",
  "alacritty",
];
const FITS: readonly TerminalBackgroundFit[] = ["cover", "contain", "stretch"];

function patchBackground(patch: Partial<TerminalBackgroundSettings>): void {
  updateSettings({
    terminalBackground: { ...settings.value.terminalBackground, ...patch },
  });
}

function nextValue<T>(values: readonly T[], current: T): T {
  return values[(Math.max(0, values.indexOf(current)) + 1) % values.length];
}

export function TerminalBackgroundRows() {
  const current = settings.value.terminalBackground;
  const picking = useSignal(false);

  const chooseImage = async (): Promise<void> => {
    if (picking.value) return;
    picking.value = true;
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] },
        ],
      });
      if (typeof selected !== "string") return;
      const imageDataUrl = await invoke<string>("read_image_as_data_url", {
        path: selected,
      });
      patchBackground({ imageDataUrl });
    } catch (error) {
      reportPersistError(
        typeof error === "string" ? error : "Couldn't load the background image.",
      );
    } finally {
      picking.value = false;
    }
  };

  return (
    <>
      <ConfigRow label="Terminal background" desc="image behind terminal panes">
        <span class="cfg-background-actions">
          {current.imageDataUrl !== "" && (
            <span
              class="cfg-background-preview"
              style={{ backgroundImage: `url(${current.imageDataUrl})` }}
              aria-hidden="true"
            />
          )}
          <button
            type="button"
            class="cfg-btn"
            disabled={picking.value}
            onClick={() => void chooseImage()}
          >
            {current.imageDataUrl === "" ? "choose…" : "change…"}
          </button>
          {current.imageDataUrl !== "" && (
            <button
              type="button"
              class="cfg-btn cfg-btn--compact"
              aria-label="Remove terminal background image"
              onClick={() => patchBackground({ imageDataUrl: "" })}
            >
              remove
            </button>
          )}
        </span>
      </ConfigRow>
      <ConfigRow label="Background target">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => patchBackground({ target: nextValue(TARGETS, current.target) })}
        >
          {current.target}
          <span class="cfg-btn__hint">↹</span>
        </button>
      </ConfigRow>
      <ConfigRow label="Image fit">
        <button
          type="button"
          class="cfg-btn"
          onClick={() => patchBackground({ fit: nextValue(FITS, current.fit) })}
        >
          {current.fit}
          <span class="cfg-btn__hint">↹</span>
        </button>
      </ConfigRow>
      <ConfigRow label="Image dim" desc={`${Math.round(current.dim * 100)}%`}>
        <input
          class="cfg-range"
          type="range"
          min="0"
          max="90"
          step="5"
          value={Math.round(current.dim * 100)}
          aria-label="Background image dimming"
          onInput={(event) =>
            patchBackground({ dim: Number(event.currentTarget.value) / 100 })
          }
        />
      </ConfigRow>
      <ConfigRow
        label="Alacritty opacity"
        desc={`${Math.round(current.nativeOpacity * 100)}%`}
      >
        <input
          class="cfg-range"
          type="range"
          min="40"
          max="100"
          step="5"
          value={Math.round(current.nativeOpacity * 100)}
          aria-label="Alacritty background opacity"
          onInput={(event) =>
            patchBackground({
              nativeOpacity: Number(event.currentTarget.value) / 100,
            })
          }
        />
      </ConfigRow>
    </>
  );
}
