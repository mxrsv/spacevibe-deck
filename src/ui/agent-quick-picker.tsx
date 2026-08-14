import { useEffect, useRef } from "preact/hooks";
import { agentOptions, type CustomAgent } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { AgentChoice } from "../lib/workspace-recents";

/**
 * The `+` button's fast path: pick an agent, open a tab in the current
 * workspace. Reuses the open board's `.achip` chips and digit-key picking
 * (`1-9`, `0` = shell) but skips its workspace/layout steps entirely — a
 * pick is a click or a digit key, applied immediately, no confirm step.
 */

export interface AgentQuickPickerProps {
  detected: readonly { readonly name: string; readonly path: string }[];
  customAgents: readonly CustomAgent[];
  /** `null` selects the shell-only chip. */
  onSelect(agentId: AgentChoice): void;
  onCancel(): void;
}

export function AgentQuickPicker({
  detected,
  customAgents,
  onSelect,
  onCancel,
}: AgentQuickPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const chips = agentOptions(detected, customAgents).map((option) => ({
    ...option,
    logo: AGENT_LOGOS[option.id],
  }));

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onCancel();
    } else if (event.key === "0") {
      onSelect(null);
    } else if (/^[1-9]$/.test(event.key)) {
      const chip = chips[Number(event.key) - 1];
      if (chip === undefined) {
        return;
      }
      onSelect(chip.id);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div class="modal-scrim">
      <div
        class="agent-quick-picker"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={containerRef}
      >
        <h1>Open a new tab</h1>
        <p class="agent-quick-picker__hint">
          Runs in this workspace — pick an agent to launch it
        </p>
        <div class="agents">
          {chips.map((chip, index) => {
            const avatar =
              chip.logo === undefined
                ? letterAvatar(chip.label, chip.id)
                : null;
            return (
              <button
                key={chip.id}
                type="button"
                class={`achip ${chip.missing ? "is-missing" : ""}`}
                title={
                  chip.missing ? `${chip.detail} — not on $PATH` : chip.detail
                }
                onClick={() => onSelect(chip.id)}
              >
                <kbd>{index + 1}</kbd>
                {chip.logo !== undefined ? (
                  <img class="achip__logo" src={chip.logo} alt="" />
                ) : (
                  <span
                    class="achip__letter"
                    style={{ color: `var(--${avatar?.color})` }}
                  >
                    {avatar?.letter}
                  </span>
                )}
                {chip.label}
              </button>
            );
          })}
          <button
            type="button"
            class="achip is-shell"
            onClick={() => onSelect(null)}
          >
            <kbd>0</kbd>
            <span class="shellmark">$</span>Shell only
          </button>
        </div>
      </div>
    </div>
  );
}
