import { Columns } from "@phosphor-icons/react";
import { useEffect, useState } from "preact/hooks";
import { WorkspacePicker } from "../open-board/workspace-picker";
import { DeckIcon } from "../ui/controls/deck-icon";
import type { LaunchContextView } from "./agent-launch-context-model";
import { LaunchCheckoutPicker } from "./launch-checkout-picker";

export interface AgentLaunchContextProps {
  readonly context: LaunchContextView;
  readonly homeDir: string;
  readonly disabled: boolean;
  /** Both selections re-target the page. NEVER launch. */
  readonly onSelectWorkspace: (path: string) => void;
  readonly onSelectCheckout: (path: string) => void;
  /** Opens the native dialog and re-targets to the pick; rejects when the dialog fails. */
  readonly onPickFolder: () => Promise<void>;
}

/**
 * DL-32.6: the page's context row, without field labels (DL-32.2) — the
 * workspace, the checkout and a placement chip. The chip is identity, not a
 * control.
 */
export function AgentLaunchContext(props: AgentLaunchContextProps) {
  const { context } = props;
  const [failure, setFailure] = useState<string | null>(null);
  // Any re-target means the page moved on; the old dialog failure no longer applies.
  useEffect(() => setFailure(null), [context.checkoutPath]);
  const labels = new Map(context.workspaces.map((row) => [row.path, row.label]));
  const pickFolder = async (): Promise<void> => {
    try {
      await props.onPickFolder();
      setFailure(null);
    } catch (err: unknown) {
      console.warn("Folder picker failed:", err);
      setFailure("Couldn't open the folder picker — try again");
    }
  };
  return (
    <div class="agent-launch-page__context">
      <WorkspacePicker
        value={context.workspacePath}
        paths={context.workspaces.map((row) => row.path)}
        labels={labels}
        homeDir={props.homeDir}
        disabled={props.disabled}
        onSelect={props.onSelectWorkspace}
        onPickFolder={() => void pickFolder()}
      />
      {context.checkouts.length > 0 ? (
        <LaunchCheckoutPicker
          checkouts={context.checkouts}
          value={context.checkoutPath}
          disabled={props.disabled}
          onSelect={props.onSelectCheckout}
        />
      ) : null}
      <span class="agent-launch-page__chip" title={context.checkoutPath}>
        <DeckIcon icon={Columns} size={14} />
        {context.chip}
      </span>
      {failure !== null ? (
        <p class="agent-launch-page__error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
