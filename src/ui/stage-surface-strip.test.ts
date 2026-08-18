import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceStrip } from '../terminal/tab-manager';
import type { BrowserClient, BrowserState } from '../browser/browser-client';
import {
  browserOpen,
  browserSurfaceActive,
  EMPTY_STATE,
  resetBrowserStore,
} from '../browser/browser-store';
import { composeSurfaceStrip } from './stage-surface-strip';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';

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

function fakeFiles(overrides: Partial<SurfaceStrip> = {}): SurfaceStrip {
  return {
    count: vi.fn(() => 2),
    total: vi.fn(() => 3),
    activeIndex: vi.fn(() => -1),
    activate: vi.fn(),
    deactivate: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    applySettings: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetBrowserStore();
});

describe('composeSurfaceStrip with the browser tab closed', () => {
  // The invariant protecting every existing TabManager behavior: while no
  // browser tab exists, the composed strip must be indistinguishable from
  // the file controller it wraps.
  it('delegates every method bit-identically to the file strip', async () => {
    const files = fakeFiles({ activeIndex: vi.fn(() => 1) });
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    expect(strip.count()).toBe(2);
    expect(strip.total()).toBe(3);
    expect(strip.activeIndex()).toBe(1);
    strip.activate(1);
    expect(files.activate).toHaveBeenCalledWith(1);
    strip.deactivate();
    expect(files.deactivate).toHaveBeenCalledTimes(1);
    strip.focus();
    expect(files.focus).toHaveBeenCalledTimes(1);
    await strip.close();
    expect(files.close).toHaveBeenCalledTimes(1);
    await strip.save();
    expect(files.save).toHaveBeenCalledTimes(1);
    strip.applySettings(DEFAULT_SETTINGS);
    expect(files.applySettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    // No browser transition happened, so TabManager was never poked.
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('composeSurfaceStrip with the browser tab open', () => {
  it("appends the browser as the segment's last surface", () => {
    browserOpen.value = true;
    const strip = composeSurfaceStrip({
      files: fakeFiles(),
      client: fakeClient(),
      onChanged: vi.fn(),
    });
    expect(strip.count()).toBe(3);
    expect(strip.total()).toBe(4);
    expect(strip.activeIndex()).toBe(-1); // nothing active yet

    browserSurfaceActive.value = true;
    expect(strip.activeIndex()).toBe(2); // files.count() — after the files
  });

  it('activating the browser index steps the file surface back', () => {
    browserOpen.value = true;
    const files = fakeFiles();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    strip.activate(2);
    expect(browserSurfaceActive.value).toBe(true);
    expect(files.deactivate).toHaveBeenCalledTimes(1);
    expect(files.activate).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Re-activating the already-active browser is a no-op, not a re-notify.
    strip.activate(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('activating a file index steps the browser back and hides its view', () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const client = fakeClient();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({ files, client, onChanged });

    strip.activate(0);
    expect(browserSurfaceActive.value).toBe(false);
    expect(browserOpen.value).toBe(true); // the chip survives losing the stage
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(files.activate).toHaveBeenCalledWith(0);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('deactivate steps both surfaces back (a terminal took the stage)', () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const client = fakeClient();
    const strip = composeSurfaceStrip({ files, client, onChanged: vi.fn() });

    strip.deactivate();
    expect(browserSurfaceActive.value).toBe(false);
    expect(client.setVisible).toHaveBeenCalledWith(false);
    expect(files.deactivate).toHaveBeenCalledTimes(1);
  });

  it('⌘W routes to the browser tab while it holds the stage', async () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const onChanged = vi.fn();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged,
    });

    await strip.close();
    expect(browserOpen.value).toBe(false); // the chip leaves the strip
    expect(browserSurfaceActive.value).toBe(false);
    expect(files.close).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('save and focus are browser no-ops, never misrouted to the files', async () => {
    browserOpen.value = true;
    browserSurfaceActive.value = true;
    const files = fakeFiles();
    const strip = composeSurfaceStrip({
      files,
      client: fakeClient(),
      onChanged: vi.fn(),
    });

    await strip.save();
    strip.focus();
    expect(files.save).not.toHaveBeenCalled();
    expect(files.focus).not.toHaveBeenCalled();
  });
});
