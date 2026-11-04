import { signal } from "@preact/signals";
import type {
  AgentLaunchTarget,
  AgentLaunchPlacement,
  AgentLaunchResult,
  AgentLaunchReceipt,
  LaunchCommandOverride,
} from "../terminal/agent-launch-target";
import type { AgentLaunchRequest, AgentsLaunchResult } from "../terminal/tab-manager-types";

export interface AgentLaunchPageRequest {
  readonly target: AgentLaunchTarget;
  readonly launch: (
    agentId: string,
    canCommit: () => boolean,
    placement: AgentLaunchPlacement,
    /** The target as it stands when the press runs: a re-target may have replaced the opened one. */
    target: AgentLaunchTarget,
    /** The command a profile pick (PAGE4) asks to type instead of the agent's default. */
    override?: LaunchCommandOverride,
  ) => Promise<AgentLaunchResult>;
  /**
   * Starts several agents from `target`, left to right (the command bar's Run N). Absent on a
   * request only the one-agent launch page reads.
   */
  readonly launchMany?: (
    agents: readonly AgentLaunchRequest[],
    canCommit: () => boolean,
    /** The target as it stands when the press runs, or the split a retry resumes from. */
    target: AgentLaunchTarget,
  ) => Promise<AgentsLaunchResult>;
  /**
   * Re-captures the target for another workspace path; null when none can be
   * made. A read: it starts nothing. Absent on a request that cannot change
   * its context.
   */
  readonly retarget?: (path: string) => AgentLaunchTarget | null;
  readonly reveal: (receipt: AgentLaunchReceipt, canFocus: () => boolean) => void;
  readonly restoreFocus: (canRestore: () => boolean) => void;
  readonly releaseStage?: () => void;
  /**
   * The command bar opened on an empty stage (its resident surface). It stays resident for the
   * life of the request, so a first pane appearing mid-run does not turn it into a floating panel.
   */
  readonly resident?: boolean;
  /** Back/Escape owes the Board a return. Carried so a SECOND open — the rail
   * is not inert behind the page — inherits it instead of reading a
   * `boardOpen` the first open already cleared. */
  readonly returnToBoard?: boolean;
}

/**
 * A launch that failed before its pane existed (PAGE5): the message the page
 * shows, and the attempt `retry` repeats. No exit code — Deck does not watch
 * the PTY after spawn (decision 7).
 */
export interface LaunchFailure {
  readonly message: string;
  readonly agentId: string;
  readonly placement: AgentLaunchPlacement;
  readonly override?: LaunchCommandOverride;
  /** A several-agent attempt: what Retry still has to start, in order. `agentId` is its first. */
  readonly agents?: readonly AgentLaunchRequest[];
  /** Where a several-agent Retry resumes: beside the last pane that did open. */
  readonly target?: AgentLaunchTarget;
}

/**
 * True when a key event comes from inside a launch-page popover that is open
 * (its menu or its trigger). That popover answers Escape itself; the page and
 * the window-level shortcut handler must leave the key alone.
 */
export function eventInOpenLaunchPopover(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const popover = target.closest(
    ".agent-launch-page .nt-workspace-picker, .agent-launch-page .launch-profile",
  );
  return popover?.querySelector('[role="menu"]') != null;
}

/** A page request owns navigation until another explicit navigation supersedes it. */
export function createAgentLaunchPageStore() {
  const request = signal<AgentLaunchPageRequest | null>(null);
  const pending = signal(false);
  const failure = signal<LaunchFailure | null>(null);
  let epoch = 0;

  function open(next: AgentLaunchPageRequest): void {
    epoch += 1;
    failure.value = null;
    request.value = next;
  }

  function close(restore = false): void {
    const previous = request.value;
    epoch += 1;
    request.value = null;
    previous?.releaseStage?.();
    failure.value = null;
    // A launch in flight can no longer commit to this request, so the Run
    // guard must not outlive it: without this, reopening the page lands on a
    // disabled Run until the abandoned promise settles.
    pending.value = false;
    const closeEpoch = epoch;
    if (restore) previous?.restoreFocus(() => epoch === closeEpoch && request.value === null);
  }

  /**
   * Replaces the target in place and starts nothing. A new request object and
   * a new epoch mean a launch that began under the old target can no longer
   * commit. Refused while a launch is pending, so the page never names one
   * checkout while another is being opened.
   */
  function retarget(path: string): boolean {
    const current = request.value;
    if (current?.retarget === undefined || pending.value) return false;
    const target = current.retarget(path);
    if (target === null) return false;
    epoch += 1;
    failure.value = null;
    request.value = { ...current, target };
    return true;
  }

  /**
   * One launch attempt under the request's guard: a re-target or close while it flies drops its
   * result, and a second press while it is pending does nothing.
   */
  async function attempt(
    base: Omit<LaunchFailure, "message">,
    perform: (
      current: AgentLaunchPageRequest,
      isCurrent: () => boolean,
    ) => Promise<{ result: AgentLaunchResult; resume?: Partial<LaunchFailure> }>,
  ): Promise<void> {
    const current = request.value;
    if (current === null || pending.value) return;
    const ownEpoch = epoch;
    const isCurrent = () => epoch === ownEpoch && request.value === current;
    pending.value = true;
    failure.value = null;
    try {
      const { result, resume } = await perform(current, isCurrent);
      if (!isCurrent()) return;
      if (result.kind === "spawned") {
        request.value = null;
        current.releaseStage?.();
        current.reveal(result.receipt, () => epoch === ownEpoch && request.value === null);
      } else if (result.kind === "failed") {
        failure.value = { ...base, ...resume, message: result.message };
      }
    } catch (cause) {
      console.error("Agent launcher request failed:", cause);
      if (isCurrent()) failure.value = { ...base, message: "Could not open the agent. Try again." };
    } finally {
      // Only this request's own guard: `close()` already cleared it, and a
      // newer run may have armed it again since.
      if (epoch === ownEpoch) pending.value = false;
    }
  }

  async function run(
    agentId: string,
    placement: AgentLaunchPlacement = "target",
    override?: LaunchCommandOverride,
  ): Promise<void> {
    await attempt(
      { agentId, placement, ...(override === undefined ? {} : { override }) },
      async (current, isCurrent) => ({
        result: await current.launch(agentId, isCurrent, placement, current.target, override),
      }),
    );
  }

  /**
   * Starts several agents through `launchMany`. The pane `reveal` focuses is the first one
   * opened. When it fails after some panes exist, Retry starts only the rest, split in beside
   * the last pane that opened, so it never opens a pane twice.
   */
  async function runMany(
    agents: readonly AgentLaunchRequest[],
    placement: AgentLaunchPlacement = "target",
    from?: AgentLaunchTarget,
  ): Promise<void> {
    if (agents.length === 0) return;
    await attempt({ agentId: agents[0].agentId, placement, agents }, async (current, isCurrent) => {
      const launchMany = current.launchMany;
      if (launchMany === undefined) throw new Error("This launcher cannot start several agents");
      const result = await launchMany(agents, isCurrent, from ?? current.target);
      const [first] = result.receipts;
      if (result.kind === "spawned" && first !== undefined) {
        return { result: { kind: "spawned", receipt: first } };
      }
      if (result.kind === "failed") {
        const last = result.receipts.at(-1);
        const rest = agents.slice(result.receipts.length);
        return {
          result: { kind: "failed", message: result.message },
          resume:
            last === undefined
              ? undefined
              : {
                  agentId: rest[0].agentId,
                  agents: rest,
                  target: {
                    kind: "split",
                    workspacePath: current.target.workspacePath,
                    tabKey: last.tabKey,
                    paneId: last.paneId,
                  },
                },
        };
      }
      return { result: { kind: "cancelled" } };
    });
  }

  /** Repeats the failed attempt: the same agent(s), placement and profile pick. */
  async function retry(): Promise<void> {
    const last = failure.value;
    if (last === null) return;
    if (last.agents !== undefined) await runMany(last.agents, last.placement, last.target);
    else await run(last.agentId, last.placement, last.override);
  }

  return { request, pending, failure, open, close, retarget, run, runMany, retry };
}

export const agentLaunchPage = createAgentLaunchPageStore();
export const agentLaunchPageAvailable =
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
