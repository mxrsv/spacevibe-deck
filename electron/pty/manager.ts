/**
 * PTY manager — owns every live session and the paths that touch them.
 *
 * This is where `spawn_shell`, the emitter thread, `consume_shell_integration`
 * and the write/resize/kill commands from `src-tauri/src/pty.rs` come back
 * together. The Rust version splits them across threads and a mutex; here they
 * are ordinary methods on one object, because the main process is
 * single-threaded.
 *
 * The one thing that must NOT be simplified away is the exit ordering. Rust is
 * careful to flush remaining output, then emit `pty:exit`, then unregister the
 * pane — in that order — so the renderer never sees an exit for a pane whose
 * last bytes are still queued. `handleExit` keeps that order.
 */
import { EVENTS } from "../ipc/channels";
import { createStreamDecoder, OutputBatcher } from "./stream";
import { PtySessionStore, type PtySession } from "./session-store";
import { spawnShell, type SpawnOptions } from "./spawn";
import {
  validateCwdCandidates,
  type ShellIntegrationEvent,
} from "../shell-integration";
import * as macos from "../platform/macos";
import type { PsRow } from "../platform/macos";
import * as windows from "../platform/windows";

function platform() {
  return process.platform === "win32" ? windows : macos;
}

/** Delivers an event to whichever window currently owns the pane. */
export type EmitToOwner = (
  paneId: number,
  event: string,
  payload: unknown,
) => void;

export interface PtyManagerDeps {
  readonly emitToOwner: EmitToOwner;
  /** Tie a new pane to the window that asked for it. */
  readonly register: (paneId: number, windowLabel: string) => void;
  /** Forget a pane once its PTY is gone. */
  readonly unregister: (paneId: number) => void;
  /** Throws when `windowLabel` does not own `paneId`. */
  readonly assertOwner: (paneId: number, windowLabel: string) => void;
}

export class PtyManager {
  private readonly store = new PtySessionStore();

  constructor(private readonly deps: PtyManagerDeps) {}

  spawn(windowLabel: string, options: SpawnOptions): number {
    const { pty, ttyName } = spawnShell(options);
    const id = this.store.allocateId();
    const decode = createStreamDecoder();

    const batcher = new OutputBatcher({
      emit: (data) => {
        this.consumeShellIntegration(id, data);
        this.deps.emitToOwner(id, EVENTS.ptyOutput, { id, data });
      },
      pause: () => pty.pause(),
      resume: () => pty.resume(),
    });

    const session = this.store.insert({ id, pty, ttyName, batcher, decode });

    pty.onData((chunk) => {
      // Buffers on Unix (`encoding: null`), STRINGS on Windows, where node-pty
      // ignores the encoding option. `decode` takes both — see the comment on
      // `createStreamDecoder`, which is where that difference is resolved.
      batcher.push(decode(chunk as unknown as Uint8Array | string));
    });
    pty.onExit(() => this.handleExit(session));

    this.deps.register(id, windowLabel);
    return id;
  }

  write(windowLabel: string, id: number, data: string): void {
    this.deps.assertOwner(id, windowLabel);
    const session = this.requireSession(id);
    session.pty.write(data);
  }

  resize(windowLabel: string, id: number, cols: number, rows: number): void {
    this.deps.assertOwner(id, windowLabel);
    const session = this.requireSession(id);
    session.pty.resize(cols, rows);
  }

  /**
   * Kill a pane on request.
   *
   * A pane whose PTY already exited has no session and no route; Rust returns
   * Ok for exactly that case because `TerminalManager.dispose()` hits it on
   * every window close. Staying a no-op here keeps that.
   */
  kill(windowLabel: string, id: number): void {
    if (!this.store.has(id)) {
      return;
    }
    this.deps.assertOwner(id, windowLabel);
    this.terminate(id);
  }

  /**
   * Terminate without consulting ownership — used when the owning window is
   * already gone, which is precisely when there is nobody to validate against.
   *
   * `rows` is passed in rather than read here so a mass kill takes ONE process
   * table reading instead of one per pane: quitting with eight panes used to
   * fork `ps` eight times and freeze the main process for most of a second.
   * Omitting it still works — the pane is killed, only its foreground group is
   * not signalled first.
   */
  terminate(id: number, rows: readonly PsRow[] = []): void {
    const session = this.store.get(id);
    if (session === undefined) {
      return;
    }
    const foreground = platform().foregroundProcess(
      rows,
      session.ttyName,
      session.pty.pid,
    );
    platform().terminateProcessGroups(
      // `group`, never `pid`: a group MEMBER's pid is not a group id, and
      // signalling it would hit nothing.
      foreground?.group ?? null,
      session.pty.pid,
    );
    try {
      session.pty.kill();
    } catch {
      // Already dead — the outcome we wanted.
    }
  }

  /**
   * Kill every live pane, taking one process-table reading for the batch.
   *
   * A failed reading still kills: the shell's own group is signalled from the
   * session, and only the foreground-group SIGHUP is skipped. Refusing to quit
   * because `ps` failed would be worse.
   */
  async killAll(): Promise<void> {
    let rows: readonly PsRow[] = [];
    try {
      rows = await platform().readProcessTable();
    } catch {
      // Fall through with an empty table — see above.
    }
    for (const id of this.store.ids()) {
      this.terminate(id, rows);
    }
  }

  snapshots(ids: readonly number[]) {
    return this.store.snapshots(ids);
  }

  liveIds(): number[] {
    return this.store.ids();
  }

  /**
   * Flush, announce, then forget — in that order.
   *
   * Emitting `pty:exit` before the tail is flushed would let the renderer tear
   * down a pane that still has unrendered output, which is how the last lines
   * of a build log go missing.
   */
  private handleExit(session: PtySession): void {
    if (session.exited) {
      return;
    }
    session.exited = true;
    // Release any partial multibyte sequence the decoder is holding, then
    // flush — a shell that died mid-character still renders U+FFFD rather than
    // dropping the bytes.
    const tail = session.decode.flush();
    if (tail.length > 0) {
      session.batcher.push(tail);
    }
    session.batcher.flush();
    session.batcher.close();
    this.store.remove(session.id);
    this.deps.emitToOwner(session.id, EVENTS.ptyExit, { id: session.id });
    this.deps.unregister(session.id);
  }

  /**
   * Feed a decoded chunk to the pane's OSC parser and act on what comes out.
   *
   * `cwd` validation hits the filesystem, and a single batch can carry many
   * candidates, so only the last surviving one is applied — same as
   * `validate_cwd_candidates` in Rust.
   */
  private consumeShellIntegration(id: number, data: string): void {
    const session = this.store.get(id);
    if (session === undefined) {
      return;
    }
    const { parser, events } = session.shellIntegration.parse(data);
    session.shellIntegration = parser;
    if (events.length === 0) {
      return;
    }

    // Prompt-ready fires SYNCHRONOUSLY, in step with the output batch it
    // arrived in: it drives attention state, and a deferred one would race the
    // bytes that follow it.
    for (const event of events) {
      if (event.kind === "prompt-ready") {
        this.deps.emitToOwner(id, EVENTS.ptyPromptReady, { id });
      }
    }

    const candidates = events
      .filter(
        (
          event,
        ): event is Extract<
          ShellIntegrationEvent,
          { kind: "current-directory" }
        > => event.kind === "current-directory",
      )
      .map((event) => event.value);
    if (candidates.length === 0) {
      return;
    }
    // The cwd probe hits the filesystem, so it does NOT block the emit path.
    // Terminal output is untrusted, and a batch full of `OSC 9;9` pointing at
    // missing paths measured 47 ms of frozen main process each — every window
    // and every pane, for as long as the output kept coming.
    void validateCwdCandidates(candidates).then((cwd) => {
      // Re-read: the session may have exited while the probe was in flight.
      const live = this.store.get(id);
      if (live !== undefined && cwd !== null) {
        live.cwd = cwd;
      }
    });
  }

  private requireSession(id: number): PtySession {
    const session = this.store.get(id);
    if (session === undefined) {
      throw new Error(`Terminal session #${id} not found`);
    }
    return session;
  }
}
