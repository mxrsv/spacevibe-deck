import { signal } from "@preact/signals";
import type {
  AgentLaunchTarget,
  AgentLaunchPlacement,
  AgentLaunchResult,
  AgentLaunchReceipt,
} from "../terminal/agent-launch-target";

export interface AgentLaunchPageRequest {
  readonly target: AgentLaunchTarget;
  readonly launch: (
    agentId: string,
    canCommit: () => boolean,
    placement: AgentLaunchPlacement,
    /** The target as it stands when the press runs: a re-target may have replaced the opened one. */
    target: AgentLaunchTarget,
  ) => Promise<AgentLaunchResult>;
  /**
   * Re-captures the target for another workspace path; null when none can be
   * made. A read: it starts nothing. Absent on a request that cannot change
   * its context.
   */
  readonly retarget?: (path: string) => AgentLaunchTarget | null;
  readonly reveal: (receipt: AgentLaunchReceipt, canFocus: () => boolean) => void;
  readonly restoreFocus: (canRestore: () => boolean) => void;
  readonly releaseStage?: () => void;
  /** Back/Escape owes the Board a return. Carried so a SECOND open — the rail
   * is not inert behind the page — inherits it instead of reading a
   * `boardOpen` the first open already cleared. */
  readonly returnToBoard?: boolean;
}

/** A page request owns navigation until another explicit navigation supersedes it. */
export function createAgentLaunchPageStore() {
  const request = signal<AgentLaunchPageRequest | null>(null);
  const pending = signal(false);
  const error = signal<string | null>(null);
  let epoch = 0;

  function open(next: AgentLaunchPageRequest): void {
    epoch += 1;
    error.value = null;
    request.value = next;
  }

  function close(restore = false): void {
    const previous = request.value;
    epoch += 1;
    request.value = null;
    previous?.releaseStage?.();
    error.value = null;
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
    error.value = null;
    request.value = { ...current, target };
    return true;
  }

  async function run(agentId: string, placement: AgentLaunchPlacement = "target"): Promise<void> {
    const current = request.value;
    if (current === null || pending.value) return;
    const ownEpoch = epoch;
    const isCurrent = () => epoch === ownEpoch && request.value === current;
    pending.value = true;
    error.value = null;
    try {
      const result = await current.launch(agentId, isCurrent, placement, current.target);
      if (!isCurrent()) return;
      if (result.kind === "spawned") {
        request.value = null;
        current.releaseStage?.();
        current.reveal(result.receipt, () => epoch === ownEpoch && request.value === null);
      } else if (result.kind === "failed") {
        error.value = result.message;
      }
    } catch (cause) {
      console.error("Agent launcher request failed:", cause);
      if (isCurrent()) error.value = "Could not open the agent. Try again.";
    } finally {
      // Only this request's own guard: `close()` already cleared it, and a
      // newer run may have armed it again since.
      if (epoch === ownEpoch) pending.value = false;
    }
  }

  return { request, pending, error, open, close, retarget, run };
}

export const agentLaunchPage = createAgentLaunchPageStore();
export const agentLaunchPageAvailable =
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
