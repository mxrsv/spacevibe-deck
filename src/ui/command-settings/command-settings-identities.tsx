import { useSignal } from "@preact/signals";
import { Plus, Trash } from "@phosphor-icons/react";
import type { CustomAgent } from "../../lib/agent-catalog";
import { forgetWorkspaceAgent } from "../../open-board/workspaces-store";
import { settings, updateSettings } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { Input } from "../controls/input";
import { CommitField } from "./command-settings-field";
import {
  declareAgent,
  identityCommandProblem,
  identityLabelProblem,
  removeAgentPatch,
} from "./command-settings-identity-rules";
import { RowShell } from "./command-settings-live-row";

/** The identity of a declared agent under its row: rename, retarget, remove. */
export function CustomAgentDetails({
  agent,
  locked,
}: {
  readonly agent: CustomAgent;
  readonly locked: boolean;
}) {
  const error = useSignal<string | null>(null);
  const replace = (patch: Partial<CustomAgent>, problem: string | null): boolean => {
    error.value = problem;
    if (problem !== null) return false;
    updateSettings({
      customAgents: settings.value.customAgents.map((entry) =>
        entry.id === agent.id ? { ...entry, ...patch } : entry,
      ),
    });
    return true;
  };
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex min-h-7 items-center gap-2">
        <CommitField
          aria-label={`Name for ${agent.label}`}
          draftKey={`name:${agent.id}`}
          className="w-40"
          disabled={locked}
          value={agent.label}
          onCommit={(label) =>
            replace(
              { label },
              identityLabelProblem(
                label,
                settings.value.customAgents.filter((entry) => entry.id !== agent.id),
              ),
            )
          }
        />
        <CommitField
          aria-label={`Command for ${agent.label}`}
          draftKey={`identity-command:${agent.id}`}
          className="min-w-0 flex-1"
          disabled={locked}
          spellcheck={false}
          value={agent.command}
          onCommit={(command) => replace({ command }, identityCommandProblem(command))}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${agent.label}`}
          disabled={locked}
          onClick={() => {
            updateSettings(removeAgentPatch(agent.id, settings.value));
            forgetWorkspaceAgent(agent.id);
          }}
        >
          <DeckIcon icon={Trash} size={ROW_ICON} />
        </Button>
      </div>
      {error.value === null ? null : (
        <p role="status" className="text-destructive">
          {error.value}
        </p>
      )}
    </div>
  );
}

/** Declare another CLI: a name, the command it runs, and one press (or Enter) to add it. */
export function AddAgentRow({ locked }: { readonly locked: boolean }) {
  const name = useSignal("");
  const command = useSignal("");
  const error = useSignal<string | null>(null);
  const clear = (): void => {
    name.value = "";
    command.value = "";
    error.value = null;
  };
  const add = (): void => {
    const result = declareAgent(name.value, command.value, settings.value.customAgents);
    if ("error" in result) {
      error.value = result.error;
      return;
    }
    updateSettings({ customAgents: result.agents });
    clear();
  };
  // A draft of two fields owns its Escape: the surface must not close over it.
  const keep = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && (name.value !== "" || command.value !== "")) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };
  return (
    <RowShell
      itemKey="piece:agents:identities"
      active={false}
      changed={false}
      label="Add agent"
      crumb={null}
      reset={null}
      control={
        <>
          <Input
            aria-label="New agent name"
            className="w-32"
            disabled={locked}
            placeholder="name"
            autoComplete="off"
            value={name.value}
            onInput={(event: Event) => {
              name.value = (event.target as HTMLInputElement).value;
              error.value = null;
            }}
            onKeyDown={keep}
          />
          <Input
            aria-label="New agent command"
            className="w-44"
            disabled={locked}
            placeholder="aider --model sonnet"
            autoComplete="off"
            spellcheck={false}
            value={command.value}
            onInput={(event: Event) => {
              command.value = (event.target as HTMLInputElement).value;
              error.value = null;
            }}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
                return;
              }
              keep(event);
            }}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Add agent"
            disabled={locked || (name.value.trim() === "" && command.value.trim() === "")}
            onClick={add}
          >
            <DeckIcon icon={Plus} size={ROW_ICON} />
          </Button>
        </>
      }
      below={
        error.value === null ? null : (
          <p role="status" className="text-destructive">
            {error.value}
          </p>
        )
      }
    />
  );
}
