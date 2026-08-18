/**
 * Live PTY sessions — the Node counterpart of `PtyState` in
 * `src-tauri/src/pty.rs`.
 *
 * Rust guards this map with a `Mutex` and most of its subtlety comes from
 * that: which drops happen inside the guard, which filesystem calls must run
 * outside it, and why a poisoned lock has to be reported rather than swallowed.
 * None of that applies here — the main process is single-threaded, so the map
 * is a plain `Map` and the hazard class disappears with the lock.
 *
 * What does carry over is the id contract: ids are process-local integers
 * starting at 1, never reused, and they are what every renderer message keys
 * on.
 */
import type { IPty } from 'node-pty';
import type { OutputBatcher, StreamDecoder } from './stream';
import { ShellIntegrationParser } from '../shell-integration';

export interface PtySession {
  readonly id: number;
  readonly pty: IPty;
  /** `/dev/ttysNNN` without the `/dev/` prefix — the join key for `ps`. */
  readonly ttyName: string;
  readonly batcher: OutputBatcher;
  /** Streaming UTF-8 decoder; its held-back tail is released at exit. */
  readonly decode: StreamDecoder;
  /** Latest parser state; replaced on every chunk (the parser is a value). */
  shellIntegration: ShellIntegrationParser;
  /** Last directory reported by OSC 9;9 that still exists. */
  cwd: string | null;
  /** Set once the exit path has run, so it cannot run twice. */
  exited: boolean;
}

export interface PtySessionSnapshot {
  readonly id: number;
  readonly pid: number;
  readonly ttyName: string;
  readonly cwd: string | null;
}

export class PtySessionStore {
  private readonly sessions = new Map<number, PtySession>();
  private nextId = 1;

  /** Ids are never reused: a stale renderer message must not land on a new pane. */
  allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  insert(session: Omit<PtySession, 'shellIntegration' | 'cwd' | 'exited'>): PtySession {
    const full: PtySession = {
      ...session,
      shellIntegration: new ShellIntegrationParser(),
      cwd: null,
      exited: false,
    };
    this.sessions.set(full.id, full);
    return full;
  }

  get(id: number): PtySession | undefined {
    return this.sessions.get(id);
  }

  remove(id: number): PtySession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }

  has(id: number): boolean {
    return this.sessions.has(id);
  }

  ids(): number[] {
    return [...this.sessions.keys()];
  }

  snapshots(ids: readonly number[]): PtySessionSnapshot[] {
    return ids.flatMap((id) => {
      const session = this.sessions.get(id);
      return session === undefined
        ? []
        : [
            {
              id: session.id,
              pid: session.pty.pid,
              ttyName: session.ttyName,
              cwd: session.cwd,
            },
          ];
    });
  }
}
