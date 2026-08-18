// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The section pulls in the Tauri-backed settings store; stub it so the
// component tree mounts under jsdom.
vi.mock('../../../host/store-host', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock('../../../host/dialog-host', () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock('../../../chrome/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../chrome/events')>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { ask } from '../../../host/dialog-host';
import { ResetSection } from './reset-section';
import { settings } from '../../../settings/settings-store';
import { DEFAULT_SETTINGS } from '../../../settings/settings-schema';
import { reportPersistError } from '../../../chrome/events';

const mockedReportPersistError = vi.mocked(reportPersistError);
const mockedAsk = vi.mocked(ask);

/** Flushes the whole microtask queue — a single `await Promise.resolve()`
 * only advances one hop, which isn't enough for an `await`-chained handler
 * (confirm dialog → reset/finally). A macrotask boundary guarantees every
 * pending microtask has drained first. */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ResetSection — Restore defaults confirm', () => {
  let host: HTMLDivElement;
  const CUSTOM = { ...DEFAULT_SETTINGS, fontSize: 20, themeId: 'dracula' };

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    settings.value = CUSTOM;
    mockedAsk.mockReset();
    mockedReportPersistError.mockReset();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (): void => {
    act(() => {
      render(<ResetSection />, host);
    });
  };

  const getReset = (): HTMLButtonElement =>
    host.querySelector('.cfg-btn--danger') as HTMLButtonElement;

  const click = async (button: HTMLButtonElement): Promise<void> => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushMicrotasks();
    });
  };

  it('keeps the word next to the icon on a consequential action', () => {
    mount();
    const reset = getReset();

    // DL-14.4: icon-only is for familiar actions. Restoring defaults is not
    // one, so the icon supplements the label rather than replacing it.
    expect(reset.textContent?.trim()).toBe('reset');
    expect(
      reset.querySelector('svg')?.classList.contains('deck-icon--arrow-counter-clockwise'),
    ).toBe(true);
  });

  it('does NOT reset on render, and asks before resetting', async () => {
    mockedAsk.mockResolvedValueOnce(true);
    mount();
    expect(mockedAsk).not.toHaveBeenCalled();

    await click(getReset());

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    // The sentence names everything the reset wipes — declared agents and
    // prompt templates included, since both live in the same settings object.
    expect(mockedAsk).toHaveBeenCalledWith(
      "Theme, font, colors, behavior, declared agents and prompt templates all go back to their defaults. This can't be undone.",
      expect.objectContaining({ title: 'Restore Defaults' }),
    );
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settings.value.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });

  it('cancelling the prompt leaves every setting untouched', async () => {
    mockedAsk.mockResolvedValueOnce(false);
    mount();

    await click(getReset());

    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(settings.value.fontSize).toBe(20);
    expect(settings.value.themeId).toBe('dracula');
    expect(mockedReportPersistError).not.toHaveBeenCalled();
  });

  it('a failed prompt is fail-safe: nothing reset, error surfaced', async () => {
    mockedAsk.mockRejectedValueOnce(new Error('no dialog'));
    mount();

    await click(getReset());

    expect(settings.value.fontSize).toBe(20);
    expect(mockedReportPersistError).toHaveBeenCalledTimes(1);
  });

  it('two clicks in one tick raise a single prompt', async () => {
    let resolveAsk: (value: boolean) => void = () => {};
    mockedAsk.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAsk = resolve;
        }),
    );
    mount();
    const button = getReset();

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      resolveAsk(true);
      await flushMicrotasks();
    });

    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });
});
