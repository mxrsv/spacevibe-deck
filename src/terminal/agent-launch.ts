import type { DesktopPlatform } from "../lib/platform";
import { defaultPtyClient, type PtyClient } from "./pty-client";

/** macOS first-output fallback retained for compatibility. */
export const AGENT_LAUNCH_TIMEOUT_MS = 3000;
/** Windows cancels automatic launch if structured readiness never arrives. */
export const WINDOWS_AGENT_LAUNCH_TIMEOUT_MS = 15_000;

/** One pane's launch command; `command: null` arms nothing for that pane. */
export interface AgentLaunchEntry {
  readonly id: number;
  /** Verbatim command typed into the pane's shell; null arms nothing. */
  readonly command: string | null;
}

/**
 * Types the chosen agent into each new pane's interactive shell. macOS keeps
 * first-output plus timeout readiness; Windows accepts only the structured
 * prompt-ready event and permanently cancels that pane on timeout.
 */
export interface AgentLauncher {
  /** Queue each entry's command; a `null` command queues nothing for that pane. */
  arm(entries: readonly AgentLaunchEntry[]): void;
  /** A pane printed output; this is readiness only on macOS. */
  noteOutput(id: number): void;
  /** A pane emitted structured prompt readiness. */
  notePromptReady(id: number): void;
  /** Drop panes that no longer exist, cancelling their pending timers. */
  prune(alive: readonly number[]): void;
  /** Cancel every pending timer (teardown). */
  dispose(): void;
}

interface Armed {
  readonly command: string;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface LauncherState {
  readonly armed: ReadonlyMap<number, Armed>;
  readonly sawOutput: ReadonlySet<number>;
  readonly promptReady: ReadonlySet<number>;
  readonly launched: ReadonlySet<number>;
  readonly cancelled: ReadonlySet<number>;
}

export interface AgentLauncherOptions {
  readonly platform?: DesktopPlatform;
  readonly timeoutMs?: number;
  readonly onTimeout?: (id: number) => void;
}

function emptyState(): LauncherState {
  return {
    armed: new Map(),
    sawOutput: new Set(),
    promptReady: new Set(),
    launched: new Set(),
    cancelled: new Set(),
  };
}

function addId(values: ReadonlySet<number>, id: number): ReadonlySet<number> {
  return values.has(id) ? values : new Set([...values, id]);
}

function removeArmed(
  armed: ReadonlyMap<number, Armed>,
  id: number,
): ReadonlyMap<number, Armed> {
  const next = new Map(armed);
  next.delete(id);
  return next;
}

export function createAgentLauncher(
  pty: PtyClient = defaultPtyClient,
  options: AgentLauncherOptions = {},
): AgentLauncher {
  const platform = options.platform ?? "macos";
  const timeoutMs =
    options.timeoutMs ??
    (platform === "windows"
      ? WINDOWS_AGENT_LAUNCH_TIMEOUT_MS
      : AGENT_LAUNCH_TIMEOUT_MS);
  const onTimeout = options.onTimeout ?? (() => {});
  let state = emptyState();

  function fire(id: number): void {
    const entry = state.armed.get(id);
    if (entry === undefined || state.launched.has(id)) {
      return;
    }
    clearTimeout(entry.timer);
    state = {
      ...state,
      armed: removeArmed(state.armed, id),
      launched: addId(state.launched, id),
    };
    pty.writePty(id, `${entry.command}\r`).catch((err: unknown) => {
      // A failed write leaves the pane as an empty shell — never sink the tab.
      console.error("agent launch write_pty failed:", err);
    });
  }

  function expire(id: number): void {
    if (!state.armed.has(id) || state.launched.has(id)) {
      return;
    }
    if (platform !== "windows") {
      fire(id);
      return;
    }
    state = {
      ...state,
      armed: removeArmed(state.armed, id),
      cancelled: addId(state.cancelled, id),
    };
    try {
      onTimeout(id);
    } catch (error) {
      console.error("agent launch timeout callback failed:", error);
    }
  }

  return {
    arm(entries) {
      for (const { id, command } of entries) {
        if (
          command === null ||
          state.launched.has(id) ||
          state.cancelled.has(id) ||
          state.armed.has(id)
        ) {
          continue;
        }
        const timer = setTimeout(() => expire(id), timeoutMs);
        state = {
          ...state,
          armed: new Map(state.armed).set(id, { command, timer }),
        };
        const ready =
          platform === "windows"
            ? state.promptReady.has(id)
            : state.sawOutput.has(id);
        if (ready) {
          fire(id);
        }
      }
    },
    noteOutput(id) {
      state = { ...state, sawOutput: addId(state.sawOutput, id) };
      if (platform !== "windows" && state.armed.has(id)) {
        fire(id);
      }
    },
    notePromptReady(id) {
      state = { ...state, promptReady: addId(state.promptReady, id) };
      if (platform === "windows" && state.armed.has(id)) {
        fire(id);
      }
    },
    prune(alive) {
      const aliveSet = new Set(alive);
      for (const [id, entry] of state.armed) {
        if (!aliveSet.has(id)) {
          clearTimeout(entry.timer);
        }
      }
      state = {
        armed: new Map([...state.armed].filter(([id]) => aliveSet.has(id))),
        sawOutput: new Set(
          [...state.sawOutput].filter((id) => aliveSet.has(id)),
        ),
        promptReady: new Set(
          [...state.promptReady].filter((id) => aliveSet.has(id)),
        ),
        launched: new Set([...state.launched].filter((id) => aliveSet.has(id))),
        cancelled: new Set(
          [...state.cancelled].filter((id) => aliveSet.has(id)),
        ),
      };
    },
    dispose() {
      for (const entry of state.armed.values()) {
        clearTimeout(entry.timer);
      }
      state = emptyState();
    },
  };
}
