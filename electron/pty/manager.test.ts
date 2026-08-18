/**
 * Manager tests with a fake node-pty, so the exit ORDERING can be asserted.
 * That ordering is the part a mocked renderer suite can never see: flush, then
 * announce the exit, then drop the route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyManager } from './manager';

interface Emitted {
  readonly paneId: number;
  readonly event: string;
  readonly payload: unknown;
}

const fakePty = {
  pid: 4242,
  ptsName: '/dev/ttys999',
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};

vi.mock('./spawn', () => ({
  spawnShell: () => ({ pty: fakePty, ttyName: 'ttys999' }),
}));
const terminateSpy = vi.hoisted(() => vi.fn());
vi.mock('../platform/macos', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readProcessTable: async () => [],
  // A leader whose pid IS its group id — the ordinary case.
  foregroundProcess: () => ({ pid: 4242, group: 4242, name: 'claude' }),
  terminateProcessGroups: terminateSpy,
}));

let emitted: Emitted[];
let unregistered: number[];
let manager: PtyManager;

beforeEach(() => {
  vi.clearAllMocks();
  emitted = [];
  unregistered = [];
  manager = new PtyManager({
    emitToOwner: (paneId, event, payload) => emitted.push({ paneId, event, payload }),
    register: () => {},
    unregister: (paneId) => unregistered.push(paneId),
    assertOwner: () => {},
  });
});

/** Feed bytes through the real batcher, as node-pty's onData would. */
function fireData(text: string): void {
  const handler = fakePty.onData.mock.calls[0]?.[0] as ((chunk: unknown) => void) | undefined;
  handler?.(Buffer.from(text, 'utf8'));
}

/** Trigger the exit callback node-pty would have fired. */
function fireExit(): void {
  const handler = fakePty.onExit.mock.calls[0]?.[0] as
    ((event: { exitCode: number }) => void) | undefined;
  handler?.({ exitCode: 0 });
}

describe('PtyManager', () => {
  it('announces the exit BEFORE dropping the route', () => {
    manager.spawn('main', { cols: 80, rows: 24, cwd: null });

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(['pty:exit']);
    expect(unregistered).toEqual([1]);
  });

  it('flushes queued output BEFORE announcing the exit', () => {
    // The previous test could not see this: it never fed the batcher, so the
    // queue was empty and `flush()` was a no-op by construction — deleting the
    // flush call could not have failed it. Feed real bytes, then kill.
    manager.spawn('main', { cols: 80, rows: 24, cwd: null });
    fireData('last line of the build log\n');

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(['pty:output', 'pty:exit']);
    expect(emitted[0].payload).toMatchObject({
      data: 'last line of the build log\n',
    });
  });

  it('signals the foreground GROUP, never a member pid', () => {
    // `kill(-pid)` on a group member hits nothing, so the foreground job would
    // outlive the pane that owned it.
    const id = manager.spawn('main', { cols: 80, rows: 24, cwd: null });

    manager.kill('main', id);

    expect(terminateSpy).toHaveBeenCalledWith(4242, 4242);
  });

  it('keeps the route alive through kill so the exit still reaches the owner', () => {
    // The Tauri version unregistered inside kill_pty, so the exit event that
    // followed was dropped with "no route for pane". Here kill only
    // terminates; the exit path owns the teardown.
    const id = manager.spawn('main', { cols: 80, rows: 24, cwd: null });

    manager.kill('main', id);

    expect(unregistered).toEqual([]);

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(['pty:exit']);
    expect(unregistered).toEqual([id]);
  });

  it('runs the exit path only once', () => {
    manager.spawn('main', { cols: 80, rows: 24, cwd: null });

    fireExit();
    fireExit();

    expect(emitted).toHaveLength(1);
  });

  it('kills an unknown pane without throwing', () => {
    // TerminalManager.dispose() hits this on every window close.
    expect(() => manager.kill('main', 999)).not.toThrow();
  });

  it('refuses to write to a pane that no longer exists', () => {
    const id = manager.spawn('main', { cols: 80, rows: 24, cwd: null });
    fireExit();

    expect(() => manager.write('main', id, 'x')).toThrow(/not found/);
  });
});
