import { CaretDown } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { agentOptions, type CustomAgent } from "../lib/agent-catalog";
import { AGENT_LOGOS } from "../lib/agent-logos";
import { letterAvatar } from "../lib/letter-avatar";
import type { AgentChoice } from "../lib/workspace-recents";
import {
  destinationLabel,
  type QuickDestination,
} from "../repositories/worktree-destinations";
import { ConfigRow } from "./controls/config-row";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";
import { Modal } from "./modal";
import { settings } from "../settings/settings-store";
import { commandFlags, profilesForAgent } from "../lib/launch-profile";

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
 *
 * Three things arrived on 2026-08-19 (DL-29.8). The rows answer ArrowUp/
 * ArrowDown/Home/End with roving focus, so Enter picks without anyone having
 * to know the digits; a `--text-muted` key line under the rows SAYS the digits,
 * which nothing on screen did after the chips stopped wearing their number on
 * 2026-08-16; and a declared agent whose binary has left `$PATH` no longer
 * launches a shell that dies on `command not found` — it routes to Settings,
 * where the catalog is what can fix it.
 */

export interface AgentQuickPickerProps {
  detected: readonly { readonly name: string; readonly path: string }[];
  customAgents: readonly CustomAgent[];
  /**
   * Agent ids switched off in Settings. Passed in rather than read from the
   * settings store so this panel stays prop-driven for the gallery; the
   * filtering itself lives in `agentOptions`, which is also what numbers the
   * digit keys.
   */
  disabledAgents?: readonly string[];
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
   * `profileId` is the launch profile picked on that row — `null` when the
   * agent has none, or when its "No profile" option is selected, which is an
   * explicit request for the bare command even if the agent has a default.
   */
  onSelect(
    agentId: AgentChoice,
    destination: string | null,
    profileId: string | null,
  ): void;
  onCancel(): void;
  /**
   * Open Settings, for a row whose binary is gone. Settings takes no initial
   * category today, so this lands on its first one — the agent catalog is one
   * click from there, and building a deep link for this is not worth a new
   * prop on the screen.
   */
  onManageAgents(): void;
}

/** Every pickable row, in DOM order — what the arrow keys walk. */
function chipsOf(panel: HTMLElement | null): readonly HTMLButtonElement[] {
  return panel === null
    ? []
    : Array.from(panel.querySelectorAll<HTMLButtonElement>("button.achip"));
}

export function AgentQuickPicker({
  detected,
  customAgents,
  disabledAgents = [],
  destinations = [],
  initialDestination = null,
  onSelect,
  onCancel,
  onManageAgents,
}: AgentQuickPickerProps) {
  const chips = agentOptions(detected, customAgents, disabledAgents).map(
    (option) => ({
      ...option,
      logo: AGENT_LOGOS[option.id],
    }),
  );

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

  const launchProfiles = settings.value.launchProfiles;
  const profileDefaults = settings.value.defaultLaunchProfiles;
  /**
   * The user's explicit profile pick per agent id. Seeded lazily for the same
   * reason `chosen` is: the agent's default is resolved on every render, so an
   * agent the user has not touched always reads its CURRENT default rather
   * than whichever one existed at mount.
   */
  const pickedProfiles = useSignal<Readonly<Record<string, string>>>({});

  /** Which profile a row will launch with — the pick, else the default. */
  function profileFor(agentId: string): string {
    return pickedProfiles.value[agentId] ?? profileDefaults[agentId] ?? "";
  }

  /**
   * What a row does when it is chosen, by click, by Enter or by digit.
   *
   * A missing row is a declared agent whose binary is no longer on `$PATH`.
   * It stays listed — a chip that vanishes because a tool was uninstalled
   * reads as lost data (`agent-catalog.ts`) — but launching it would spawn a
   * shell that prints `command not found` and sits there, so the row leads
   * where the problem is fixable instead. Not disabled (DL-19.7 would rather
   * it were omitted than inert): it does something, and the something is
   * useful.
   */
  function activate(chip: {
    readonly id: string;
    readonly missing: boolean;
  }): void {
    if (chip.missing) {
      onManageAgents();
      return;
    }
    pick(chip.id);
  }

  /**
   * Roving focus over the rows (DL-29.8). Focus starts on the panel, not on a
   * row (DL-29.2): a modal driven by bare keys must not put an Enter one
   * keystroke away from launching whatever happens to be first. The first
   * ArrowDown is what moves into the list.
   */
  function moveFocus(event: KeyboardEvent, key: string): boolean {
    const from = event.target instanceof HTMLElement ? event.target : null;
    const chips = chipsOf(
      from === null ? null : from.closest(".agent-quick-picker"),
    );
    if (chips.length === 0) {
      return false;
    }
    const at = chips.findIndex((chip) => chip === document.activeElement);
    const last = chips.length - 1;
    let next: number;
    if (key === "Home") {
      next = 0;
    } else if (key === "End") {
      next = last;
    } else if (key === "ArrowDown") {
      next = at < 0 ? 0 : (at + 1) % chips.length;
    } else {
      next = at < 0 ? last : (at + last) % chips.length;
    }
    chips[next]?.focus();
    return true;
  }

  function pick(agentId: AgentChoice): void {
    const profileId = agentId === null ? "" : profileFor(agentId);
    onSelect(
      agentId,
      current?.path ?? null,
      profileId === "" ? null : profileId,
    );
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // A digit typed while the native `<select>` has focus is the browser's
    // own type-to-select, not a pick — the destination control must not be
    // able to launch a tab out from under the user.
    if (event.target instanceof HTMLSelectElement) {
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      if (!moveFocus(event, event.key)) {
        return;
      }
    } else if (event.key === "0") {
      pick(null);
    } else if (/^[1-9]$/.test(event.key)) {
      const chip = chips[Number(event.key) - 1];
      if (chip === undefined) {
        return;
      }
      // Same route as a click, missing rows included — a digit must not be a
      // way around the check the pointer gets.
      activate(chip);
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
            <span class="cfg-btn__text">
              {current === null ? "—" : destinationLabel(current)}
            </span>
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
        <p class="agent-quick-picker__hint">
          Runs in this workspace — pick an agent to launch it
        </p>
      )}
      <div class="agents">
        {chips.map((chip) => {
          const avatar =
            chip.logo === undefined ? letterAvatar(chip.label, chip.id) : null;
          const profiles = profilesForAgent(chip.id, launchProfiles);
          const button = (
            <button
              key={chip.id}
              type="button"
              class={`achip ${chip.missing ? "is-missing" : ""}`}
              title={
                chip.missing
                  ? `${chip.detail} — not on $PATH; opens Settings`
                  : chip.detail
              }
              onClick={() => activate(chip)}
            >
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
          // No profiles declared for this agent: the row stays exactly the
          // chip it has always been. An empty control on every row would be
          // DL-19.7's omit-don't-disable rule broken five times over, and it
          // is why the emptiness is tested rather than left to the list
          // happening to have length zero.
          if (profiles.length === 0) {
            return button;
          }
          return (
            <div key={chip.id} class="achip-row">
              {button}
              {/* The select is NOT reachable by digit key and its own click
                  must not bubble to the chip: changing a mode would otherwise
                  open the tab before the pick applied. */}
              <select
                class="cfg-btn achip-row__profile"
                aria-label={`${chip.label} launch profile`}
                value={profileFor(chip.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => {
                  pickedProfiles.value = {
                    ...pickedProfiles.value,
                    [chip.id]: event.currentTarget.value,
                  };
                }}
              >
                <option value="">No preset</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {commandFlags(profile.command) || "bare"}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        <button type="button" class="achip is-shell" onClick={() => pick(null)}>
          <span class="shellmark">$</span>Shell only
        </button>
      </div>
      {/* DL-29.8: the keys are stated, not worn. The chips lost their digit
          badges on 2026-08-16 and the keys kept working, which left a
          shortcut nothing on screen admitted to. One quiet line says all of
          them once, which is cheaper than N badges and does not put a number
          back inside every row. */}
      <p class="agent-quick-picker__keys">
        <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>0</kbd> shell · <kbd>↑</kbd>
        <kbd>↓</kbd> <kbd>Enter</kbd> · <kbd>Esc</kbd> close
      </p>
    </Modal>
  );
}
