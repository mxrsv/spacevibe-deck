import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  electronRelaunch: vi.fn(async () => undefined),
  tauriCheck: vi.fn(),
  tauriRelaunch: vi.fn(async () => undefined),
}));

vi.mock('../host/shell-host', () => ({
  relaunch: mocks.electronRelaunch,
}));
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.tauriCheck,
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mocks.tauriRelaunch,
}));

import { checkForUpdate, relaunchDeck } from './tauri-updater-adapter';

describe('updater host routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__deckHost', undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the signed Tauri updater when no Electron bridge exists', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    mocks.tauriCheck.mockResolvedValue({
      currentVersion: '0.12.3',
      version: '0.12.4',
      body: 'Security fixes',
      download,
      install,
    });

    const update = await checkForUpdate();

    expect(mocks.tauriCheck).toHaveBeenCalledOnce();
    expect(update).toMatchObject({
      currentVersion: '0.12.3',
      version: '0.12.4',
      notes: 'Security fixes',
    });
    await update?.download();
    await update?.install();
    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
  });

  it('reports updater support as unavailable under Electron', async () => {
    vi.stubGlobal('__deckHost', {
      invoke: vi.fn(),
      listen: vi.fn(),
    });

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(mocks.tauriCheck).not.toHaveBeenCalled();
  });

  it('does not call a native updater in browser-only preview', async () => {
    await expect(checkForUpdate()).resolves.toBeNull();
    expect(mocks.tauriCheck).not.toHaveBeenCalled();
  });

  it('routes relaunch through the active host', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    await relaunchDeck();
    expect(mocks.tauriRelaunch).toHaveBeenCalledOnce();
    expect(mocks.electronRelaunch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
    vi.stubGlobal('__deckHost', {
      invoke: vi.fn(),
      listen: vi.fn(),
    });
    await relaunchDeck();
    expect(mocks.electronRelaunch).toHaveBeenCalledOnce();
    expect(mocks.tauriRelaunch).not.toHaveBeenCalled();
  });
});
