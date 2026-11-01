import { useSignal } from "@preact/signals";
import { Undo02Icon } from "@hugeicons/core-free-icons";
import type { BuiltinAgent } from "../../lib/agent-catalog";
import {
  composeLaunchFlags,
  launchFlagsFor,
  parseLaunchFlags,
  type LaunchFlag,
  type LaunchFlagValues,
} from "../../lib/launch-flags";
import { agentLaunchCommand } from "../../lib/launch-command";
import {
  agentCommandProblem,
  effectiveLaunchProfile,
  isRuntimeValue,
  withAgentCommand,
} from "../../lib/launch-profile";
import { modelsFor, runtimeFor, type AgentRuntimeDefault } from "../../launcher/runtime-catalog";
import { settings, updateSettings } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Switch } from "../controls/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { ChoiceSelect, CLI_DEFAULT } from "./command-settings-choice";
import { DetailRow } from "./command-settings-detail-row";
import { CommitField } from "./command-settings-field";

interface LaunchDetailsProps {
  readonly agent: BuiltinAgent;
  /** The command a new session types now. */
  readonly command: string;
  readonly locked: boolean;
}

/**
 * The launch command and the flags its CLI offers as controls. The controls are a view over the
 * one saved command string (`parseLaunchFlags` / `composeLaunchFlags`): no flag-specific storage,
 * and a hand-typed command keeps every token no control claims.
 */
export function LaunchDetails({ agent, command, locked }: LaunchDetailsProps) {
  const resetRevision = useSignal(0);
  const error = useSignal<string | null>(null);
  const { launchProfiles: profiles, defaultLaunchProfiles: defaults } = settings.value;
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
    // Empty removes the effective preset; only launchable text needs validation.
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

  return (
    <>
      <DetailRow label="Command" hint="Launch command for new sessions">
        <CommitField
          allowEmpty
          keepRefused
          aria-label={`Command for ${agent.label}`}
          draftKey={`launch:${agent.id}`}
          className="w-72"
          disabled={locked}
          spellcheck={false}
          placeholder={fallback}
          value={command}
          invalid={error.value !== null}
          resetRevision={resetRevision.value}
          onDraft={() => {
            error.value = null;
          }}
          onCommit={(next) => {
            const accepted = save(next);
            if (accepted && next === "") resetRevision.value += 1;
            return accepted;
          }}
        />
        {own === null ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={locked}
                  aria-label={`Reset command for ${agent.label}`}
                  onClick={() => {
                    resetRevision.value += 1;
                    error.value = null;
                    updateSettings(cleared);
                  }}
                />
              }
            >
              <DeckIcon icon={Undo02Icon} />
            </TooltipTrigger>
            <TooltipContent>Reset to {fallback}</TooltipContent>
          </Tooltip>
        )}
      </DetailRow>
      {error.value === null ? null : (
        <p role="alert" className="text-destructive">
          {error.value}
        </p>
      )}
      {launchFlagsFor(agent.id).map((flag) => (
        <DetailRow key={flag.id} label={flag.label} hint={flag.desc}>
          {flag.kind === "toggle" ? (
            <Switch
              aria-label={`${flag.label} for ${agent.label}`}
              disabled={locked}
              checked={parsed.values[flag.id] !== null}
              onCheckedChange={() => setFlag(flag, parsed.values[flag.id] === null ? "on" : null)}
            />
          ) : (
            <ChoiceSelect
              label={`${flag.label} for ${agent.label}`}
              disabled={locked}
              value={parsed.values[flag.id] ?? ""}
              options={[CLI_DEFAULT, ...flag.options]}
              onChange={(next) => setFlag(flag, next || null)}
            />
          )}
        </DetailRow>
      ))}
    </>
  );
}

function withoutKey<T>(source: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(source).filter(([entry]) => entry !== key));
}

/** The default model and effort an installed agent starts with, and the model ids offered to pick. */
export function RuntimeDetails({
  agent,
  locked,
}: {
  readonly agent: BuiltinAgent;
  readonly locked: boolean;
}) {
  const modelError = useSignal<string | null>(null);
  const resetRevision = useSignal(0);
  const capability = runtimeFor(agent.id);
  if (capability === null) return null;

  const declared = settings.value.agentModels[agent.id] ?? [];
  const stored = settings.value.agentRuntimeDefaults[agent.id] ?? { model: null, effort: null };
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
    <>
      {capability.modelFlag !== null && (models.length > 0 || stored.model !== null) ? (
        <DetailRow label="Model">
          <ChoiceSelect
            label={`Default model for ${agent.label}`}
            disabled={locked}
            value={stored.model ?? ""}
            options={[CLI_DEFAULT, ...models]}
            onChange={(value) => saveDefault({ ...stored, model: value || null })}
          />
        </DetailRow>
      ) : null}
      {capability.effortFlag === null ? null : (
        <DetailRow label="Effort">
          <ChoiceSelect
            label={`Default effort for ${agent.label}`}
            disabled={locked}
            value={stored.effort ?? ""}
            options={[CLI_DEFAULT, ...capability.efforts]}
            onChange={(value) => saveDefault({ ...stored, effort: value || null })}
          />
        </DetailRow>
      )}
      {capability.modelFlag === null ? null : (
        <>
          <DetailRow
            label="More models"
            hint="Model IDs, separated by commas. Leave empty to clear."
          >
            <CommitField
              allowEmpty
              keepRefused
              aria-label={`Additional models for ${agent.label}`}
              draftKey={`models:${agent.id}`}
              className="w-72"
              disabled={locked}
              spellcheck={false}
              placeholder="model-a, provider/model-b"
              value={declared.join(", ")}
              invalid={modelError.value !== null}
              resetRevision={resetRevision.value}
              onDraft={() => {
                modelError.value = null;
              }}
              onCommit={saveModels}
            />
          </DetailRow>
          {modelError.value === null ? null : (
            <p role="alert" className="text-destructive">
              {modelError.value}
            </p>
          )}
        </>
      )}
    </>
  );
}
