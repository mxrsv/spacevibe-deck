/**
 * The gate that decides which grabs leave the page.
 *
 * This is the security half of the browser panel and it has no other test:
 * the page in the panel is not Deck's, it can dispatch the grab event itself,
 * and what arrives on the other side is pasted into a live agent session. The
 * gate lives in the preload's isolated world precisely so the page cannot read
 * or call it — and `isTrusted` is the one bit page script cannot forge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { channel: string; payload: unknown }[] = [];

vi.mock('electron', () => ({
  ipcRenderer: {
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload });
    },
  },
}));

type Listener = (event: { detail?: unknown; isTrusted?: boolean }) => void;

/** A minimal window whose listeners the test can fire by hand. */
function installWindow(): Map<string, Listener[]> {
  const listeners = new Map<string, Listener[]>();
  (globalThis as { window?: unknown }).window = {
    addEventListener(type: string, handler: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
  };
  return listeners;
}

function fire(
  listeners: Map<string, Listener[]>,
  type: string,
  event: { detail?: unknown; isTrusted?: boolean },
): void {
  for (const handler of listeners.get(type) ?? []) {
    handler(event);
  }
}

const GRAB = 'deck:browser-grab';
const payload = JSON.stringify({ text: '[<button> in Save]' });

async function load(): Promise<Map<string, Listener[]>> {
  const listeners = installWindow();
  vi.resetModules();
  await import('./browser-preload');
  return listeners;
}

beforeEach(() => {
  sent.length = 0;
  vi.useRealTimers();
});

describe('browser preload', () => {
  it('forwards a grab that follows a real user gesture', async () => {
    const listeners = await load();
    fire(listeners, 'keydown', { isTrusted: true });
    fire(listeners, GRAB, { detail: payload });
    expect(sent).toEqual([{ channel: GRAB, payload }]);
  });

  it('drops a grab with no gesture behind it', async () => {
    // The whole forged-grab scenario: a page calls `dispatchEvent` on a timer
    // with nobody touching the keyboard.
    const listeners = await load();
    fire(listeners, GRAB, { detail: payload });
    expect(sent).toEqual([]);
  });

  it('does not accept a gesture the page synthesised', async () => {
    // `dispatchEvent(new KeyboardEvent("keydown"))` produces isTrusted false,
    // and no page script can set it true. That is what makes this a gate and
    // not a speed bump.
    const listeners = await load();
    fire(listeners, 'keydown', { isTrusted: false });
    fire(listeners, GRAB, { detail: payload });
    expect(sent).toEqual([]);
  });

  it('stops a flood even when a gesture did happen', async () => {
    const listeners = await load();
    fire(listeners, 'pointerdown', { isTrusted: true });
    for (let i = 0; i < 100; i += 1) {
      fire(listeners, GRAB, { detail: payload });
    }
    // One human gesture buys one grab, not a stream of them.
    expect(sent).toHaveLength(1);
  });

  it('stops trusting a gesture once it is stale', async () => {
    vi.useFakeTimers();
    const listeners = await load();
    fire(listeners, 'keydown', { isTrusted: true });
    vi.setSystemTime(Date.now() + 10_000);
    fire(listeners, GRAB, { detail: payload });
    expect(sent).toEqual([]);
  });

  it('ignores a payload that is not a string', async () => {
    const listeners = await load();
    fire(listeners, 'keydown', { isTrusted: true });
    fire(listeners, GRAB, { detail: { text: 'object, not the wire shape' } });
    expect(sent).toEqual([]);
  });
});
