// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings/settings-schema';
import { createPane, type PaneEvents } from './pane';

beforeAll(() => {
  // Never fires: nothing in this file resizes anything, and `fit()` is
  // already try/caught in pane.ts for the zero-sized case. This exists only
  // so the constructor at pane.ts:251 does not throw.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const silentEvents: PaneEvents = {
  onData: () => Promise.resolve(true),
  onResize: () => {},
  onFocus: () => {},
};

describe('Pane transfer primitives', () => {
  it('flush() resolves after xterm has parsed everything already written', async () => {
    const pane = createPane(1, DEFAULT_SETTINGS as Settings, silentEvents);
    pane.write('hello');
    await pane.flush();
    expect(pane.serializeScrollback(100)).toContain('hello');
    pane.dispose();
  });

  it('flush() resolves on an idle terminal with nothing queued', async () => {
    const pane = createPane(2, DEFAULT_SETTINGS as Settings, silentEvents);
    await expect(pane.flush()).resolves.toBeUndefined();
    pane.dispose();
  });

  it('serializeScrollback keeps the newest lines when the buffer is longer', async () => {
    const pane = createPane(3, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 20,
      rows: 4,
    });
    for (let i = 0; i < 40; i += 1) {
      pane.write(`line-${i}\r\n`);
    }
    await pane.flush();
    const serialized = pane.serializeScrollback(5);
    expect(serialized).toContain('line-39');
    expect(serialized).not.toContain('line-0\r');
    pane.dispose();
  });

  it('constructs at the requested geometry so an adopted pane starts at capture size', () => {
    const pane = createPane(4, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 133,
      rows: 41,
    });
    expect(pane.cols).toBe(133);
    expect(pane.rows).toBe(41);
    pane.dispose();
  });
});
