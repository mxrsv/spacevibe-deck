import { CaretDown } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { agentOptions, type CustomAgent } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { AgentChoice } from "../lib/workspace-recents";
import { destinationLabel, type QuickDestination } from "../repositories/worktree-destinations";
import { ConfigRow } from "./controls/config-row";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";
import { Modal } from "./modal";

/**
 * The `+` button's fast path: pick a destination and an agent, open a tab.
 * Reuses the open board's `.achip` chips and digit-key picking (`1-9`,
 * `0` = shell) but skips its workspace/layout steps — a pick is a click or a
 * digit key, applied immediately, no confirm step.
 *
 * Two owner decisions on 2026-08-16 shaped what is here. The chips no longer
 * WEAR their number (the keys still pick, on both this surface and the open
 * board's identical chips), and the agents are a COLUMN of rows rather than a
 * wrapped grid (DL-29.7), because each row now has a destination to be read
 * against.
 *
 * The destination is one choice, not two, even though it prints as
 * `folder · branch`: in git a worktree is checked out on exactly one branch.
 * See `worktree-destinations.ts` for why picking a branch independently is
 * deliberately not offered.
 */

export interface AgentQuickPickerProps {
  detected: readonly { readonly name: string; readonly path: string }[];
  customAgents: readonly CustomAgent[];
  /**
   * Worktrees of the repository the active tab is on. Empty for a plain
   * folder, and empty on any host with no `git_repository` channel — the
   * destination row is then not rendered at all and the new tab lands where
   * it always did, in the focused pane's cwd.
   */
  destinations?: readonly QuickDestination[];
  /** Which destination opens selected; ignored when `destinations` is empty. */
  initialDestination?: string | null;
  /**
   * `agentId` is `null` for the shell-only row. `destination` is the chosen
   * worktree path, or `null` to keep the caller's own cwd resolution.
   */
  onSelect(agentId: AgentChoice, destination: string | null): void;
  onCancel(): void;
}

export function AgentQuickPicker({
  detected,
  customAgents,
  destinations = [],
  initialDestination = null,
  onSelect,
  onCancel,
}: AgentQuickPickerProps) {
  const chips = agentOptions(detected, customAgents).map((option) => ({
    ...option,
    logo: AGENT_LOGOS[option.id],
  }));

  /**
   * The user's explicit pick, or null for "whatever the default resolves to".
   *
   * Deliberately NOT seeded from `initialDestination`: the repository scan is
   * async, so this component usually mounts with an empty list and receives
   * the worktrees a frame or two later. Seeding at mount would freeze that
   * empty answer; resolving on every render lets the list arrive late without
   * the row ever showing a destination the caller did not offer.
   */
  const chosen = useSignal<string | null>(null);

  const current =
    destinations.find((entry) => entry.path === chosen.value) ??
    destinations.find((entry) => entry.path === initialDestination) ??
    destinations[0] ??
    null;

  function pick(agentId: AgentChoice): void {
    onSelect(agentId, current?.path ?? null);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // A digit typed while the native `<select>` has focus is the browser's
    // own type-to-select, not a pick — the destination control must not be
    // able to launch a tab out from under the user.
    if (event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === "0") {
      pick(null);
    } else if (/^[1-9]$/.test(event.key)) {
      const chip = chips[Number(event.key) - 1];
      if (chip === undefined) {
        return;
      }
      pick(chip.id);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <Modal
      panelClass="agent-quick-picker"
      label="Open a new tab"
      onDismiss={onCancel}
      onKeyDown={handleKeyDown}
    >
      <h1>Open a new tab</h1>
      {/* DL-29.7: the destination is stated once, above the rows, because
          every row runs in it — repeating it per row would be five copies of
          one value. Omitted entirely rather than disabled when the repository
          offers nothing to choose (DL-19.7's omit-don't-disable rule). */}
      {destinations.length > 1 ? (
        <ConfigRow label="Worktree">
          {/* menu value kind (DL-6, DL-1.4): a native select overlaid
              invisibly on the styled pill. */}
          <span class="cfg-btn cfg-btn--overlay">
            <span class="cfg-btn__text">{current === null ? "—" : destinationLabel(current)}</span>
            <span class="cfg-btn__hint">
              <DeckIcon icon={CaretDown} size={ROW_ICON} />
            </span>
            <select
              value={current?.path ?? ""}
              aria-label="Worktree"
              onChange={(event) => {
                chosen.value = event.currentTarget.value;
              }}
            >
              {destinations.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {destinationLabel(entry)}
                </option>
              ))}
            </select>
          </span>
        </ConfigRow>
      ) : current !== null ? (
        // One worktree is not a choice. It still gets a row, because the
        // agents below have to be read against somewhere — a readout, not a
        // control the user can press and have nothing happen.
        <ConfigRow label="Worktree">
          <span class="cfg-readout">{destinationLabel(current)}</span>
        </ConfigRow>
      ) : (
        <p class="agent-quick-picker__hint">Runs in this workspace — pick an agent to launch it</p>
      )}
      <div class="agents">
        {chips.map((chip) => {
          const avatar = chip.logo === undefined ? letterAvatar(chip.label, chip.id) : null;
          return (
            <button
              key={chip.id}
              type="button"
              class={`achip ${chip.missing ? "is-missing" : ""}`}
              title={chip.missing ? `${chip.detail} — not on $PATH` : chip.detail}
              onClick={() => pick(chip.id)}
            >
              {chip.logo !== undefined ? (
                <img class="achip__logo" src={chip.logo} alt="" />
              ) : (
                <span class="achip__letter" style={{ color: `var(--${avatar?.color})` }}>
                  {avatar?.letter}
                </span>
              )}
              {chip.label}
            </button>
          );
        })}
        <button type="button" class="achip is-shell" onClick={() => pick(null)}>
          <span class="shellmark">$</span>Shell only
        </button>
      </div>
    </Modal>
  );
}
