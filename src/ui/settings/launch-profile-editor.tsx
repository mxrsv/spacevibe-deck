import { ArrowClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { ConfigGroup, ConfigRow, NOT_AVAILABLE_ON_WINDOWS } from "../controls/config-row";
import { CommitInput } from "../controls/commit-input";
import { AgentChoiceValue, CLI_DEFAULT_CHOICE } from "./agent-choice-value";
import { settings, updateSettings } from "../../settings/settings-store";
import { AGENT_ROW_KEYS, agentEntryChanged } from "../../settings/settings-rows";
import { signalAdaptersPatch } from "../../settings/signal-adapter-choice";
import {
  agentHooksSupported,
  ensureAgentHooksSupportLoaded,
} from "../../settings/agent-hooks-support-store";
import { BUILTIN_AGENTS, type BuiltinAgent } from "../../lib/agent-catalog";
import { AGENT_LOGOS } from "../../lib/agent-logos";
import { letterAvatar } from "../../lib/letter-avatar";
import { detectedAgents } from "../../terminal/agent-detection-store";
import { AgentInstallControl } from "../../launcher/agent-install-control";
import { installOfferFor, probeAgentsNow } from "../../launcher/agent-install-store";
import {
  commandAgentId,
  commandFlags,
  commandProblem,
  createLaunchProfileId,
  isRuntimeValue,
  type LaunchProfile,
} from "../../lib/launch-profile";
import { AgentLaunchFlags } from "./agent-launch-flags";
import { agentLaunchCommand } from "../../lib/launch-command";
import { modelsFor, runtimeFor, type AgentRuntimeDefault } from "../../launcher/runtime-catalog";
import { Button } from "../controls/button";
import { Switch } from "../controls/switch";

/**
 * The agent catalog in Settings → Agents.
 *
 * Every agent Deck knows about is a row, and the row states the command that
 * agent will actually launch with. **That command ships with the app**: the
 * catalog carries a recommended `defaultCommand` per agent, so a fresh install
 * shows `claude --dangerously-skip-permissions` immediately rather than a bare
 * binary waiting for someone to type a flag. A preset the user writes replaces
 * it for that agent; nothing merges. An agent's details show the flags its CLI
 * offers as controls that rewrite that preset (`agent-launch-flags.tsx`).
 *
 * The list splits on what is actually on `$PATH`. **Installed** is what the
 * discovery probe found; **Available to install** is everything else Deck
 * knows how to launch, kept visible so the answer to "can Deck run X" is on
 * screen rather than in a docs page. A missing agent carries `Install` on its
 * row (or `Get`, when Deck has no verified command), and Refresh forces a
 * fresh probe, because a CLI installed in another terminal will not otherwise
 * appear until the cache expires.
 *
 * Enabled/Disabled is per agent and it is the ONLY thing that removes a row
 * from the pickers — a built-in cannot be deleted, because Deck would just
 * detect it again on the next probe.
 *
 * Two controls were removed on the owner's ask (2026-08-19): the ↗ that opened
 * an agent's website, and Set default. `BuiltinAgent.url` and
 * `Settings.defaultAgent` are both KEPT — the data is right either way, and
 * "Set default" was called a temporary removal — so restoring either is markup,
 * not a migration. The website link has since returned in one place only
 * (2026-10-10): `Get`, on a missing agent with no install command. An installed
 * row shows no link.
 */

/** The agent's brand mark, or the letter avatar every unmarked agent wears. */
export function AgentMark({ id, label }: { id: string; label: string }) {
  const logo = AGENT_LOGOS[id];
  if (logo !== undefined) {
    return <img class="lp-mark" src={logo} alt="" />;
  }
  const avatar = letterAvatar(label, id);
  return (
    <span class="lp-mark lp-mark--letter" style={{ color: `var(--${avatar.color})` }}>
      {avatar.letter}
    </span>
  );
}

/** A command, split so the binary reads louder than its flags. */
export function CommandLine({ command }: { command: string }) {
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
 * else the catalog's recommendation, else the bare binary.
 *
 * It calls the same `agentLaunchCommand` every launch path calls, and that is
 * the point. This row used to compute the order itself while the launch path
 * used `defaultLaunchCommand`, which knows only about the STARRED preset and
 * answers null otherwise — so Settings printed
 * `claude --dangerously-skip-permissions` on a fresh install and the pane
 * typed `claude`. A display that derives the sentence independently is a
 * promise nothing keeps.
 */
export function effectiveCommand(
  agent: BuiltinAgent,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): string {
  return agentLaunchCommand(agent.id, profiles, defaults) ?? agent.id;
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
    <Switch
      aria-label={`${agent.label} availability`}
      checked={enabled}
      title={enabled ? "Enabled in agent pickers" : "Disabled in agent pickers"}
      onCheckedChange={onChange}
    />
  );
}

/** The agents a signal adapter exists for (spec §4 stage 2, v1). */
export const ADAPTER_AGENTS: ReadonlySet<string> = new Set(["claude", "codex", "opencode"]);

/**
 * The adapters that work ONLY through an installed hook script or plugin, so
 * the host's "no hooks here" answer speaks for them and for nothing else.
 * opencode's plugin is loaded through the POSIX shell wrappers, so Windows has
 * none. Codex is excluded although it also has a hook script: its always-ring
 * launch flag (`launch-augment.ts`) is applied on every Electron host, Windows
 * included, so its switch still does something there and must keep working.
 */
export const HOOK_ONLY_ADAPTER_AGENTS: ReadonlySet<string> = new Set(["claude", "opencode"]);

/**
 * The per-agent adapter switch (agent-signal contract layer, stage 2; spec
 * §10.4): whether a launch of this agent is augmented so the CLI reports to
 * Deck — Claude's guarded user-level hooks, Codex's always-ring
 * notification flag, opencode's plugin. Off, the agent is read
 * off the process table and output timing, and its marks are drawn hollow.
 * This setting stays inside the agent details, separate from availability.
 *
 * Where the host cannot run the adapter (`available` false — Windows ships no
 * hook script) the switch keeps its place, reads off — nothing is registered,
 * so "on" would name a state that does not exist — and says why in its
 * tooltip. It is unavailable, not `disabled` (DL-23.6): it keeps its tab stop
 * so the reason is reachable by keyboard, and the press is dropped here. The
 * stored choice is left alone for a host that can honour it.
 */
function SignalsToggle({
  agent,
  on,
  available,
  onChange,
}: {
  agent: BuiltinAgent;
  on: boolean;
  available: boolean;
  onChange: (next: boolean) => void;
}) {
  const shown = available && on;
  return (
    <Switch
      aria-label={`${agent.label} signals`}
      checked={shown}
      aria-disabled={available ? undefined : true}
      title={available ? undefined : NOT_AVAILABLE_ON_WINDOWS}
      onCheckedChange={(next) => {
        if (available) {
          onChange(next);
        }
      }}
    />
  );
}

function AgentRow({
  agent,
  command,
  enabled,
  onToggle,
  signals,
  signalsAvailable,
  onSignals,
  installed,
  changed,
}: {
  agent: BuiltinAgent;
  command: string;
  /** This agent's on/off, signals or default command differs from the defaults. */
  changed: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** Null for an agent no adapter exists for; the switch is then omitted. */
  signals: boolean | null;
  /** False where the host cannot run this agent's adapter; the switch then says so. */
  signalsAvailable: boolean;
  onSignals: (next: boolean) => void;
  installed: boolean;
}) {
  const expanded = useSignal(false);
  const configureLaunch = useSignal(false);
  const offered = installOfferFor(agent.id).kind !== "none";
  const detailsRef = useRef<HTMLDivElement>(null);
  const detailsId = `agent-settings-${agent.id}`;
  useLayoutEffect(() => {
    if (configureLaunch.value && !installed) {
      detailsRef.current?.querySelector<HTMLInputElement>(".lp-agent-command input")?.focus();
    }
  }, [configureLaunch.value, installed]);

  return (
    <div class="lp-agent-item">
      <div
        class={`lp-agent ${enabled ? "" : "is-off"} ${changed ? "is-changed" : ""}`}
        data-setting={AGENT_ROW_KEYS.join(" ")}
      >
        <AgentMark id={agent.id} label={agent.label} />
        <div class="lp-agent__text">
          <span class="lp-agent__name">{agent.label}</span>
          <CommandLine command={command} />
        </div>
        <AgentInstallControl agentId={agent.id} label={agent.label} />
        <EnabledToggle agent={agent} enabled={enabled} onChange={onToggle} />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          class="lp-agent__disclosure"
          aria-label={`Configure ${agent.label}`}
          aria-expanded={expanded.value}
          aria-controls={detailsId}
          title={expanded.value ? "Hide settings" : "Configure agent"}
          onClick={() => {
            expanded.value = !expanded.value;
          }}
        >
          <DeckIcon icon={expanded.value ? CaretDown : CaretRight} size={ROW_ICON} />
        </Button>
      </div>
      {/* Keep drafts mounted when collapsed; an invalid value must survive reopening. */}
      <div ref={detailsRef} id={detailsId} class="lp-agent-details" hidden={!expanded.value}>
        {!installed && (
          <>
            <p class="lp-install-help">
              {!offered && `Install ${agent.label}, then refresh detection. `}Launch settings can be
              prepared in advance.
            </p>
            {!configureLaunch.value && (
              <ConfigRow label="Launch settings" desc="Optional before installation.">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    configureLaunch.value = true;
                  }}
                >
                  Configure launch
                </Button>
              </ConfigRow>
            )}
          </>
        )}
        <div hidden={!installed && !configureLaunch.value}>
          <AgentLaunchFlags agent={agent} command={command} />
          {installed && <RuntimeSettings agent={agent} />}
          {signals !== null && (
            <section class="lp-agent-group">
              <ConfigGroup label="Integrations" />
              <ConfigRow
                label="Signals"
                desc={
                  agent.id === "claude"
                    ? "Install Deck hooks in Claude settings for sessions opened here, including manual launches."
                    : "Use agent-reported status for new sessions. When off, Deck estimates status."
                }
              >
                <SignalsToggle
                  agent={agent}
                  on={signals}
                  available={signalsAvailable}
                  onChange={onSignals}
                />
              </ConfigRow>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function withoutKey<T>(source: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(source).filter(([entry]) => entry !== key));
}

export function RuntimeSettings({ agent }: { readonly agent: BuiltinAgent }) {
  const capability = runtimeFor(agent.id);
  const declared = settings.value.agentModels[agent.id] ?? [];
  const stored = settings.value.agentRuntimeDefaults[agent.id] ?? {
    model: null,
    effort: null,
  };
  const modelError = useSignal<string | null>(null);

  if (capability === null) return null;

  const models = modelsFor(agent.id, settings.value.agentModels);

  const saveModels = (draft: string): boolean => {
    const values = draft
      .split(",")
      .map((value) => value.trim())
      .filter((value, index, all) => value !== "" && all.indexOf(value) === index);
    if (values.some((value) => !isRuntimeValue(value))) {
      modelError.value = "Model values must be one shell-safe argument";
      return false;
    }
    modelError.value = null;
    updateSettings({
      agentModels:
        values.length === 0
          ? withoutKey(settings.value.agentModels, agent.id)
          : { ...settings.value.agentModels, [agent.id]: values },
    });
    return true;
  };

  const saveDefault = (next: AgentRuntimeDefault): void => {
    updateSettings({
      agentRuntimeDefaults:
        next.model === null && next.effort === null
          ? withoutKey(settings.value.agentRuntimeDefaults, agent.id)
          : { ...settings.value.agentRuntimeDefaults, [agent.id]: next },
    });
  };

  return (
    <section class="lp-runtime lp-agent-group" data-runtime-agent={agent.id}>
      <ConfigGroup label="Model" />
      {capability.modelFlag !== null && (models.length > 0 || stored.model !== null) ? (
        <ConfigRow
          entryOf="agentRuntimeDefaults"
          label="Default model"
          changed={stored.model !== null}
        >
          <AgentChoiceValue
            label={`Default model for ${agent.label}`}
            value={stored.model ?? ""}
            choices={[CLI_DEFAULT_CHOICE, ...models]}
            onChange={(value) => saveDefault({ ...stored, model: value || null })}
          />
        </ConfigRow>
      ) : null}
      {capability.effortFlag === null ? null : (
        <ConfigRow
          entryOf="agentRuntimeDefaults"
          label="Default effort"
          changed={stored.effort !== null}
        >
          <AgentChoiceValue
            label={`Default effort for ${agent.label}`}
            value={stored.effort ?? ""}
            choices={[CLI_DEFAULT_CHOICE, ...capability.efforts]}
            onChange={(value) => saveDefault({ ...stored, effort: value || null })}
          />
        </ConfigRow>
      )}
      {capability.modelFlag === null ? null : (
        <ConfigRow
          entryOf="agentModels"
          label="Additional models"
          desc="Model IDs, separated by commas."
          changed={declared.length > 0}
        >
          <div class="lp-models">
            <CommitInput
              ariaLabel={`Additional models for ${agent.label}`}
              placeholder="model-a, provider/model-b"
              describedBy={`agent-models-help-${agent.id}`}
              invalid={modelError.value !== null}
              value={declared.join(", ")}
              allowEmpty
              onDraftChange={() => {
                modelError.value = null;
              }}
              onCommit={saveModels}
            />
            <p id={`agent-models-help-${agent.id}`} class="lp-runtime-help">
              No spaces, quotes or brackets. Leave empty to clear added models.
            </p>
            {modelError.value !== null && (
              <p class="lp-runtime__error" role="alert">
                {modelError.value}
              </p>
            )}
          </div>
        </ConfigRow>
      )}
    </section>
  );
}

export function LaunchProfileEditor() {
  const profiles = settings.value.launchProfiles;
  const defaults = settings.value.defaultLaunchProfiles;
  const disabled = settings.value.disabledAgents;

  const refreshing = useSignal(false);

  // Asked here, once for every row below, rather than per row: the answer is a
  // property of the host, and five rows would each fire the same request.
  useEffect(() => {
    void ensureAgentHooksSupportLoaded();
  }, []);

  const installedIds = new Set(detectedAgents.value.map((agent) => agent.name));
  const installed = BUILTIN_AGENTS.filter((agent) => installedIds.has(agent.id));
  const available = BUILTIN_AGENTS.filter((agent) => !installedIds.has(agent.id));

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
    // Forced, with the boot probe's full name list: a warm cache would answer
    // within 30 s, and a built-ins-only list is a different cache key that
    // would make every custom agent read as missing.
    void probeAgentsNow().finally(() => {
      refreshing.value = false;
    });
  };

  const adapters = settings.value.agentSignalAdapters;
  const adapterOf = (agentId: string): boolean | null =>
    ADAPTER_AGENTS.has(agentId) ? adapters[agentId as keyof typeof adapters] : null;
  const setAdapter = (agentId: string, next: boolean): void => {
    if (!ADAPTER_AGENTS.has(agentId)) {
      return;
    }
    updateSettings(signalAdaptersPatch({ ...adapters, [agentId]: next }));
  };

  const renderRow = (agent: BuiltinAgent) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      command={effectiveCommand(agent, profiles, defaults)}
      enabled={!disabled.includes(agent.id)}
      onToggle={(next) => setEnabled(agent.id, next)}
      signals={adapterOf(agent.id)}
      signalsAvailable={agentHooksSupported.value || !HOOK_ONLY_ADAPTER_AGENTS.has(agent.id)}
      onSignals={(next) => setAdapter(agent.id, next)}
      installed={installedIds.has(agent.id)}
      changed={agentEntryChanged(agent.id, settings.value)}
    />
  );

  return (
    <>
      <div class="lp-head">
        <span class="lp-head__title">Installed</span>
        <span class="lp-head__count">{installed.length} detected</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="lp-head__refresh"
          aria-label="Refresh installed agents"
          disabled={refreshing.value}
          onClick={refresh}
        >
          <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
          Refresh
        </Button>
      </div>
      {installed.length === 0 ? (
        <p class="lp-empty" role="status">
          No agent CLI found on your PATH. Install one below, then Refresh.
        </p>
      ) : (
        installed.map(renderRow)
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

      <AddCommandRow />
    </>
  );
}

/** The saved-commands form: another way to launch an existing agent identity. */
export function AddCommandRow() {
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
      ...(defaults[agentId] === undefined
        ? { defaultLaunchProfiles: { ...defaults, [agentId]: id } }
        : {}),
    });
    draft.value = "";
    draftError.value = null;
  };

  return (
    <>
      <ConfigGroup label="Commands" />
      <ConfigRow
        entryOf="launchProfiles"
        label="Add command"
        desc="Save another way to launch an existing agent identity"
      >
        <div class="lp-add__controls">
          <input
            type="text"
            class="text-input lp-add__input"
            aria-label="Add command"
            placeholder="claude --plan"
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Add"
            disabled={draft.value.trim() === ""}
            onClick={add}
          >
            Add
          </Button>
        </div>
      </ConfigRow>
      {draftError.value !== null && (
        <div class="cfg-custom--error" role="alert">
          {draftError.value}
        </div>
      )}
    </>
  );
}
