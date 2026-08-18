/**
 * Coordinator tests — translated from `src-tauri/src/coordinator.rs`.
 *
 * These assert the rules the eight-blocker review put there, so a divergence
 * shows up as a named failure rather than as a lost pane in the app.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUFFER_MAX_BYTES,
  EVENT_TRANSFER_SETTLED,
  PaneAccessError,
  TRANSFER_TIMEOUT_MS,
  WindowCoordinator,
  type AdoptionPayload,
} from './coordinator';

interface Emission {
  readonly label: string;
  readonly event: string;
  readonly payload: unknown;
}

let emissions: Emission[];
let coordinator: WindowCoordinator;

const payload = (paneId: number): AdoptionPayload => ({
  paneId,
  cwd: '/work',
  agentId: 'claude',
  scrollback: 'hello',
  cols: 80,
  rows: 24,
  tabName: 'work',
  dotColor: null,
  workspacePath: '/work',
});

const events = (label: string) => emissions.filter((e) => e.label === label);
const settledFor = (label: string) =>
  events(label).filter((e) => e.event === EVENT_TRANSFER_SETTLED);

beforeEach(() => {
  emissions = [];
  coordinator = new WindowCoordinator((label, event, data) => {
    emissions.push({ label, event, payload: data });
  });
});

describe('routing', () => {
  it('delivers output only to the owning window', () => {
    coordinator.register(1, 'main');

    coordinator.deliver(1, 'pty:output', { id: 1, data: 'x' });

    expect(emissions).toEqual([
      { label: 'main', event: 'pty:output', payload: { id: 1, data: 'x' } },
    ]);
  });

  it('never broadcasts an event for an unrouted pane', () => {
    coordinator.deliver(99, 'pty:output', { id: 99, data: 'secret' });

    expect(emissions).toEqual([]);
  });

  it('reports no owner while a transfer is open', () => {
    coordinator.register(1, 'main');
    coordinator.beginTransfer('main', 1);

    expect(coordinator.owner(1)).toBe(null);
  });

  it('refuses access to a transferring pane from every window', () => {
    coordinator.register(1, 'main');
    coordinator.beginTransfer('main', 1);

    // Including the source: mid-transfer nobody may write.
    expect(() => coordinator.assertAccess(1, 'main')).toThrow(PaneAccessError);
    expect(() => coordinator.assertAccess(1, 'deck-2')).toThrow(PaneAccessError);
  });

  it('counts a transferring pane as live for the quit census but not for close', () => {
    coordinator.register(1, 'main');
    coordinator.register(2, 'main');
    coordinator.beginTransfer('main', 1);

    // panesForWindow answers "what do I kill" — a mid-transfer pane is left
    // alone. allPanes answers "is anything busy" — missing it would kill a
    // running agent without a prompt.
    expect(coordinator.panesForWindow('main')).toEqual([2]);
    expect(coordinator.allPanes().sort()).toEqual([1, 2]);
  });
});

describe('transfer lifecycle', () => {
  it('buffers output while open, then flushes before announcing settled', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.deliver(1, 'pty:output', { id: 1, data: 'buffered' });
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');

    expect(events('deck-2')).toEqual([]);

    coordinator.commit(token, 'deck-2');

    const order = events('deck-2').map((e) => e.event);
    expect(order).toEqual(['pty:output', EVENT_TRANSFER_SETTLED]);
  });

  it('hands the route to the destination on commit', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');
    coordinator.commit(token, 'deck-2');

    expect(coordinator.owner(1)).toBe('deck-2');
  });

  it('returns the pane to its source on abort', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);

    coordinator.abort(token);

    expect(coordinator.owner(1)).toBe('main');
  });

  it('tells both ends how the transfer ended', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');
    coordinator.commit(token, 'deck-2');

    expect(settledFor('main')).toHaveLength(1);
    expect(settledFor('deck-2')).toHaveLength(1);
  });

  it('tells a reserved destination that never claimed', () => {
    // A boot-adopt window that died before claiming must learn the transfer is
    // over rather than wait out the timeout.
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.reserveDestination(token, 'deck-2');

    coordinator.abort(token);

    expect(settledFor('deck-2')).toHaveLength(1);
  });

  it('makes commit and abort idempotent by token', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');
    coordinator.commit(token, 'deck-2');

    expect(() => coordinator.commit(token, 'deck-2')).not.toThrow();
    expect(() => coordinator.abort(token)).toThrow(/already committed/);
  });

  it('rejects a claim from a second window', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');

    expect(() => coordinator.claim(token, 'deck-3')).toThrow(/already claimed/);
  });

  it('rejects a commit from a window that did not claim', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');

    expect(() => coordinator.commit(token, 'deck-3')).toThrow(
      /only be committed by the window that claimed it/,
    );
  });

  it('rejects staging by anyone but the source', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);

    expect(() => coordinator.stagePayload(token, 'deck-2', payload(1))).toThrow(
      /only be staged by window main/,
    );
  });

  it('refuses to claim before a payload is staged', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);

    expect(() => coordinator.claim(token, 'deck-2')).toThrow(/no staged payload/);
  });

  it('refuses a second transfer for the same pane', () => {
    coordinator.register(1, 'main');
    coordinator.beginTransfer('main', 1);

    expect(() => coordinator.beginTransfer('main', 1)).toThrow(/already being transferred/);
  });

  it('refuses to transfer a pane another window owns', () => {
    coordinator.register(1, 'main');

    expect(() => coordinator.beginTransfer('deck-2', 1)).toThrow(/owned by window main/);
  });
});

describe('bounds', () => {
  it('abandons a transfer that outlived the timeout', () => {
    const start = 1_000_000;
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1, start);

    coordinator.sweep(start + TRANSFER_TIMEOUT_MS);

    expect(coordinator.owner(1)).toBe('main');
    expect(settledFor('main')[0]?.payload).toMatchObject({
      outcome: 'aborted',
      reason: 'timedOut',
    });
    expect(() => coordinator.commit(token, 'deck-2')).toThrow(/was aborted/);
  });

  it('lets a pane start a new transfer after the previous one expired', () => {
    const start = 1_000_000;
    coordinator.register(1, 'main');
    coordinator.beginTransfer('main', 1, start);

    const second = coordinator.beginTransfer('main', 1, start + TRANSFER_TIMEOUT_MS);

    expect(second).not.toBe('xfer-1');
  });

  it('abandons a transfer whose buffer passes the ceiling, keeping the output', () => {
    coordinator.register(1, 'main');
    coordinator.beginTransfer('main', 1);
    const chunk = 'x'.repeat(BUFFER_MAX_BYTES + 1);

    coordinator.deliver(1, 'pty:output', { id: 1, data: chunk });

    // Losing the move is recoverable, losing output is not: the overflowing
    // chunk is flushed to the source, not dropped.
    const outputs = events('main').filter((e) => e.event === 'pty:output');
    expect(outputs).toHaveLength(1);
    expect(coordinator.owner(1)).toBe('main');
    expect(settledFor('main')[0]?.payload).toMatchObject({
      reason: 'bufferFull',
    });
  });
});

describe('window death', () => {
  it('aborts a transfer whose destination died, but not one whose source died', () => {
    coordinator.register(1, 'main');
    coordinator.register(2, 'deck-2');
    const toDeadDestination = coordinator.beginTransfer('main', 1);
    coordinator.stagePayload(toDeadDestination, 'main', payload(1));
    coordinator.claim(toDeadDestination, 'deck-2');

    const fromDeadSource = coordinator.beginTransfer('deck-2', 2);
    coordinator.stagePayload(fromDeadSource, 'deck-2', payload(2));
    coordinator.claim(fromDeadSource, 'main');

    coordinator.handleWindowDestroyed('deck-2');

    // Destination died → aborted back to main.
    expect(coordinator.owner(1)).toBe('main');
    // Source died → still open, main can commit.
    expect(() => coordinator.commit(fromDeadSource, 'main')).not.toThrow();
  });

  it('kills a pane rather than handing it back to a dead source', () => {
    // The source dies mid-transfer WITHOUT aborting — a dead source alone does
    // not end the transfer, because the destination can still claim. Then the
    // destination refuses. Settling would hand the pane back to a label that
    // no longer exists, and every later chunk would be dropped for the rest of
    // the process run, so it is killed instead.
    coordinator.register(3, 'main');
    const token = coordinator.beginTransfer('main', 3);
    coordinator.stagePayload(token, 'main', payload(3));
    coordinator.reserveDestination(token, 'deck-2');

    expect(coordinator.handleWindowDestroyed('main')).not.toContain(3);

    coordinator.abort(token);

    expect(coordinator.owner(3)).toBe(null);
    expect(coordinator.takePendingOrphans()).toContain(3);
  });

  it('reports panes orphaned by a crashed window', () => {
    coordinator.register(1, 'main');
    coordinator.register(2, 'main');

    expect(coordinator.handleWindowDestroyed('main').sort()).toEqual([1, 2]);
  });

  it('aborts transfers in either role when a window closes', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.reserveDestination(token, 'deck-2');

    coordinator.abortInvolving('deck-2');

    expect(coordinator.owner(1)).toBe('main');
    expect(settledFor('main')[0]?.payload).toMatchObject({
      reason: 'windowGone',
    });
  });
});

describe('pty exit mid-transfer', () => {
  it('keeps the route alive so the buffered exit still reaches the destination', () => {
    coordinator.register(1, 'main');
    const token = coordinator.beginTransfer('main', 1);
    coordinator.deliver(1, 'pty:output', { id: 1, data: 'last words' });
    coordinator.deliver(1, 'pty:exit', { id: 1 });
    coordinator.unregister(1);
    coordinator.stagePayload(token, 'main', payload(1));
    coordinator.claim(token, 'deck-2');

    coordinator.commit(token, 'deck-2');

    expect(events('deck-2').map((e) => e.event)).toEqual([
      'pty:output',
      'pty:exit',
      EVENT_TRANSFER_SETTLED,
    ]);
    // The deferred unregister lands on settle: no route for a dead pane.
    expect(coordinator.owner(1)).toBe(null);
  });
});
