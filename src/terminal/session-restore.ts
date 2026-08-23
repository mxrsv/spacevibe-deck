/**
 * Boot/rail restore orchestration.
 *
 * Turns the session journal's window records and per-workspace archive
 * (`session-journal.ts`, Task 4) back into live tabs: a liveness pass drops
 * dead workspaces and dead pane cwds, a single batched `resume_lookup`
 * (Tasks 5/6) matches each surviving built-in-agent pane to its previous
 * conversation, and `TabManager.materialize` (Task 3's `paneCommands`) types
 * each pane's exact resume command into its shell.
 *
 * `restoreSession` is the boot-time arm (main window only, wrapped in the
 * crash-loop marker). `resumeWorkspace` is the rail's "resume" click — the
 * same liveness/lookup/materialize core, scoped to one archived workspace,
 * with no marker, no file tabs and no active-tab selection (materialize
 * already selects the tab it just added).
 */
import { BUILTIN_AGENTS, type CustomAgent } from "../lib/agent-catalog";
import { buildResumeCommand, type ResumeRef, type ResumeRequest } from "../lib/agent-resume";
import type { resumeLookup } from "../host/resume-host";
import type { ArchiveEntry, SessionPane, SessionTab, WindowRecord } from "../lib/session-schema";
import type { FileStatResult } from "../files/file-client";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { applyResumeFlags } from "../lib/launch-command";
import { materializeChromeFrom } from "./tab-materialize";
import { noteResumedPane } from "./session-tail-store";
import { countAgentLaunch } from "../telemetry/usage-counters";
import type { TabManager } from "./tab-manager";

const BUILTIN_AGENT_IDS = new Set(BUILTIN_AGENTS.map((agent) => agent.id));

export interface RestoreDeps {
  manager: Pick<TabManager, "materialize" | "selectTab">;
  files: Pick<FileSurfaceController, "openFile" | "activateFile">;
  dirsExist(paths: readonly string[]): Promise<boolean[]>;
  /** `FileClient.statFiles`, root-scoped: call once per file surface with
   *  that surface's workspacePath as root. */
  statFiles(root: string, paths: readonly string[]): Promise<FileStatResult[]>;
  lookup: typeof resumeLookup;
  customAgents(): readonly CustomAgent[];
  journal: {
    readWindowRecords(): Promise<ReadonlyMap<string, WindowRecord>>;
    clearWindowRecord(label: string): Promise<void>;
  };
  marker: {
    /** True = a previous attempt never cleared (crash mid-restore). */
    take(): Promise<boolean>;
    set(): Promise<void>;
    clear(): Promise<void>;
  };
}

/** A SessionTab paired with the savedAt of the record it came from — the
 *  resume lookup's `lastSeenAt` ranking key. */
interface DatedTab {
  readonly tab: SessionTab;
  readonly lastSeenAt: number;
}

/** A pane after liveness has been applied. A dead cwd becomes `null` and is
 *  marked `skipLookup`: sending a stale cwd into a scanner that ranks by
 *  exact cwd match would produce a wrong or wasted match. */
interface LivePane {
  readonly cwd: string | null;
  readonly agent: string | null;
  readonly skipLookup: boolean;
  /** The command the pane was journalled with; its flags are re-applied. */
  readonly launchCommand: string | null;
}

interface LiveTab {
  readonly source: SessionTab;
  readonly lastSeenAt: number;
  readonly panes: readonly LivePane[];
}

/** Main window's tabs first (in order), then every other record newest-first. */
function mainFirstThenRecent(
  records: ReadonlyMap<string, WindowRecord>,
  mainLabel: string,
): readonly DatedTab[] {
  const main = records.get(mainLabel);
  const others = [...records]
    .filter(([label]) => label !== mainLabel)
    .map(([, record]) => record)
    .sort((a, b) => b.savedAt - a.savedAt);
  const ordered = main !== undefined ? [main, ...others] : others;
  return ordered.flatMap((record) =>
    record.tabs.map((tab) => ({ tab, lastSeenAt: record.savedAt })),
  );
}

/** Every distinct path a liveness check needs: tab workspaces, pane cwds,
 *  plus any extra paths the caller supplies (file surface workspaces). */
function livenessPaths(tabs: readonly DatedTab[], extra: readonly string[]): readonly string[] {
  const paths = new Set<string>(extra);
  for (const { tab } of tabs) {
    if (tab.workspacePath !== null) {
      paths.add(tab.workspacePath);
    }
    for (const pane of tab.panes) {
      if (pane.cwd !== null) {
        paths.add(pane.cwd);
      }
    }
  }
  return [...paths];
}

async function checkLiveness(
  dirsExist: RestoreDeps["dirsExist"],
  paths: readonly string[],
): Promise<ReadonlyMap<string, boolean>> {
  const alive = await dirsExist(paths);
  return new Map(paths.map((path, index) => [path, alive[index] ?? false]));
}

function livePaneOf(pane: SessionPane, alive: ReadonlyMap<string, boolean>): LivePane {
  if (pane.cwd !== null && alive.get(pane.cwd) !== true) {
    return {
      cwd: null,
      agent: pane.agent,
      skipLookup: true,
      launchCommand: pane.launchCommand,
    };
  }
  return {
    cwd: pane.cwd,
    agent: pane.agent,
    skipLookup: false,
    launchCommand: pane.launchCommand,
  };
}

/** Drop dead-workspace tabs; null out dead pane cwds in the survivors. */
function applyLiveness(
  tabs: readonly DatedTab[],
  alive: ReadonlyMap<string, boolean>,
): readonly LiveTab[] {
  const survivors: LiveTab[] = [];
  for (const { tab, lastSeenAt } of tabs) {
    if (tab.workspacePath !== null && alive.get(tab.workspacePath) !== true) {
      continue;
    }
    survivors.push({
      source: tab,
      lastSeenAt,
      panes: tab.panes.map((pane) => livePaneOf(pane, alive)),
    });
  }
  return survivors;
}

/** `tabIndex:paneIndex` — how a positional lookup response is zipped back. */
function paneKey(tabIndex: number, paneIndex: number): string {
  return `${tabIndex}:${paneIndex}`;
}

function buildResumeRequests(tabs: readonly LiveTab[]): {
  readonly requests: readonly ResumeRequest[];
  readonly keys: readonly string[];
} {
  const requests: ResumeRequest[] = [];
  const keys: string[] = [];
  tabs.forEach((tab, tabIndex) => {
    tab.panes.forEach((pane, paneIndex) => {
      if (pane.agent !== null && !pane.skipLookup && BUILTIN_AGENT_IDS.has(pane.agent)) {
        requests.push({
          agent: pane.agent,
          cwd: pane.cwd,
          lastSeenAt: tab.lastSeenAt,
        });
        keys.push(paneKey(tabIndex, paneIndex));
      }
    });
  });
  return { requests, keys };
}

/** One batched `resume_lookup` for every surviving built-in-agent pane. */
async function resolveRefs(
  lookup: RestoreDeps["lookup"],
  tabs: readonly LiveTab[],
): Promise<ReadonlyMap<string, ResumeRef>> {
  const { requests, keys } = buildResumeRequests(tabs);
  const refs = await lookup(requests);
  return new Map(keys.map((key, index) => [key, refs[index] ?? null]));
}

function paneCommandsFor(
  tab: LiveTab,
  tabIndex: number,
  refs: ReadonlyMap<string, ResumeRef>,
  customAgents: readonly CustomAgent[],
): readonly (string | null)[] {
  return tab.panes.map((pane, paneIndex) => {
    if (pane.agent === null) {
      return null;
    }
    const ref = refs.get(paneKey(tabIndex, paneIndex)) ?? null;
    const command = buildResumeCommand(pane.agent, ref, customAgents);
    // The pane's OWN recorded command, not its preset's current one: the
    // preset may have been edited or removed since this session started, and
    // the conversation being resumed ran under what was recorded here.
    return command === null ? null : applyResumeFlags(command, pane.launchCommand);
  });
}

/**
 * Tell the rail's tail store which panes are reopening a conversation rather
 * than starting one (2026-08-17). Without this a restored pane shows no turn
 * until the user prompts it again: the store's default rule is "never ran
 * anything, so any session lying in this cwd belongs to someone else", and a
 * resumed pane is the one case where that session IS its own.
 *
 * Keyed on the REF, not on the command: a pane whose lookup found nothing gets
 * `buildResumeCommand`'s bare form, which opens a new conversation and must
 * keep the default rule. The workspace path is the tab's, because that is the
 * coordinate the tail request itself is built from.
 */
function noteResumedPanes(
  tab: LiveTab,
  tabIndex: number,
  refs: ReadonlyMap<string, ResumeRef>,
): void {
  tab.panes.forEach((pane, paneIndex) => {
    const ref = refs.get(paneKey(tabIndex, paneIndex)) ?? null;
    if (pane.agent !== null && ref !== null) {
      noteResumedPane(tab.source.workspacePath, pane.agent);
    }
  });
}

/** Materialize every live tab sequentially. A failed materialize (thrown or
 *  returning false) skips that tab and continues — only successes count. */
async function materializeAll(
  manager: RestoreDeps["manager"],
  tabs: readonly LiveTab[],
  refs: ReadonlyMap<string, ResumeRef>,
  customAgents: readonly CustomAgent[],
): Promise<number> {
  let restored = 0;
  for (const [tabIndex, tab] of tabs.entries()) {
    const paneCommands = paneCommandsFor(tab, tabIndex, refs, customAgents);
    try {
      const ok = await manager.materialize({
        layout: tab.source.layout,
        cwds: tab.panes.map((pane) => pane.cwd),
        paneCommands,
        chrome: materializeChromeFrom(tab.source.name, tab.source.dotColor),
        ...(tab.source.workspacePath !== null ? { workspacePath: tab.source.workspacePath } : {}),
      });
      if (ok) {
        restored += 1;
        noteResumedPanes(tab, tabIndex, refs);
        // Usage analytics (spec §4): a resumed agent is a launch, counted per
        // pane that will actually type a command. Counted here rather than in
        // `materialize`, which sees only `paneCommands` and not the per-pane
        // agent ids this module still holds.
        tab.panes.forEach((pane, paneIndex) => {
          if (pane.agent !== null && paneCommands[paneIndex] !== null) {
            countAgentLaunch(pane.agent);
          }
        });
      }
    } catch (err) {
      console.error("session restore: materialize failed:", err);
    }
  }
  return restored;
}

/** Liveness → resume lookup → sequential materialize. Shared by boot restore
 *  and the rail's single-workspace resume. */
async function restoreTabs(
  deps: Pick<RestoreDeps, "manager" | "dirsExist" | "lookup" | "customAgents">,
  entries: readonly DatedTab[],
  extraLivenessPaths: readonly string[] = [],
): Promise<{
  readonly restored: number;
  readonly alive: ReadonlyMap<string, boolean>;
}> {
  const paths = livenessPaths(entries, extraLivenessPaths);
  const alive = await checkLiveness(deps.dirsExist, paths);
  const live = applyLiveness(entries, alive);
  const refs = await resolveRefs(deps.lookup, live);
  const restored = await materializeAll(deps.manager, live, refs, deps.customAgents());
  return { restored, alive };
}

/** Clear every non-main secondary window record, one at a time. A failed
 *  clear for one label must not skip the others — otherwise the next boot
 *  re-reads that stale record and folds it in again, duplicating tabs and
 *  `--resume`ing the same conversation twice. */
async function clearSecondaryRecords(
  journal: RestoreDeps["journal"],
  labels: Iterable<string>,
  mainLabel: string,
): Promise<void> {
  for (const label of labels) {
    if (label === mainLabel) {
      continue;
    }
    try {
      await journal.clearWindowRecord(label);
    } catch (err) {
      console.warn(`session restore: failed to clear window record "${label}":`, err);
    }
  }
}

function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), count - 1);
}

/** Reopen surviving file tabs from the main record only. Returns the
 *  workspace + path of `activeFileTab` when it survived, so the caller can
 *  activate it AFTER the terminal tab selection (files hold the stage last,
 *  matching the state at quit). */
async function restoreFiles(
  files: RestoreDeps["files"],
  statFiles: RestoreDeps["statFiles"],
  record: WindowRecord,
  alive: ReadonlyMap<string, boolean>,
): Promise<{ readonly workspacePath: string; readonly path: string } | null> {
  let activeTarget: { workspacePath: string; path: string } | null = null;
  for (const surface of record.files) {
    if (alive.get(surface.workspacePath) !== true) {
      continue;
    }
    const paths = surface.tabs.map((tab) => tab.path);
    if (paths.length === 0) {
      continue;
    }
    const stats = await statFiles(surface.workspacePath, paths);
    const existing = new Set(stats.filter((stat) => stat.exists).map((stat) => stat.path));
    for (const tab of surface.tabs) {
      if (!existing.has(tab.path)) {
        continue;
      }
      await files.openFile(surface.workspacePath, tab.path, !tab.preview);
      if (record.activeFileTab === tab.path) {
        activeTarget = { workspacePath: surface.workspacePath, path: tab.path };
      }
    }
  }
  return activeTarget;
}

/** Auto-restore at boot. True = at least one tab was materialized. */
export async function restoreSession(deps: RestoreDeps, mainLabel: string): Promise<boolean> {
  if (await deps.marker.take()) {
    await deps.marker.clear();
    return false;
  }
  await deps.marker.set();
  let restored = 0;
  try {
    const records = await deps.journal.readWindowRecords();
    const ordered = mainFirstThenRecent(records, mainLabel);
    if (ordered.length === 0) {
      return false;
    }

    const mainRecord = records.get(mainLabel) ?? null;
    const fileWorkspaces = mainRecord?.files.map((surface) => surface.workspacePath) ?? [];
    const result = await restoreTabs(deps, ordered, fileWorkspaces);
    restored = result.restored;

    // Clear secondary records as soon as their tabs are folded in, BEFORE
    // restoreFiles/selectTab/activateFile below — those only ever touch the
    // main record, so a throw there must not skip this clear (H2).
    await clearSecondaryRecords(deps.journal, records.keys(), mainLabel);

    const activeFileTarget =
      mainRecord !== null
        ? await restoreFiles(deps.files, deps.statFiles, mainRecord, result.alive)
        : null;

    deps.manager.selectTab(clampIndex(mainRecord?.activeTabIndex ?? 0, restored));
    if (activeFileTarget !== null) {
      deps.files.activateFile(activeFileTarget.workspacePath, activeFileTarget.path);
    }

    return restored > 0;
  } catch (err) {
    console.error("session restore failed:", err);
    return restored > 0;
  } finally {
    await deps.marker.clear();
  }
}

/** Rail click: rebuild one workspace's archived tabs (terminal only, no
 *  files, no marker — materialize already selects the new tab as it lands). */
export async function resumeWorkspace(
  deps: Pick<RestoreDeps, "manager" | "dirsExist" | "lookup" | "customAgents">,
  entry: ArchiveEntry,
  workspacePath: string,
): Promise<boolean> {
  const entries: readonly DatedTab[] = entry.tabs.map((tab) => ({
    tab,
    lastSeenAt: entry.savedAt,
  }));
  const { restored } = await restoreTabs(deps, entries, [workspacePath]);
  return restored > 0;
}
