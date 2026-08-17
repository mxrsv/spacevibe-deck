import { Repeat } from "@phosphor-icons/react";
import {
  clampScrollback,
  SCROLLBACK_CHOICES,
} from "../../../settings/settings-schema";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow } from "../../controls/config-row";

function scrollbackLabel(n: number): string {
  if (n >= 1000) {
    return `${n / 1000}k lines`;
  }
  return `${n} lines`;
}

export function TerminalSection() {
  const current = settings.value;

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

  return (
    <ConfigRow label="Scrollback" desc="Lines kept per pane">
      <button
        type="button"
        class="cfg-btn"
        title="Next scrollback size"
        aria-label={`Scrollback: ${scrollbackLabel(current.scrollback)}. Switch to next size`}
        onClick={cycleScrollback}
      >
        {scrollbackLabel(current.scrollback)}
        <span class="cfg-btn__hint">
          <DeckIcon icon={Repeat} size={ROW_ICON} />
        </span>
      </button>
    </ConfigRow>
  );
}
