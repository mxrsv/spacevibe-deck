/**
 * One running `git clone`: stderr in, snapshots out, and an ending that is only
 * reported once the process is gone and its leftovers have been looked at.
 *
 * The service (`clone.ts`) owns identity, ownership and locks; this owns the
 * child. Nothing here deletes, resets or retries a user's files: a clone that
 * did not finish leaves what it wrote, and the snapshot says where.
 */
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import type { CloneError, CloneJob } from "../../src/lib/clone-contract";
import type { CloneChild, CloneDeps } from "./clone-deps";
import { classifyCloneFailure, loggableTail } from "./clone-failure";
import { createProgressParser } from "./clone-progress";

export type CloneSnapshotPatch = Partial<
  Pick<CloneJob, "phase" | "percent" | "error" | "leftoverPath" | "warnings">
>;

export interface CloneJobHooks {
  /** Folds a change into the owner's snapshot; the service numbers and emits it. */
  readonly update: (patch: CloneSnapshotPatch) => void;
  /** The child is gone: free the destination before the terminal snapshot is visible. */
  readonly release: () => void;
}

export interface RunningCloneJob {
  /** Settles (never rejects) once the terminal snapshot has been committed. */
  readonly done: Promise<void>;
  /** Synchronous: the signal is sent before this returns. Idempotent. */
  requestStop(): void;
}

type Signals = "SIGTERM" | "SIGKILL";

/** `lstat` as a yes/no; any error other than "not there" counts as present. */
async function entryExists(deps: CloneDeps, target: string, otherwise: boolean): Promise<boolean> {
  try {
    await deps.fs.lstat(target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? false : otherwise;
  }
}

export function runCloneJob(
  child: CloneChild,
  deps: CloneDeps,
  destination: string,
  hooks: CloneJobHooks,
): RunningCloneJob {
  const { idleTimeoutMs, killGraceMs, closeGraceMs } = deps.timing;
  const parser = createProgressParser();
  const decoder = new StringDecoder("utf8");
  let currentPercent: number | null = null;
  let stopRequested = false;
  let timedOut = false;
  let exited = false;
  let finalizing = false;
  let ended = false;
  let exitCode: number | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  function send(signal: Signals): void {
    try {
      deps.killTree(child, signal);
    } catch (error) {
      deps.log("Deck: clone kill failed", { signal, error: String(error) });
    }
  }

  /** SIGTERM now (git removes what it created), SIGKILL if it lingers. */
  function terminate(): void {
    if (exited || graceTimer !== undefined) {
      return;
    }
    send("SIGTERM");
    graceTimer = setTimeout(() => send("SIGKILL"), killGraceMs);
    graceTimer.unref?.();
  }

  function armIdle(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, idleTimeoutMs);
    idleTimer.unref?.();
  }

  function onStderr(chunk: Buffer | string): void {
    if (finalizing) {
      return;
    }
    armIdle();
    const progress = parser.push(typeof chunk === "string" ? chunk : decoder.write(chunk));
    if (progress !== null && !stopRequested) {
      currentPercent = progress.percent;
      hooks.update({ phase: progress.phase, percent: progress.percent });
    }
  }

  /** The terminal snapshot: frees the destination first, so a listener may start again at once. */
  function end(patch: CloneSnapshotPatch): void {
    ended = true;
    hooks.release();
    hooks.update(patch);
  }

  async function finish(): Promise<void> {
    finalizing = true;
    clearTimeout(idleTimer);
    clearTimeout(graceTimer);
    clearTimeout(closeTimer);
    const stderr = parser.tail();
    const [leftover, hasGit, hasModules] = await Promise.all([
      entryExists(deps, destination, true),
      entryExists(deps, path.join(destination, ".git"), false),
      entryExists(deps, path.join(destination, ".gitmodules"), false),
    ]);
    // Decided only now: a cancel that arrived while we inspected still wins.
    const reason = stopRequested ? "cancelled" : timedOut ? "timed-out" : null;
    // Git quotes the destination ("could not create work tree dir '…'"): a folder
    // named "http-proxy" must not read as a network error.
    const failure = classifyCloneFailure(stderr.split(destination).join("<destination>"));
    let error: CloneError | null = null;
    if (reason === "timed-out") {
      error = "timed-out";
    } else if (reason === null && exitCode !== 0) {
      error = failure;
    } else if (reason === null && (!hasGit || failure === "incomplete-checkout")) {
      error = "incomplete-checkout";
    }
    if (reason === "cancelled") {
      end({ phase: "cancelled", percent: null, leftoverPath: leftover ? destination : null });
    } else if (error !== null) {
      deps.log("Deck: clone failed", { error, exitCode, stderr: loggableTail(stderr) });
      end({
        phase: "failed",
        percent: null,
        error,
        leftoverPath: leftover && error !== "destination-exists" ? destination : null,
      });
    } else {
      end({
        phase: "succeeded",
        percent: 100,
        warnings: hasModules ? ["submodules-not-initialized"] : [],
      });
    }
  }

  function finishOnce(): void {
    if (finalizing) {
      return;
    }
    finish()
      .catch((error: unknown) => {
        deps.log("Deck: clone finish failed", { error: String(error) });
        end({ phase: "failed", percent: null, error: "unknown", leftoverPath: destination });
      })
      .finally(settle);
  }

  child.stderr?.on("data", onStderr);
  child.stderr?.on("error", () => {});
  child.on("error", (error) => {
    // After a successful spawn this is a signalling or stream failure, not an ending.
    deps.log("Deck: clone process error", { code: (error as NodeJS.ErrnoException).code });
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    clearTimeout(idleTimer);
    // `close` follows once stderr is drained; do not wait for it forever if a
    // grandchild still holds the pipe.
    closeTimer = setTimeout(finishOnce, closeGraceMs);
    closeTimer.unref?.();
  });
  child.on("close", (code) => {
    exited = true;
    exitCode ??= code;
    finishOnce();
  });
  armIdle();

  return {
    done,
    requestStop() {
      if (stopRequested || ended) {
        return;
      }
      stopRequested = true;
      hooks.update({ phase: "cancelling", percent: currentPercent });
      terminate();
    },
  };
}
