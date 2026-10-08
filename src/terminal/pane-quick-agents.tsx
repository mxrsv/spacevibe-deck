import { useRef } from "preact/hooks";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../ui/controls/action-tooltip";
import { agentOptions, type AgentOption } from "../lib/agent-catalog";
import { agentLaunchCommand } from "../lib/launch-command";
import { quickAgentOptions } from "../settings/quick-agents";
import { settings } from "../settings/settings-store";
import { detectedAgents } from "./agent-detection-store";
import { reportChromeMessage } from "../chrome/events";

interface QuickAgentInput {
  send(data: string): Promise<boolean>;
  focus(): void;
}

const START_FAILED = "Could not start the agent. The pane is still a plain shell.";

/** The pinned, installed agents — the list Settings → Quick agents edits. */
function pinnedAgents(): readonly AgentOption[] {
  const current = settings.value;
  return quickAgentOptions(
    agentOptions(detectedAgents.value, current.customAgents, current.disabledAgents),
    current.quickAgentIds,
  );
}

function QuickAgentButton({
  paneId,
  agent,
  input,
}: {
  paneId: number;
  agent: AgentOption;
  input: QuickAgentInput;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const tooltipId = `pane-quick-tip-${paneId}-${agent.id}`;
  const label = `Run ${agent.label} here`;
  async function run() {
    const current = settings.value;
    const command = agentLaunchCommand(
      agent.id,
      current.launchProfiles,
      current.defaultLaunchProfiles,
      current.customAgents,
    );
    if (command === null) {
      reportChromeMessage(START_FAILED);
      return;
    }
    input.focus();
    try {
      // The same line `AgentLauncher.arm` types into a fresh shell.
      if (!(await input.send(`${command}\r`))) reportChromeMessage(START_FAILED);
    } catch (error) {
      console.warn("Quick agent launch failed", error);
      reportChromeMessage(START_FAILED);
    }
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="pane-agent-header__act pane-quick-agents__agent"
        aria-label={label}
        aria-describedby={tooltip.anchor !== null ? tooltipId : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={() => void run()}
      >
        <AgentGlyph agent={agent.id} className="pane-quick-agents__logo" />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={label}
          shortcut={null}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

/**
 * The header of a plain shell pane in a split tab: one logo per pinned agent,
 * pressing one types that agent's launch command into this pane's shell. The
 * container stops `pointerdown`/`mousedown` like the pane actions, since the
 * bar is the pane's drag handle.
 */
export function PaneQuickAgents({ paneId, input }: { paneId: number; input: QuickAgentInput }) {
  return (
    <div
      class="pane-quick-agents"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {pinnedAgents().map((agent) => (
        <QuickAgentButton key={agent.id} paneId={paneId} agent={agent} input={input} />
      ))}
    </div>
  );
}
