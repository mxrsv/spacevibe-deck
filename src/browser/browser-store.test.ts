import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserClient, BrowserGrab, BrowserState } from './browser-client';
import {
  activateBrowserSurface,
  browserNotice,
  browserOpen,
  browserState,
  browserSurfaceActive,
  closeBrowser,
  deactivateBrowserSurface,
  deliverGrab,
  EMPTY_STATE,
  initBrowserBridge,
  openBrowser,
  resetBrowserStore,
  type GrabTarget,
} from './browser-store';

const GRAB: BrowserGrab = {
  text: '[<button> in Save (at src/save.tsx:3:1)]',
  url: 'http://localhost:3000/',
  title: 'App',
  count: 1,
};

function state(overrides: Partial<BrowserState> = {}): BrowserState {
  return { ...EMPTY_STATE, ...overrides };
}

function fakeClient(overrides: Partial<BrowserClient> = {}): BrowserClient {
  return {
    open: vi.fn(async () => state()),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async (url: string) => url),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setBounds: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
    setInspect: vi.fn(async () => {}),
    onState: vi.fn(async () => () => {}),
    onGrab: vi.fn(async () => () => {}),
    onNavigated: vi.fn(async () => () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  resetBrowserStore();
});

describe('deliverGrab', () => {
  const target = (paneId: number | null, paste = vi.fn(async () => true)): GrabTarget => ({
    activePaneId: () => paneId,
    paste,
  });

  it('stops at the clipboard with a pane sitting right there', async () => {
    // The current behaviour (2026-08-16): a grab reaches the clipboard react-grab
    // already wrote and goes no further, so nothing a page produced can land in a
    // live agent session on its own. The non-call is the requirement.
    const paste = vi.fn(async () => true);
    expect(await deliverGrab(GRAB, target(7, paste))).toBe('clipboard');
    expect(paste).not.toHaveBeenCalled();
  });

  it('reports the clipboard when there is no pane either', async () => {
    expect(await deliverGrab(GRAB, target(null))).toBe('clipboard');
  });

  it('refuses an empty grab', async () => {
    const paste = vi.fn(async () => true);
    const outcome = await deliverGrab({ ...GRAB, text: '  ' }, target(1, paste));
    expect(outcome).toBe('failed');
    expect(paste).not.toHaveBeenCalled();
  });

  // The paste path is kept wired for the revert that flips `GRAB_PASTE_DISABLED`
  // back, so it is still exercised — through the parameter that constant feeds.
  describe('with the paste path enabled', () => {
    const deliver = (grab: BrowserGrab, to: GrabTarget) => deliverGrab(grab, to, false);

    it('pastes into the focused pane', async () => {
      const paste = vi.fn(async () => true);
      expect(await deliver(GRAB, target(7, paste))).toBe('pasted');
      expect(paste).toHaveBeenCalledWith(7, expect.stringContaining('in Save'));
    });

    it('never asks for a submit', async () => {
      // The paste seam takes no `autoSend`, so there is no argument that could
      // turn a page's text into a command an agent runs. This asserts the shape
      // stays that way.
      const paste = vi.fn(async () => true);
      await deliver(GRAB, target(7, paste));
      expect(paste).toHaveBeenCalledTimes(1);
      expect(paste.mock.calls[0]).toHaveLength(2);
    });

    it('falls back to the clipboard when there is no pane', async () => {
      // react-grab already wrote the same text to the clipboard from the page,
      // so this outcome is a message, not a recovery step.
      expect(await deliver(GRAB, target(null))).toBe('clipboard');
    });

    it('reports a paste that did not land', async () => {
      expect(
        await deliver(
          GRAB,
          target(
            1,
            vi.fn(async () => false),
          ),
        ),
      ).toBe('failed');
    });

    it('survives a paste that throws', async () => {
      const paste = vi.fn(async () => {
        throw new Error('pane went away');
      });
      expect(await deliver(GRAB, target(1, paste))).toBe('failed');
    });

    it('refuses an empty grab before touching a pane', async () => {
      const paste = vi.fn(async () => true);
      const outcome = await deliver({ ...GRAB, text: '  ' }, target(1, paste));
      expect(outcome).toBe('failed');
      expect(paste).not.toHaveBeenCalled();
    });
  });
});

describe('initBrowserBridge', () => {
  it('stores published state and summarises a delivered grab', async () => {
    let onState: ((s: BrowserState) => void) | undefined;
    let onGrab: ((g: BrowserGrab) => void) | undefined;
    const client = fakeClient({
      onState: vi.fn(async (handler: (s: BrowserState) => void) => {
        onState = handler;
        return () => {};
      }),
      onGrab: vi.fn(async (handler: (g: BrowserGrab) => void) => {
        onGrab = handler;
        return () => {};
      }),
    });
    await initBrowserBridge({
      client,
      target: { activePaneId: () => 3, paste: async () => true },
    });

    onState?.(state({ url: 'http://localhost:3000/', canGoForward: true }));
    expect(browserState.value.canGoForward).toBe(true);

    onGrab?.({ ...GRAB, count: 2 });
    await vi.waitFor(() => expect(browserNotice.value).toBe('2 elements copied to the clipboard'));
  });

  it('forwards committed navigations to the persistence seam', async () => {
    let onNavigated: ((url: string) => void) | undefined;
    const client = fakeClient({
      onNavigated: vi.fn(async (handler: (url: string) => void) => {
        onNavigated = handler;
        return () => {};
      }),
    });
    const persisted: string[] = [];
    await initBrowserBridge({
      client,
      target: { activePaneId: () => null, paste: async () => true },
      onCommittedNavigation: (url) => persisted.push(url),
    });
    onNavigated?.('http://localhost:3000/settings');
    expect(persisted).toEqual(['http://localhost:3000/settings']);
  });

  it('unsubscribes every listener on teardown', async () => {
    const stateOff = vi.fn();
    const grabOff = vi.fn();
    const navigatedOff = vi.fn();
    const client = fakeClient({
      onState: vi.fn(async () => stateOff),
      onGrab: vi.fn(async () => grabOff),
      onNavigated: vi.fn(async () => navigatedOff),
    });
    const teardown = await initBrowserBridge({
      client,
      target: { activePaneId: () => null, paste: async () => true },
    });
    teardown();
    expect(stateOff).toHaveBeenCalled();
    expect(grabOff).toHaveBeenCalled();
    expect(navigatedOff).toHaveBeenCalled();
  });
});

describe('openBrowser', () => {
  it('loads the home address the first time and nothing after', async () => {
    const client = fakeClient({
      open: vi.fn(async () => state({ url: 'http://localhost:5173/' })),
    });
    await openBrowser(client, 'http://localhost:5173');
    expect(client.open).toHaveBeenCalledWith('http://localhost:5173');
    expect(browserOpen.value).toBe(true);
    // Opening puts the surface on the stage, not just the chip on the strip.
    expect(browserSurfaceActive.value).toBe(true);

    await openBrowser(client, 'http://localhost:5173');
    // Reopening is a view toggle: it must not reload the page the user left.
    expect(client.open).toHaveBeenLastCalledWith(null);
  });

  it('stays closed when the host refuses', async () => {
    const client = fakeClient({
      open: vi.fn(async () => {
        throw new Error('no window');
      }),
    });
    await openBrowser(client, 'http://localhost:3000');
    // BOTH signals reset — a failed open must not leave a chip on the strip
    // or an active surface with no view behind it.
    expect(browserOpen.value).toBe(false);
    expect(browserSurfaceActive.value).toBe(false);
  });
});

describe('activateBrowserSurface / deactivateBrowserSurface', () => {
  it('puts an open tab back on the stage, and refuses when no tab is open', () => {
    activateBrowserSurface();
    expect(browserSurfaceActive.value).toBe(false); // no chip, nothing to show

    browserOpen.value = true;
    activateBrowserSurface();
    expect(browserSurfaceActive.value).toBe(true);
  });

  it('steps off the stage and hides the native view, keeping the chip', () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const client = fakeClient();
    deactivateBrowserSurface(client);
    expect(browserSurfaceActive.value).toBe(false);
    expect(browserOpen.value).toBe(true); // the chip stays on the strip
    expect(client.setVisible).toHaveBeenCalledWith(false);
  });

  it('is a no-op — no host call — while the surface is not on the stage', () => {
    browserOpen.value = true;
    const client = fakeClient();
    deactivateBrowserSurface(client);
    expect(client.setVisible).not.toHaveBeenCalled();
  });
});

describe('closeBrowser', () => {
  it('hides the panel and keeps the page', async () => {
    // The toggle is a view, not a session. Destroying the page here made every
    // reopen reload the home address, losing the route and the scroll position
    // — while `openBrowser`'s keep-the-page branch became unreachable.
    browserOpen.value = true;
    browserState.value = state({ url: 'http://localhost:3000/deep/route' });
    const client = fakeClient();
    await closeBrowser(client);
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(client.close).not.toHaveBeenCalled();
    expect(browserOpen.value).toBe(false);
    expect(browserSurfaceActive.value).toBe(false);
    expect(browserState.value.url).toBe('http://localhost:3000/deep/route');
  });

  it('reopening after a hide asks for no URL', async () => {
    const client = fakeClient({
      open: vi.fn(async () => state({ url: 'http://localhost:3000/deep/route' })),
    });
    browserState.value = state({ url: 'http://localhost:3000/deep/route' });
    await closeBrowser(client);
    await openBrowser(client, 'http://localhost:5173');
    expect(client.open).toHaveBeenCalledWith(null);
  });

  it('closes the panel even if the host refuses to hide it', async () => {
    browserOpen.value = true;
    browserNotice.value = 'something';
    const client = fakeClient({
      setVisible: vi.fn(async () => {
        throw new Error('gone');
      }),
    });
    await closeBrowser(client);
    expect(browserOpen.value).toBe(false);
    expect(browserNotice.value).toBeNull();
  });
});
