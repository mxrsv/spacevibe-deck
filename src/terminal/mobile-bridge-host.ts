/**
 * Builds this window's `MobileBridge` from the live stores and the host facade, and listens for
 * what main pushes to it. Kept out of `tab-manager.ts`, which only supplies what is local to it:
 * which panes it holds, how to snapshot one, and the pane client whose `writePty` notes input.
 *
 * Inert where the Electron bridge is absent (the browser preview, tests): the listeners do not
 * attach and the reports are dropped.
 */
import {
  listenMobileInput,
  listenMobileQueries,
  listenMobileStreamSubscribe,
  listenMobileStreamUnsubscribe,
  reportMobileQuery,
  sendMobileStreamData,
} from "../host/mobile-host";
import type { UnlistenFn } from "../host/bridge";
import { agentOptions, BUILTIN_AGENTS, probeNames, type CustomAgent } from "../lib/agent-catalog";
import { workspaceLabel } from "../lib/workspace-label";
import { workspacesData } from "../open-board/workspaces-store";
import { defaultRepositoryClient } from "../repositories/repository-client";
import { repositoryScans } from "../repositories/repositories-store";
import { settings } from "../settings/settings-store";
import { ensureAgentsDetected } from "./agent-detection-store";
import { createMobileBridge, type MobileBridge, type MobileBridgeDeps } from "./mobile-bridge";
import { phoneAgentChoices } from "./mobile-tree";
import { activeTabIndex, tabViews } from "./tabs-store";

/** What only the tab manager knows. */
export type MobilePaneAccess = Pick<
  MobileBridgeDeps,
  "screenText" | "hasPane" | "paneSize" | "snapshot" | "writePty"
>;

function agentLabelFor(agentId: string, customAgents: readonly CustomAgent[]): string | null {
  return (
    BUILTIN_AGENTS.find((agent) => agent.id === agentId)?.label ??
    customAgents.find((agent) => agent.id === agentId)?.label ??
    null
  );
}

export function createHostedMobileBridge(panes: MobilePaneAccess): MobileBridge {
  return createMobileBridge({
    ...panes,
    tabs: () => tabViews.value,
    activeIndex: () => activeTabIndex.value,
    scans: () => repositoryScans.value,
    workspacePaths: () => {
      const open = tabViews.value.flatMap((tab) =>
        tab.workspacePath === null ? [] : [tab.workspacePath],
      );
      return [...new Set([...open, ...workspacesData.value.recents.map((entry) => entry.path)])];
    },
    scanRepository: (path) => defaultRepositoryClient.scan(path),
    workspaceLabel,
    agentChoices: async () => {
      const { customAgents, disabledAgents } = settings.value;
      const detected = await ensureAgentsDetected(probeNames(customAgents));
      return phoneAgentChoices(agentOptions(detected, customAgents, disabledAgents));
    },
    agentLabel: (agentId) => agentLabelFor(agentId, settings.value.customAgents),
    reportQuery: reportMobileQuery,
    sendStream: sendMobileStreamData,
  });
}

/** Attaches the four listeners main's pushes arrive on; resolves to their unlisteners. */
export async function listenForMobile(bridge: MobileBridge): Promise<UnlistenFn[]> {
  return Promise.all([
    listenMobileQueries((payload) => bridge.handleQuery(payload)),
    listenMobileStreamSubscribe((payload) => bridge.handleSubscribe(payload)),
    listenMobileStreamUnsubscribe((payload) => bridge.handleUnsubscribe(payload)),
    listenMobileInput((payload) => bridge.handleInput(payload)),
  ]);
}
