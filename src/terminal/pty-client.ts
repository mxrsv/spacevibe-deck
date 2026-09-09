import { invoke, listen, type UnlistenFn } from "../host/bridge";
import type { PaneProcessInfo } from "../lib/process-info";
import type { AgentProcessMatcher } from "../lib/agent-catalog";
export type { AgentProcessMatcher } from "../lib/agent-catalog";

/** Mirror of the Rust `AgentInfo` payload from `detect_agents`. */
export interface DetectedAgent {
  readonly name: string;
  readonly path: string;
}

export interface PtySessionCwd {
  readonly id: number;
  readonly cwd: string | null;
}

/** PTY + process-info seam used by TabManager / TerminalManager / close paths. */
export interface PtyClient {
  spawnShell(opts: { cols: number; rows: number; cwd: string | null }): Promise<number>;
  writePty(id: number, data: string): Promise<void>;
  resizePty(id: number, cols: number, rows: number): Promise<void>;
  killPty(id: number): Promise<void>;
  /**
   * End the agent process in a pane, leaving the pane's shell alive
   * (spec §5.6) — the Agent Board's Stop.
   *
   * Electron-only: no `#[tauri::command]` counterpart exists and Tauri is
   * feature-frozen, so the member is ABSENT there and every call site uses
   * `?.()`. That optional call is how "this host cannot do it" is said, the way
   * `sessionCwds` below says it.
   */
  killForeground?(id: number): Promise<void>;
  /** Fresh pty_info; throws on IPC failure (poll keeps last-known on catch). */
  ptyInfo(
    ids: readonly number[],
    agentMatchers?: readonly AgentProcessMatcher[],
    waitForCwd?: boolean,
  ): Promise<PaneProcessInfo[]>;
  /** Electron-only cheap session CWDs; absent on the feature-frozen Tauri host. */
  sessionCwds?(ids: readonly number[]): Promise<readonly PtySessionCwd[]>;
  gitBranch(cwd: string): Promise<string | null>;
  /**
   * Which of `paths` are still existing directories, positionally.
   * Session restore uses this to discard deleted workspaces before asking the
   * host to spawn; both hosts also reject an explicit missing CWD.
   */
  dirsExist(paths: readonly string[]): Promise<boolean[]>;
  /**
   * Which of `names` are on the login shell's `$PATH`, in probe order.
   * Rust always probes the built-ins on top of whatever is passed, and
   * re-filters every name — see `probe_names` in agents.rs.
   */
  detectAgents(names: readonly string[]): Promise<DetectedAgent[]>;
  /** Answer a `quit-requested` — `requestId` echoes the one Rust sent. */
  confirmQuit(requestId: number): Promise<void>;
  cancelQuit(requestId: number): Promise<void>;
  /** Answer a `window:close-requested` for THIS window only. */
  confirmCloseWindow(requestId: number): Promise<void>;
  cancelCloseWindow(requestId: number): Promise<void>;
  listenOutput(handler: (id: number, data: string) => void): Promise<UnlistenFn>;
  listenPromptReady(handler: (id: number) => void): Promise<UnlistenFn>;
  /**
   * A pane's PTY exited. `exitCode` is the status the host reported, or null
   * when it reported none — Tauri's `ExitPayload` carries only the id, and
   * the tracker records that as "unknown" rather than guessing zero
   * (agent-signal contract layer, stage 0, 2026-09-03).
   */
  listenExit(handler: (id: number, exitCode: number | null) => void): Promise<UnlistenFn>;
}

interface OutputPayload {
  id: number;
  data: string;
}

interface ExitPayload {
  id: number;
  /** Electron adds it (`electron/pty/manager.ts`); Tauri does not. */
  exitCode?: number;
}

/** The status off the wire, or null for a host that sends none. */
function exitCodeOf(payload: ExitPayload): number | null {
  return typeof payload.exitCode === "number" && Number.isFinite(payload.exitCode)
    ? payload.exitCode
    : null;
}

interface PromptReadyPayload {
  id: number;
}

/** Production adapter — Tauri IPC. */
export function createTauriPtyClient(): PtyClient {
  const electronSessionCwds: Pick<PtyClient, "sessionCwds"> =
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
      ? {
          async sessionCwds(ids) {
            if (ids.length === 0) {
              return [];
            }
            const value = await invoke<unknown>("pty_cwds", { ids: [...ids] });
            if (
              !Array.isArray(value) ||
              !value.every(
                (row) =>
                  typeof row === "object" &&
                  row !== null &&
                  "id" in row &&
                  Number.isSafeInteger(row.id) &&
                  row.id > 0 &&
                  "cwd" in row &&
                  (typeof row.cwd === "string" || row.cwd === null),
              )
            ) {
              throw new TypeError("Invalid pty_cwds response");
            }
            return value as PtySessionCwd[];
          },
        }
      : {};
  return {
    spawnShell({ cols, rows, cwd }) {
      return invoke<number>("spawn_shell", { cols, rows, cwd });
    },
    writePty(id, data) {
      return invoke("write_pty", { id, data });
    },
    resizePty(id, cols, rows) {
      return invoke("resize_pty", { id, cols, rows });
    },
    killPty(id) {
      return invoke("kill_pty", { id });
    },
    // Implemented unconditionally, unlike `sessionCwds` below: this factory is
    // the ONE production client — both hosts run it, and `invoke` goes through
    // `__deckHost`, which is the Electron path. Its name is historical, so a
    // no-op "for Tauri" here would disable Stop on the only host that has it.
    killForeground(id) {
      return invoke("pty_kill_foreground", { id });
    },
    async ptyInfo(ids, agentMatchers = [], waitForCwd = true) {
      if (ids.length === 0) {
        return [];
      }
      return invoke<PaneProcessInfo[]>("pty_info", {
        ids: [...ids],
        agents: [...agentMatchers],
        waitForCwd,
      });
    },
    ...electronSessionCwds,
    gitBranch(cwd) {
      return invoke<string | null>("git_branch", { cwd });
    },
    async dirsExist(paths) {
      if (paths.length === 0) {
        return [];
      }
      return invoke<boolean[]>("dirs_exist", { paths: [...paths] });
    },
    detectAgents(names) {
      return invoke<DetectedAgent[]>("detect_agents", { names: [...names] });
    },
    confirmQuit(requestId) {
      return invoke("confirm_quit", { requestId });
    },
    cancelQuit(requestId) {
      return invoke("cancel_quit", { requestId });
    },
    confirmCloseWindow(requestId) {
      return invoke("confirm_close_window", { requestId });
    },
    cancelCloseWindow(requestId) {
      return invoke("cancel_close_window", { requestId });
    },
    listenOutput(handler) {
      return listen<OutputPayload>("pty:output", (event) => {
        handler(event.payload.id, event.payload.data);
      });
    },
    listenPromptReady(handler) {
      return listen<PromptReadyPayload>("pty:prompt-ready", (event) => {
        handler(event.payload.id);
      });
    },
    listenExit(handler) {
      return listen<ExitPayload>("pty:exit", (event) => {
        handler(event.payload.id, exitCodeOf(event.payload));
      });
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryPtyClient(
  options: {
    nextId?: number;
    infos?: ReadonlyMap<number, PaneProcessInfo>;
    agents?: readonly DetectedAgent[];
    /** Directories that "exist"; omitted = every path exists. */
    dirs?: readonly string[];
  } = {},
): PtyClient & {
  readonly sessions: Map<number, { cwd: string | null }>;
  /** Every `writePty` call in order — agent-launch tests assert against it. */
  readonly writes: { id: number; data: string }[];
  emitOutput(id: number, data: string): void;
  emitPromptReady(id: number): void;
  emitExit(id: number, exitCode?: number | null): void;
} {
  let nextId = options.nextId ?? 1;
  const sessions = new Map<number, { cwd: string | null }>();
  const writes: { id: number; data: string }[] = [];
  const infos = new Map(options.infos ?? []);
  const outputHandlers = new Set<(id: number, data: string) => void>();
  const promptReadyHandlers = new Set<(id: number) => void>();
  const exitHandlers = new Set<(id: number, exitCode: number | null) => void>();

  return {
    sessions,
    writes,
    async spawnShell({ cwd }) {
      const id = nextId;
      nextId += 1;
      sessions.set(id, { cwd });
      return id;
    },
    async writePty(id, data) {
      writes.push({ id, data });
    },
    async resizePty() {},
    async killPty(id) {
      sessions.delete(id);
    },
    async ptyInfo(ids) {
      return ids.flatMap((id) => {
        const info = infos.get(id);
        return info ? [info] : [];
      });
    },
    async gitBranch() {
      return null;
    },
    async dirsExist(paths) {
      const dirs = options.dirs;
      return paths.map((path) => dirs === undefined || dirs.includes(path));
    },
    async detectAgents(names) {
      // Mirrors the real backend: it answers only about what was probed, so a
      // test that declares an agent has to pass its binary to see it back.
      const probed = new Set(names);
      return [...(options.agents ?? [])].filter((agent) => probed.has(agent.name));
    },
    async confirmQuit() {},
    async cancelQuit() {},
    async confirmCloseWindow() {},
    async cancelCloseWindow() {},
    async listenOutput(handler) {
      outputHandlers.add(handler);
      return () => {
        outputHandlers.delete(handler);
      };
    },
    async listenPromptReady(handler) {
      promptReadyHandlers.add(handler);
      return () => {
        promptReadyHandlers.delete(handler);
      };
    },
    async listenExit(handler) {
      exitHandlers.add(handler);
      return () => {
        exitHandlers.delete(handler);
      };
    },
    emitOutput(id, data) {
      for (const handler of outputHandlers) {
        handler(id, data);
      }
    },
    emitPromptReady(id) {
      for (const handler of promptReadyHandlers) {
        handler(id);
      }
    },
    emitExit(id, exitCode = null) {
      for (const handler of exitHandlers) {
        handler(id, exitCode);
      }
    },
  };
}

/** Shared production client — factories accept an override for tests. */
export const defaultPtyClient: PtyClient = createTauriPtyClient();
