import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import type { IssueSeverity, ReportedIssue } from "../../settings/command-hits";
import type { Settings } from "../../settings/settings-schema";
import { agentsProbed } from "../../terminal/agent-detection-store";
import { activeUpdateController } from "../../updater/active-update-controller";
import type { UpdatePhase } from "../../updater/update-controller";
import { agentInstalled } from "./command-settings-agents";

/*
 * The problems Needs attention reports besides shortcut conflicts. Each is read from state the
 * renderer already holds, and each names a row that resolves it: nothing here asks the host.
 *
 * Not reported, on purpose: OS notification permission, because the host only answers "supported"
 * (the OS owns authorization), so "denied" cannot be known without a new channel; the default
 * agent, because no Settings control can change it; a pinned id nothing declares any more, because
 * the Agents area cannot unpin it.
 */

/** The update phases that leave About an action to take: the phase, how loud, and what to say. */
const UPDATE_ISSUES: Readonly<
  Partial<Record<UpdatePhase, { readonly severity: IssueSeverity; readonly title: string }>>
> = {
  available: { severity: "info", title: "A Deck update is available" },
  downloaded: { severity: "info", title: "A Deck update is ready to install" },
  "download-failed": { severity: "warning", title: "The Deck update didn't download" },
  "install-failed": { severity: "warning", title: "The Deck update didn't install" },
  "relaunch-failed": { severity: "warning", title: "Deck couldn't relaunch to finish the update" },
};

function updateIssues(): readonly ReportedIssue[] {
  const view = activeUpdateController.value?.view.value;
  const found = view === undefined ? undefined : UPDATE_ISSUES[view.phase];
  // An installer that took over cannot be retried: About says what to do, with no action to take.
  if (view === undefined || found === undefined || view.installRetryable === false) return [];
  return [{ kind: "reported", id: `update:${view.phase}`, area: "about", ...found }];
}

/** Reads the detection and updater signals, so call it while rendering. */
function agentIssues(settings: Settings): readonly ReportedIssue[] {
  if (!agentsProbed.value) return [];
  const declared = [...BUILTIN_AGENTS, ...settings.customAgents];
  // Automatic pins (null) name no agent; a disabled one is out of the pickers on purpose.
  return (settings.quickAgentIds ?? []).flatMap((id): ReportedIssue[] => {
    const agent = declared.find((entry) => entry.id === id);
    if (
      agent === undefined ||
      settings.disabledAgents.includes(id) ||
      agentInstalled(id, settings)
    ) {
      return [];
    }
    return [
      {
        kind: "reported",
        id: `agent-missing:${id}`,
        severity: "warning",
        area: "agents",
        title: `${agent.label} is pinned but not installed`,
        row: `agent:${id}`,
      },
    ];
  });
}

export function reportedIssues(settings: Settings): readonly ReportedIssue[] {
  return [...updateIssues(), ...agentIssues(settings)];
}
