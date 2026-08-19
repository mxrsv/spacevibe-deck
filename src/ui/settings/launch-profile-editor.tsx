import { ArrowClockwise } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { settings, updateSettings } from "../../settings/settings-store";
import { BUILTIN_AGENTS, type BuiltinAgent } from "../../lib/agent-catalog";
import { AGENT_LOGOS } from "../../lib/agent-logos";
import { letterAvatar } from "../../lib/letter-avatar";
import {
  detectedAgents,
  ensureAgentsDetected,
} from "../../terminal/agent-detection-store";
import {
  commandAgentId,
  commandFlags,
  commandProblem,
  createLaunchProfileId,
  profilesForAgent,
  type LaunchProfile,
} from "../../lib/launch-profile";

/**
 * The agent catalog in Settings → Agents.
 *
 * Every agent Deck knows about is a row, and the row states the command that
 * agent will actually launch with. **That command ships with the app**: the
 * catalog carries a recommended `defaultCommand` per agent, so a fresh install
 * shows `claude --dangerously-skip-permissions` immediately rather than a bare
 * binary waiting for someone to type a flag. A preset the user writes replaces
 * it for that agent; nothing merges.
 *
 * The list splits on what is actually on `$PATH`. **Installed** is what the
 * discovery probe found; **Available to install** is everything else Deck
 * knows how to launch, kept visible so the answer to "can Deck run X" is on
 * screen rather than in a docs page. Refresh re-runs the probe, because a CLI
 * installed in another terminal will not otherwise appear until the cache
 * expires.
 *
 * Enabled/Disabled is per agent and it is the ONLY thing that removes a row
 * from the pickers — a built-in cannot be deleted, because Deck would just
 * detect it again on the next probe.
 *
 * Two controls were removed on the owner's ask (2026-08-19): the ↗ that opened
 * an agent's website, and Set default. `BuiltinAgent.url` and
 * `Settings.defaultAgent` are both KEPT — the data is right either way, and
 * "Set default" was called a temporary removal — so restoring either is markup,
 * not a migration.
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

/**
 * The command an agent launches with: the user's own preset if they wrote one,
 * else the catalog's recommendation, else the bare binary. One resolution
 * order, read by the row and by nothing else — `defaultLaunchCommand` is what
 * the launch paths use, and it answers null when the user declared nothing,
 * which is where the catalog default is applied on the way out.
 */
function effectiveCommand(
  agent: BuiltinAgent,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): string {
  const starred = defaults[agent.id];
  const own = profilesForAgent(agent.id, profiles);
  const chosen =
    own.find((profile) => profile.id === starred) ?? own[0] ?? null;
  return chosen?.command ?? agent.defaultCommand ?? agent.id;
}

function EnabledToggle({
  agent,
  enabled,
  onChange,
}: {
  agent: BuiltinAgent;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      class="segmented lp-enabled"
      role="radiogroup"
      aria-label={`${agent.label} availability`}
    >
      {[true, false].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="radio"
          aria-checked={enabled === value}
          aria-label={`${value ? "Enable" : "Disable"} ${agent.label}`}
          tabIndex={enabled === value ? 0 : -1}
          class={`segmented__option ${enabled === value ? "is-selected" : ""}`}
          onClick={() => onChange(value)}
        >
          {value ? "Enabled" : "Disabled"}
        </button>
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  command,
  enabled,
  onToggle,
}: {
  agent: BuiltinAgent;
  command: string;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div class={`lp-agent ${enabled ? "" : "is-off"}`}>
      <AgentMark id={agent.id} label={agent.label} />
      <div class="lp-agent__text">
        <span class="lp-agent__name">{agent.label}</span>
        <CommandLine command={command} />
      </div>
      <EnabledToggle agent={agent} enabled={enabled} onChange={onToggle} />
    </div>
  );
}

export function LaunchProfileEditor() {
  const profiles = settings.value.launchProfiles;
  const defaults = settings.value.defaultLaunchProfiles;
  const disabled = settings.value.disabledAgents;

  const draft = useSignal("");
  const draftError = useSignal<string | null>(null);
  const refreshing = useSignal(false);

  const installedIds = new Set(detectedAgents.value.map((agent) => agent.name));
  const installed = BUILTIN_AGENTS.filter((agent) =>
    installedIds.has(agent.id),
  );
  const available = BUILTIN_AGENTS.filter(
    (agent) => !installedIds.has(agent.id),
  );

  const setEnabled = (agentId: string, next: boolean): void => {
    updateSettings({
      disabledAgents: next
        ? disabled.filter((id: string) => id !== agentId)
        : [...disabled, agentId],
    });
  };

  const refresh = (): void => {
    if (refreshing.value) {
      return;
    }
    refreshing.value = true;
    // `ensureAgentsDetected` has no force flag: a warm cache answers instantly
    // and revalidates behind. That is the right behaviour here too — the
    // button's job is to start a scan, not to block on one.
    void ensureAgentsDetected(BUILTIN_AGENTS.map((agent) => agent.id)).finally(
      () => {
        refreshing.value = false;
      },
    );
  };

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
      ...(defaults[agentId] === undefined
        ? { defaultLaunchProfiles: { ...defaults, [agentId]: id } }
        : {}),
    });
    draft.value = "";
    draftError.value = null;
  };

  const renderRow = (agent: BuiltinAgent) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      command={effectiveCommand(agent, profiles, defaults)}
      enabled={!disabled.includes(agent.id)}
      onToggle={(next) => setEnabled(agent.id, next)}
    />
  );

  return (
    <>
      <div class="lp-head">
        <span class="lp-head__title">Installed</span>
        <span class="lp-head__count">{installed.length} detected</span>
        <button
          type="button"
          class="cfg-btn lp-head__refresh"
          aria-label="Refresh installed agents"
          disabled={refreshing.value}
          onClick={refresh}
        >
          <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
          Refresh
        </button>
      </div>
      {installed.length === 0 ? (
        <p class="lp-empty" role="status">
          No agent CLI found on your PATH. Install one below, then Refresh.
        </p>
      ) : (
        installed.map((agent) => renderRow(agent))
      )}

      {available.length > 0 && (
        <>
          <div class="lp-head">
            <span class="lp-head__title">Available to install</span>
            <span class="lp-head__count">{available.length} agents</span>
          </div>
          {available.map((agent) => renderRow(agent))}
        </>
      )}

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
