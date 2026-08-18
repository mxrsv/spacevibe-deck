// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPanel } from './browser-panel';
import type { BrowserClient } from './browser-client';
import { browserNotice, browserState, resetBrowserStore, EMPTY_STATE } from './browser-store';

// jsdom has no ResizeObserver, and the panel installs one to keep the host's
// native view aligned with this column.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

function fakeClient(overrides: Partial<BrowserClient> = {}): BrowserClient {
  return {
    open: vi.fn(async () => EMPTY_STATE),
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

describe('BrowserPanel', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetBrowserStore();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  function mount(client: BrowserClient, hidden = false) {
    act(() => {
      render(<BrowserPanel onClose={() => {}} hidden={hidden} client={client} />, host);
    });
  }

  it('reports the rectangle the native view must cover', () => {
    const client = fakeClient();
    mount(client);
    // The measured element is the empty placeholder, never the whole panel:
    // the address bar is Deck's chrome and the page must not paint over it.
    expect(client.setBounds).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
    const view = host.querySelector('.browser-panel__view');
    expect(view?.childElementCount).toBe(0);
  });

  it('tells the host to hide while an overlay covers the stage', () => {
    const client = fakeClient();
    mount(client, true);
    expect(client.setVisible).toHaveBeenCalledWith(false);
  });

  it('navigates on submit and keeps the typed text when it is not an address', async () => {
    const client = fakeClient({ navigate: vi.fn(async () => null) });
    mount(client);
    const input = host.querySelector<HTMLInputElement>('.browser-panel__url')!;
    input.value = 'not an address';
    act(() => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(client.navigate).toHaveBeenCalledWith('not an address');
    expect(browserNotice.value).toBe('That is not an address Deck can open.');
    expect(input.value).toBe('not an address');
  });

  it("shows the host's URL until the user edits the field", () => {
    const client = fakeClient();
    act(() => {
      browserState.value = { ...EMPTY_STATE, url: 'http://localhost:3000/' };
    });
    mount(client);
    const input = host.querySelector<HTMLInputElement>('.browser-panel__url')!;
    expect(input.value).toBe('http://localhost:3000/');
  });

  it('disables back and forward until there is history', () => {
    const client = fakeClient();
    mount(client);
    const [back, forward] = [...host.querySelectorAll('button')];
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
  });

  it('toggles Inspect through the host and reflects its state', () => {
    const client = fakeClient();
    act(() => {
      browserState.value = { ...EMPTY_STATE, inspect: true };
    });
    mount(client);
    const inspect = host.querySelector<HTMLButtonElement>('button[aria-label="Inspect element"]')!;
    expect(inspect.getAttribute('aria-pressed')).toBe('true');
    act(() => inspect.click());
    // Pressed means armed, so pressing again disarms it.
    expect(client.setInspect).toHaveBeenCalledWith(false);
  });

  it('prefers a load error over the last grab notice', () => {
    const client = fakeClient();
    act(() => {
      browserNotice.value = 'Element copied to the clipboard';
      browserState.value = { ...EMPTY_STATE, error: 'Connection refused' };
    });
    mount(client);
    const note = host.querySelector('.browser-panel__note');
    expect(note?.textContent).toBe('Connection refused');
    expect(note?.className).toContain('browser-panel__note--error');
  });
});
