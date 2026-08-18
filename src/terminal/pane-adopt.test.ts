import { describe, expect, it } from 'vitest';
import { createMemoryTransferClient, type AdoptionPayload } from './transfer-client';
import { adoptTransfer, type AdoptDeps } from './pane-adopt';
import type { Pane } from './pane';

const payload: AdoptionPayload = {
  paneId: 7,
  cwd: '/repo',
  agentId: 'claude',
  scrollback: 'SCROLLBACK',
  cols: 120,
  rows: 40,
  tabName: 'deck',
  dotColor: 'cyan',
  workspacePath: '/repo',
};

function harness() {
  const order: string[] = [];
  const written: string[] = [];
  const transfer = createMemoryTransferClient();
  const messages: string[] = [];
  const pane = {
    id: 7,
    write: (data: string) => {
      order.push('replay');
      written.push(data);
    },
    writeln: (line: string) => void written.push(line),
    flush: () => {
      order.push('flush');
      return Promise.resolve();
    },
    fit: () => order.push('fit'),
  } as unknown as Pane;
  const discarded: number[] = [];
  const deps: AdoptDeps = {
    transfer,
    holdWrites: () => {
      order.push('hold');
      return () => order.push('release-hold');
    },
    adopt: (received) => {
      order.push(`adopt:${received.cols}x${received.rows}`);
      return pane;
    },
    place: () => order.push('place'),
    discard: (id) => {
      order.push('discard');
      discarded.push(id);
    },
    report: (message) => void messages.push(message),
  };
  return { order, written, transfer, deps, discarded, messages };
}

async function stage(transfer: ReturnType<typeof createMemoryTransferClient>) {
  const token = await transfer.prepareTransfer(7);
  await transfer.stageTransfer(token, payload);
  transfer.calls.length = 0;
  return token;
}

describe('adoptTransfer happy path', () => {
  it('claims, builds at capture geometry, replays before placing, then commits and fits', async () => {
    const h = harness();
    const token = await stage(h.transfer);

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: 'adopted',
      paneId: 7,
      payload,
    });

    expect(h.order).toEqual([
      'hold',
      'adopt:120x40',
      'replay',
      'flush',
      'place',
      'release-hold',
      'fit',
    ]);
    expect(h.written).toEqual(['SCROLLBACK']);
    expect(h.transfer.calls).toEqual([`claim:${token}`, `commit:${token}`]);
  });

  it('skips the replay write entirely when the payload carries no scrollback', async () => {
    const h = harness();
    const token = await h.transfer.prepareTransfer(7);
    await h.transfer.stageTransfer(token, { ...payload, scrollback: '' });

    await adoptTransfer(token, h.deps);

    expect(h.order).not.toContain('replay');
    expect(h.written[0]).toContain('Scrollback could not be restored');
  });
});

describe('adoptTransfer failure injection', () => {
  it('fails without building anything when claim is rejected', async () => {
    const h = harness();
    h.transfer.failNext('claimTransfer', 'unknown token');

    await expect(adoptTransfer('token-x', h.deps)).resolves.toEqual({
      kind: 'failed',
      reason: 'claim-failed',
    });
    expect(h.order).toEqual([]);
    expect(h.discarded).toEqual([]);
  });

  it('aborts and discards the half-built pane when commit is rejected', async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.transfer.failNext('commitTransfer', 'token expired');

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: 'failed',
      reason: 'commit-failed',
    });
    expect(h.discarded).toEqual([7]);
    expect(h.transfer.calls).toContain(`abort:${token}`);
    expect(h.messages[0]).toContain('did not arrive');
    expect(h.order).toContain('release-hold');
  });

  it('aborts when the pane cannot be built at all', async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.deps.adopt = () => {
      throw new Error('out of memory');
    };

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: 'failed',
      reason: 'adopt-failed',
    });
    expect(h.transfer.calls).toContain(`abort:${token}`);
  });

  it('still commits when the replay write throws — history is not worth the session', async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.deps.adopt = () =>
      ({
        id: 7,
        write: () => {
          throw new Error('parser rejected the frame');
        },
        writeln: () => {},
        flush: () => Promise.resolve(),
        fit: () => {},
      }) as unknown as Pane;

    await expect(adoptTransfer(token, h.deps)).resolves.toMatchObject({
      kind: 'adopted',
      paneId: 7,
    });
    expect(h.transfer.calls).toContain(`commit:${token}`);
  });
});
