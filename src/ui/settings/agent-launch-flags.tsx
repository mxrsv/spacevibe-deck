import { useSignal } from "@preact/signals";
import { ConfigGroup, ConfigRow, ToggleRow } from "../controls/config-row";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { CommitInput } from "../controls/commit-input";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { AgentChoiceValue, CLI_DEFAULT_CHOICE } from "./agent-choice-value";
import { settings, updateSettings } from "../../settings/settings-store";
import type { BuiltinAgent } from "../../lib/agent-catalog";
import { agentLaunchCommand } from "../../lib/launch-command";
import {
  agentCommandProblem,
  effectiveLaunchProfile,
  withAgentCommand,
} from "../../lib/launch-profile";
import {
  composeLaunchFlags,
  launchFlagsFor,
  parseLaunchFlags,
  type LaunchFlag,
  type LaunchFlagValues,
} from "../../lib/launch-flags";

const CODEX_DESCRIPTIONS: Readonly<Record<string, string>> = {
  bypass: "Run without checks or sandbox.",
  approveForMe: "Review requests automatically.",
  sandbox: "Where commands may write.",
  approval: "When to ask for approval.",
  search: "Search without asking.",
  inline: "Keep terminal scrollback.",
};

/** Command-first arrangement (DECK-63, owner choice B). The controls remain
 * a view over one saved command string; no flag-specific storage is added. */
export function AgentLaunchFlags({
  agent,
  command,
}: {
  readonly agent: BuiltinAgent;
  readonly command: string;
}) {
  const resetRevision = useSignal(0);
  const error = useSignal<string | null>(null);
  const profiles = settings.value.launchProfiles;
  const defaults = settings.value.defaultLaunchProfiles;
  const parsed = parseLaunchFlags(agent.id, command);
  const own = effectiveLaunchProfile(agent.id, profiles, defaults);
  const cleared = withAgentCommand(agent.id, "", profiles, defaults);
  const fallback =
    agentLaunchCommand(agent.id, cleared.launchProfiles, cleared.defaultLaunchProfiles) ?? agent.id;

  /** Save a command for this agent; false when it is refused. */
  const save = (next: string): boolean => {
    const trimmed = next.trim();
    if (trimmed === command) {
      error.value = null;
      return true;
    }
    // Empty means remove the effective preset; only launchable text needs validation.
    const problem = trimmed === "" ? null : agentCommandProblem(agent.id, trimmed);
    if (problem !== null) {
      error.value = problem;
      return false;
    }
    error.value = null;
    updateSettings(withAgentCommand(agent.id, trimmed, profiles, defaults));
    return true;
  };

  const setFlag = (flag: LaunchFlag, value: string | null): void => {
    const values: LaunchFlagValues = { ...parsed.values, [flag.id]: value };
    if (save(composeLaunchFlags(agent.id, values, parsed.other))) {
      resetRevision.value += 1;
    }
  };

  const commitCommand = (next: string): boolean => {
    const accepted = save(next);
    if (accepted && next === "") resetRevision.value += 1;
    return accepted;
  };

  return (
    <div class="lp-launch-flags">
      <div class="lp-agent-command">
        <ConfigRow label="Command" desc="Launch command for new sessions.">
          <div class="lp-agent-command__value">
            <div class="lp-launch-flags__field">
              <CommitInput
                value={command}
                placeholder={fallback}
                ariaLabel={`Command for ${agent.label}`}
                allowEmpty
                invalid={error.value !== null}
                describedBy={error.value === null ? undefined : `agent-command-error-${agent.id}`}
                spellcheck={false}
                resetRevision={resetRevision.value}
                onDraftChange={() => {
                  error.value = null;
                }}
                onCommit={commitCommand}
              />
              {error.value !== null && (
                <p id={`agent-command-error-${agent.id}`} class="lp-runtime__error" role="alert">
                  {error.value}
                </p>
              )}
            </div>
            {own !== null && (
              <button
                type="button"
                class="cfg-btn"
                aria-label={`Reset command for ${agent.label}`}
                title={`Reset command to ${fallback}`}
                onClick={() => {
                  resetRevision.value += 1;
                  error.value = null;
                  updateSettings(cleared);
                }}
              >
                <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
              </button>
            )}
          </div>
        </ConfigRow>
      </div>
      <section class="lp-agent-group">
        <ConfigGroup label="Launch" />
        {launchFlagsFor(agent.id).map((flag) => {
          const desc =
            agent.id === "codex" ? (CODEX_DESCRIPTIONS[flag.id] ?? flag.desc) : flag.desc;
          return flag.kind === "toggle" ? (
            <ToggleRow
              key={flag.id}
              label={flag.label}
              desc={desc}
              checked={parsed.values[flag.id] !== null}
              onToggle={() => setFlag(flag, parsed.values[flag.id] === null ? "on" : null)}
            />
          ) : (
            <ConfigRow key={flag.id} label={flag.label} desc={desc}>
              <AgentChoiceValue
                label={`${flag.label} for ${agent.label}`}
                value={parsed.values[flag.id] ?? ""}
                choices={[CLI_DEFAULT_CHOICE, ...flag.options]}
                onChange={(next) => setFlag(flag, next || null)}
              />
            </ConfigRow>
          );
        })}
      </section>
    </div>
  );
}
