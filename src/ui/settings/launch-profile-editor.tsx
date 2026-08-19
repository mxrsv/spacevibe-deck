import { Star, Trash } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { settings, updateSettings } from "../../settings/settings-store";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { AGENT_LOGOS } from "../../lib/agent-logos";
import { letterAvatar } from "../../lib/letter-avatar";
import {
  commandAgentId,
  commandFlags,
  commandProblem,
  createLaunchProfileId,
  type LaunchProfile,
} from "../../lib/launch-profile";

/**
 * Presets: the commands Deck types when it opens an agent.
 *
 * The shape is the owner's reference (2026-08-19), and the load-bearing part
 * of it is the ADD FIELD: one text input where you write the command you
 * already know — `claude --plan`, `codex --dangerously-bypass-approvals-and-
 * sandbox`. An earlier build put a form of per-agent enum menus here instead;
 * it could not express a flag nobody had modelled yet, and it hid the one
 * thing the row is about behind four controls.
 *
 * What the input CANNOT accept is anything a shell would act on. This string
 * is written verbatim into a live interactive shell by `AgentLauncher.arm`, so
 * `commandProblem` refuses separators, substitution, redirects and quotes, and
 * says why. A pipeline belongs in a wrapper script declared as a custom agent.
 *
 * A row's star is its agent's DEFAULT — the command the Open board, a rail
 * drop and ⌘T's initial selection use. One star per agent, because "default"
 * is a per-agent question: starring a codex command cannot unstar a claude one.
 *
 * Every built-in agent with no command of its own still gets a row, printing
 * its bare binary. That row is not a placeholder: launching the bare binary is
 * exactly what Deck does for an agent nobody has written a preset for, so the
 * list stays an honest picture of what each agent will run.
 */

/** The agent's brand mark, or the letter avatar every unmarked agent wears. */
function AgentMark({ id, label }: { id: string; label: string }) {
  const logo = AGENT_LOGOS[id];
  if (logo !== undefined) {
    return <img class="lp-mark" src={logo} alt="" />;
  }
  const avatar = letterAvatar(label, id);
  return (
    <span
      class="lp-mark lp-mark--letter"
      style={{ color: `var(--${avatar.color})` }}
    >
      {avatar.letter}
    </span>
  );
}

/** A command, split so the binary reads louder than its flags. */
function CommandLine({ command }: { command: string }) {
  const flags = commandFlags(command);
  return (
    <span class="lp-command">
      <span class="lp-command__binary">{commandAgentId(command)}</span>
      {flags !== "" && <span class="lp-command__flags"> {flags}</span>}
    </span>
  );
}

/** The label shown for an agent id — its catalog name, else the id itself. */
function agentLabel(agentId: string): string {
  return BUILTIN_AGENTS.find((agent) => agent.id === agentId)?.label ?? agentId;
}

interface Row {
  /** The profile this row came from, or null for an agent with no command. */
  readonly profile: LaunchProfile | null;
  readonly agentId: string;
  readonly command: string;
  readonly starred: boolean;
}

/**
 * The rows, grouped so every command sits under the agent it launches and
 * every built-in agent appears exactly once even with no command declared.
 * Declared order is preserved inside an agent — the list is the user's.
 */
function buildRows(
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): readonly Row[] {
  const rows: Row[] = [];
  const seenAgents = new Set<string>();
  for (const agent of BUILTIN_AGENTS) {
    const owned = profiles.filter(
      (profile) => commandAgentId(profile.command) === agent.id,
    );
    seenAgents.add(agent.id);
    if (owned.length === 0) {
      rows.push({
        profile: null,
        agentId: agent.id,
        command: agent.id,
        starred: false,
      });
      continue;
    }
    for (const profile of owned) {
      rows.push({
        profile,
        agentId: agent.id,
        command: profile.command,
        starred: defaults[agent.id] === profile.id,
      });
    }
  }
  // A command whose binary is not a built-in — a declared agent, or a wrapper
  // script. It still belongs in the list: it is still something Deck will type.
  for (const profile of profiles) {
    const agentId = commandAgentId(profile.command);
    if (seenAgents.has(agentId)) {
      continue;
    }
    rows.push({
      profile,
      agentId,
      command: profile.command,
      starred: defaults[agentId] === profile.id,
    });
  }
  return rows;
}

export function LaunchProfileEditor() {
  const profiles = settings.value.launchProfiles;
  const defaults = settings.value.defaultLaunchProfiles;

  const draft = useSignal("");
  const draftError = useSignal<string | null>(null);

  const add = (): void => {
    const command = draft.value.trim();
    const problem = commandProblem(command);
    if (problem !== null) {
      draftError.value = problem;
      return;
    }
    if (profiles.some((profile) => profile.command === command)) {
      draftError.value = "that command is already in the list";
      return;
    }
    const id = createLaunchProfileId(command, profiles);
    const agentId = commandAgentId(command);
    updateSettings({
      launchProfiles: [...profiles, { id, command }],
      // The FIRST command an agent gets becomes its default. Anything else
      // would leave the agent still launching bare while its command sat in
      // the list, which reads as the add having failed.
      ...(defaults[agentId] === undefined
        ? { defaultLaunchProfiles: { ...defaults, [agentId]: id } }
        : {}),
    });
    draft.value = "";
    draftError.value = null;
  };

  const star = (agentId: string, profileId: string): void => {
    updateSettings({
      defaultLaunchProfiles: { ...defaults, [agentId]: profileId },
    });
  };

  /**
   * Removing a command and dropping any default that points at it is ONE
   * write: two calls would leave a dangling default on disk for the tick
   * between them, and a default the validator then silently drops reads to the
   * user as the setting having been forgotten.
   */
  const remove = (profile: LaunchProfile): void => {
    const nextDefaults: Record<string, string> = {};
    for (const [agentId, profileId] of Object.entries(defaults)) {
      if (profileId !== profile.id) {
        nextDefaults[agentId] = profileId;
      }
    }
    updateSettings({
      launchProfiles: profiles.filter((entry) => entry.id !== profile.id),
      defaultLaunchProfiles: nextDefaults,
    });
  };

  const rows = buildRows(profiles, defaults);

  return (
    <>
      {rows.map((row) => (
        <div
          key={row.profile?.id ?? `bare:${row.agentId}`}
          class="cfg-row cfg-row--item lp-row"
        >
          <div class="cfg-row__key lp-row__key">
            <AgentMark id={row.agentId} label={agentLabel(row.agentId)} />
            <CommandLine command={row.command} />
          </div>
          <div class="cfg-row__value">
            {row.profile !== null && (
              <>
                <button
                  type="button"
                  class={`lp-star ${row.starred ? "is-on" : ""}`}
                  aria-pressed={row.starred}
                  aria-label={
                    row.starred
                      ? `${row.command} is the default`
                      : `Make ${row.command} the default`
                  }
                  title={
                    row.starred
                      ? "This is what the agent launches with"
                      : "Launch this agent with this command"
                  }
                  // A starred row's click is inert rather than a toggle: an
                  // agent always launches with SOMETHING, so unstarring would
                  // have to silently pick a replacement.
                  onClick={() =>
                    row.starred
                      ? undefined
                      : star(row.agentId, row.profile!.id)
                  }
                >
                  {/* Filled when starred: this surface is achromatic
                      (DL-3.7), so shape carries the state that a colour would
                      carry anywhere else. `filled` is DeckIcon's own scoped
                      treatment, not a free weight prop. */}
                  <DeckIcon icon={Star} size={ROW_ICON} filled={row.starred} />
                </button>
                <button
                  type="button"
                  class="cfg-row__remove"
                  aria-label={`Remove ${row.command}`}
                  title={`Remove ${row.command}`}
                  onClick={() => remove(row.profile!)}
                >
                  <DeckIcon icon={Trash} size={ROW_ICON} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <div class="cfg-row lp-add">
        <input
          type="text"
          class="text-input lp-add__input"
          aria-label="Add command"
          placeholder="Add command (e.g. claude --plan)"
          value={draft.value}
          onInput={(event) => {
            draft.value = event.currentTarget.value;
            draftError.value = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          class="cfg-btn"
          // Not "Add command": the input beside it already answers to that,
          // and two controls sharing one accessible name is one control a
          // screen reader — or a test — cannot tell from the other.
          aria-label="Add"
          disabled={draft.value.trim() === ""}
          onClick={add}
        >
          Add
        </button>
      </div>
      {draftError.value !== null && (
        <div class="cfg-custom--error" role="alert">
          {draftError.value}
        </div>
      )}
    </>
  );
}
