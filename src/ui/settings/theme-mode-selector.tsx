import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ask } from "../../host/dialog-host";
import { reportPersistError } from "../../chrome/events";
import { settings, updateSettings } from "../../settings/settings-store";
import {
  CANONICAL_THEME_IDS,
  conversionDiscardsData,
  themeModeOf,
  type ThemeMode,
} from "../../settings/themes";
import { ConfigRow } from "../controls/config-row";

interface ModeOption {
  readonly value: ThemeMode;
  readonly label: string;
}

/** Light first: it is the lighter half of the pair, and a left-to-right
    reading of the two segments should run the same way the values do. */
const MODE_OPTIONS: readonly ModeOption[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The whole of Appearance's theme choice since 2026-08-19: two segments, one
 * value, no cards and no import.
 *
 * What it does NOT do is as load-bearing as what it does. It never writes on
 * mount. A user arriving with `tokyo-night`, an imported file, or colour
 * overrides sees the segment their current background already belongs to and
 * keeps every one of those things until they click — opening Settings is not
 * consent to be converted. A click IS consent, and it is total: the canonical
 * id replaces whatever was stored, and the hidden colour overrides go with it,
 * because an override that survived would keep editing the mode the user just
 * chose from a surface that no longer shows it (design spec §6).
 *
 * The confirmation is therefore scoped to the cases where something
 * unrecoverable is on the line — an imported file's selection, or overrides
 * the user can no longer see — and stays out of the way for a legacy built-in,
 * where nothing is lost that re-picking cannot restore.
 */
export function ThemeModeSelector() {
  const groupRef = useRef<HTMLDivElement>(null);
  const converting = useSignal(false);
  const current = settings.value;
  const mode = themeModeOf(current);

  const select = async (next: ThemeMode): Promise<void> => {
    const themeId = CANONICAL_THEME_IDS[next];
    // One answer for one `current`: the guard below and the confirmation
    // further down ask the same question, and asking a pure function twice
    // only invites the two to disagree if it ever stops being pure.
    const discardsData = conversionDiscardsData(current);
    // Already exactly this preset with nothing hidden on top: the click is a
    // no-op, and writing anyway would burn a store round trip and a merge
    // broadcast to arrive at the value already on screen.
    if (current.themeId === themeId && !discardsData) {
      return;
    }
    if (converting.value) {
      return;
    }
    converting.value = true;
    try {
      if (discardsData) {
        const confirmed = await ask(
          `Switching to ${next === "light" ? "Light" : "Dark"} replaces your current theme and clears any colour overrides saved with it. Imported theme files stay on disk.`,
          {
            title: "Change appearance",
            kind: "warning",
            okLabel: "Switch",
            cancelLabel: "Cancel",
          },
        );
        if (!confirmed) {
          return;
        }
      }
      updateSettings({ themeId, colorOverrides: {} });
    } catch {
      // Fail safe, exactly like the reset row: a prompt that could not be
      // shown must not be treated as an answer.
      reportPersistError("Couldn't confirm the appearance change — nothing was changed.");
    } finally {
      converting.value = false;
    }
  };

  /**
   * Arrow keys move the selection itself, which is what a radio group does —
   * `tabIndex` keeps exactly one segment in the tab order so Tab enters and
   * leaves the pair as one control rather than walking through it.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const index = MODE_OPTIONS.findIndex((option) => option.value === mode);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? MODE_OPTIONS.length - 1
          : (index + (forward ? 1 : -1) + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    const next = MODE_OPTIONS[nextIndex];
    groupRef.current?.querySelectorAll<HTMLButtonElement>("button")[nextIndex]?.focus();
    void select(next.value);
  };

  return (
    <ConfigRow label="Appearance" desc="Use a light or dark surface across Deck">
      <div
        ref={groupRef}
        class="segmented"
        role="radiogroup"
        aria-label="Appearance mode"
        onKeyDown={onKeyDown}
      >
        {MODE_OPTIONS.map((option) => {
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              class={`segmented__option ${selected ? "is-selected" : ""}`}
              onClick={() => void select(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </ConfigRow>
  );
}
