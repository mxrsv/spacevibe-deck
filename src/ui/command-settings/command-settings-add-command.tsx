import { useSignal } from "@preact/signals";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import {
  commandAgentId,
  commandProblem,
  createLaunchProfileId,
  type LaunchProfile,
} from "../../lib/launch-profile";
import type { Settings } from "../../settings/settings-schema";
import { settings, updateSettings } from "../../settings/settings-store";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Input } from "../controls/input";
import { RowShell } from "./command-settings-live-row";

/**
 * What saving a launch command writes, or why it is refused. The same rules and the same patch as
 * the legacy `AddCommandRow`: the first command saved for an agent also becomes its default.
 */
export function launchProfilePatch(
  raw: string,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): { readonly patch: Partial<Settings> } | { readonly error: string } {
  const command = raw.trim();
  const problem = commandProblem(command);
  if (problem !== null) {
    return { error: problem };
  }
  if (profiles.some((profile) => profile.command === command)) {
    return { error: "that command is already in the list" };
  }
  const id = createLaunchProfileId(command, profiles);
  const agentId = commandAgentId(command);
  return {
    patch: {
      launchProfiles: [...profiles, { id, command }],
      ...(defaults[agentId] === undefined
        ? { defaultLaunchProfiles: { ...defaults, [agentId]: id } }
        : {}),
    },
  };
}

/** Save another way to launch an existing agent: one field, Enter or the plus adds it. */
export function AddCommandRow({ locked }: { readonly locked: boolean }) {
  const draft = useSignal("");
  const error = useSignal<string | null>(null);

  const add = (): void => {
    const result = launchProfilePatch(
      draft.value,
      settings.value.launchProfiles,
      settings.value.defaultLaunchProfiles,
    );
    if ("error" in result) {
      error.value = result.error;
      return;
    }
    updateSettings(result.patch);
    draft.value = "";
    error.value = null;
  };

  return (
    <RowShell
      itemKey="piece:agents:commands"
      active={false}
      changed={false}
      label="Add command"
      crumb={null}
      reset={null}
      control={
        <>
          <Input
            aria-label="Add command"
            aria-invalid={error.value !== null || undefined}
            className="w-64"
            disabled={locked}
            placeholder="claude --plan"
            autoComplete="off"
            spellcheck={false}
            value={draft.value}
            onInput={(event: Event) => {
              draft.value = (event.target as HTMLInputElement).value;
              error.value = null;
            }}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              } else if (event.key === "Escape" && draft.value !== "") {
                // A draft owns its Escape: the surface must not close over it.
                event.preventDefault();
                event.stopPropagation();
                draft.value = "";
                error.value = null;
              }
            }}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Add"
            disabled={locked || draft.value.trim() === ""}
            onClick={add}
          >
            <DeckIcon icon={PlusSignIcon} />
          </Button>
        </>
      }
      below={
        error.value === null ? null : (
          <p role="alert" className="text-xs text-destructive">
            {error.value}
          </p>
        )
      }
    />
  );
}
