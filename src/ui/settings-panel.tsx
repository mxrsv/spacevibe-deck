import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  resetSettings,
  settings,
  updateColorOverride,
  updateSettings,
} from "../settings/settings-store";
import {
  clampFontSize,
  clampScrollback,
  COLOR_KEYS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SCROLLBACK_CHOICES,
  type TabBarPosition,
  type TerminalColors,
} from "../settings/settings-schema";
import { getPreset, THEME_PRESETS } from "../settings/themes";
import { ConfigGroup, ConfigRow, ToggleRow } from "./controls/config-row";
import { ColorRow } from "./controls/color-row";
import { FontRow } from "./controls/font-row";
import { EditorRow } from "./controls/editor-row";
import { LogoRow } from "./controls/logo-row";
import { reportPersistError } from "../chrome/events";
import { requestAgentNotificationPermission } from "../lib/native-notification";

const TAB_BAR_CHOICES: readonly TabBarPosition[] = ["left", "top"];

const COLOR_LABELS: Record<keyof TerminalColors, string> = {
  background: "Background",
  foreground: "Foreground",
  cursor: "Cursor",
  selectionBackground: "Selection",
};

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const current = settings.value;
  const preset = getPreset(current.themeId);
  const escRef = useRef<HTMLButtonElement>(null);
  // Guards the native OS permission prompt: true while a request from THIS
  // click is in flight, so a second click can't fire a second prompt.
  const requesting = useSignal(false);
  // Same guard for the Restore-defaults confirm — one prompt per click.
  const resetting = useSignal(false);

  // Move focus into the panel on open, so Escape reaches the handler below
  // instead of being swallowed by the terminal that had focus. preventScroll:
  // the panel body scrolls, and stealing focus must not jump it.
  useEffect(() => {
    if (open) {
      escRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Escape closes the panel — unless the key is headed for a terminal,
  // which owns its own Escape (vim, fzf, …).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      // A terminal owns its own Escape (vim, fzf) — leave it be. Guard the type:
      // keydown can target a non-Element (document/window) that has no closest().
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }
      // Blur first: a focused text field commits its draft on blur, so closing
      // never silently drops what the user just typed.
      if (target instanceof HTMLElement) {
        target.blur();
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  const cycleTheme = (): void => {
    const index = THEME_PRESETS.findIndex(
      (themePreset) => themePreset.id === current.themeId,
    );
    const next = THEME_PRESETS[(index + 1) % THEME_PRESETS.length];
    // Switching theme clears previous color overrides
    updateSettings({ themeId: next.id, colorOverrides: {} });
  };

  const cycleTabBar = (): void => {
    const index = TAB_BAR_CHOICES.indexOf(current.tabBarPosition);
    const next = TAB_BAR_CHOICES[(index + 1) % TAB_BAR_CHOICES.length];
    updateSettings({ tabBarPosition: next });
  };

  const cycleScrollback = (): void => {
    const clamped = clampScrollback(current.scrollback);
    // Off-choice values (legacy / typed) count as the nearest choice at or below.
    // CHOICES is sorted ascending, so the count of choices at or below the
    // current value is one past its index.
    const index = Math.max(
      0,
      SCROLLBACK_CHOICES.filter((choice) => choice <= clamped).length - 1,
    );
    const next = SCROLLBACK_CHOICES[(index + 1) % SCROLLBACK_CHOICES.length];
    updateSettings({ scrollback: next });
  };

  const scrollbackLabel = (n: number): string => {
    if (n >= 1000) {
      return `${n / 1000}k lines`;
    }
    return `${n} lines`;
  };

  // Disabling is immediate and never prompts. Enabling requests OS
  // permission from THIS click only — never at mount/startup/reset — and
  // only flips the setting to true when the user actually grants it.
  const handleAgentNotificationsToggle = async (): Promise<void> => {
    if (requesting.value) {
      // Local guard: blocks re-entry synchronously, before the `requesting`
      // signal write has propagated to a re-rendered (disabled) button.
      return;
    }
    if (current.agentNotifications) {
      updateSettings({ agentNotifications: false });
      return;
    }
    requesting.value = true;
    try {
      const granted = await requestAgentNotificationPermission();
      if (granted) {
        updateSettings({ agentNotifications: true });
      } else {
        reportPersistError("Notification permission was denied.");
      }
    } catch {
      reportPersistError("Couldn't request notification permission.");
    } finally {
      requesting.value = false;
    }
  };

  /**
   * Restore defaults drops theme, font family and size, every color override,
   * the editor, tab bar position, pane bar and scrollback in one click, with
   * no undo. Red styling is a signifier, not a guard — so this goes through
   * the same native prompt every other destructive path uses (close tab,
   * quit). Dialog failure is fail-safe: reset nothing, say so.
   */
  const handleReset = async (): Promise<void> => {
    if (resetting.value) {
      return;
    }
    resetting.value = true;
    try {
      const confirmed = await ask(
        "Theme, font, colors and behavior all go back to their defaults. This can't be undone.",
        {
          title: "Restore Defaults",
          kind: "warning",
          okLabel: "Restore",
          cancelLabel: "Cancel",
        },
      );
      if (confirmed) {
        resetSettings();
      }
    } catch {
      reportPersistError("Couldn't confirm the reset — nothing was changed.");
    } finally {
      resetting.value = false;
    }
  };

  return (
    <aside
      class={`panel ${open ? "is-open" : ""}`}
      aria-label="Settings"
      aria-hidden={!open}
    >
      <header class="panel__head">
        <h2 class="panel__path">
          <b>~</b>/deck/settings
        </h2>
        <button
          ref={escRef}
          type="button"
          class="panel__esc"
          aria-label="Close settings"
          onClick={onClose}
        >
          esc
        </button>
      </header>

      <div class="panel__body">
        <ConfigGroup label="appearance" />
        <ConfigRow label="Theme" desc="terminal palette">
          <button
            type="button"
            class="cfg-btn"
            title="Next theme"
            aria-label={`Theme: ${preset.label}. Switch to next theme`}
            onClick={cycleTheme}
          >
            <span
              class="cfg-swatch"
              style={{
                background: preset.theme.background,
                borderColor: preset.theme.blue,
              }}
            />
            {preset.id}
            <span class="cfg-btn__hint">↹</span>
          </button>
        </ConfigRow>
        <FontRow
          value={current.fontFamily}
          onChange={(fontFamily) => updateSettings({ fontFamily })}
        />
        <ConfigRow label="Font size">
          <span class="cfg-btn cfg-step" role="group" aria-label="Font size">
            <button
              type="button"
              class="cfg-step__btn"
              aria-label="Decrease font size"
              disabled={current.fontSize <= FONT_SIZE_MIN}
              onClick={() => stepFontSize(-1)}
            >
              −
            </button>
            <span class="cfg-step__val">{current.fontSize}px</span>
            <button
              type="button"
              class="cfg-step__btn"
              aria-label="Increase font size"
              disabled={current.fontSize >= FONT_SIZE_MAX}
              onClick={() => stepFontSize(1)}
            >
              +
            </button>
          </span>
        </ConfigRow>
        <LogoRow />

        <ConfigGroup label="colors" />
        {COLOR_KEYS.map((key) => (
          <ColorRow
            key={key}
            label={COLOR_LABELS[key]}
            value={current.colorOverrides[key] ?? preset.theme[key]}
            overridden={current.colorOverrides[key] !== undefined}
            onChange={(hex) => updateColorOverride(key, hex)}
            onClear={() => updateColorOverride(key, undefined)}
          />
        ))}

        <ConfigGroup label="behavior" />
        <EditorRow
          value={current.editorId}
          command={current.editorCommand}
          onChange={(editorId) => updateSettings({ editorId })}
          onCommandChange={(editorCommand) => updateSettings({ editorCommand })}
        />
        <ConfigRow label="Tab bar position" desc="where the tab list sits">
          <button
            type="button"
            class="cfg-btn"
            title="Next position"
            aria-label={`Tab bar position: ${current.tabBarPosition}. Switch to next position`}
            onClick={cycleTabBar}
          >
            {current.tabBarPosition}
            <span class="cfg-btn__hint">↹</span>
          </button>
        </ConfigRow>
        <ToggleRow
          label="Show pane bar"
          desc="pane name bar inside splits"
          checked={current.showPaneBar}
          onToggle={() => updateSettings({ showPaneBar: !current.showPaneBar })}
        />
        <ToggleRow
          label="agent notifications"
          desc="native alert when a background agent finishes or needs you"
          checked={current.agentNotifications}
          disabled={requesting.value}
          onToggle={handleAgentNotificationsToggle}
        />
        <ConfigRow label="Scrollback" desc="lines kept per pane">
          <button
            type="button"
            class="cfg-btn"
            title="Next scrollback size"
            aria-label={`Scrollback: ${scrollbackLabel(current.scrollback)}. Switch to next size`}
            onClick={cycleScrollback}
          >
            {scrollbackLabel(current.scrollback)}
            <span class="cfg-btn__hint">↹</span>
          </button>
        </ConfigRow>

        <ConfigGroup label="danger" />
        <ConfigRow
          label="Restore defaults"
          desc="theme, font, colors, behavior"
          danger
        >
          <button
            type="button"
            class="cfg-btn cfg-btn--danger"
            title="Restore defaults — asks for confirmation"
            disabled={resetting.value}
            onClick={() => void handleReset()}
          >
            ↺ reset
          </button>
        </ConfigRow>
      </div>
    </aside>
  );
}
