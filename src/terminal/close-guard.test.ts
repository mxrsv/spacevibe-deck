import { describe, expect, it, vi } from 'vitest';
import {
  busyProcesses,
  confirmClose,
  confirmMessage,
  dirtyFilesPhrase,
  FILE_CLOSE_COPY,
  isBusy,
  QUIT_COPY,
  unknownMessage,
  UPDATE_COPY,
} from './close-guard';
import type { PaneProcessInfo } from '../lib/process-info';
import { createMemoryPtyClient } from './pty-client';
import { freshPaneInfo } from './pane-info';

const askMock = vi.hoisted(() => vi.fn());
vi.mock('../host/dialog-host', () => ({ ask: askMock }));

function info(id: number, process: string | null, cwd: string | null = null): PaneProcessInfo {
  const agent =
    process === 'claude' || process === 'codex' || process === 'gemini' || process === 'opencode'
      ? process
      : null;
  const kind =
    agent !== null
      ? 'agent'
      : process === null
        ? 'unknown'
        : ['zsh', 'bash', 'fish', 'sh', 'dash', 'nu', 'pwsh'].includes(process)
          ? 'idle-shell'
          : 'busy';
  return { id, cwd, process, kind, agent };
}

describe('isBusy', () => {
  it('treats idle shells as not busy', () => {
    for (const shell of ['zsh', 'bash', 'fish', 'sh', 'dash', 'nu', 'pwsh']) {
      expect(isBusy(info(1, shell))).toBe(false);
    }
  });

  it('treats agents and other foreground processes as busy', () => {
    expect(isBusy(info(1, 'claude'))).toBe(true);
    expect(isBusy(info(1, 'vim'))).toBe(true);
    expect(isBusy(info(1, 'npm'))).toBe(true);
  });

  it('does not treat unknown inspection as named busy state', () => {
    expect(isBusy(info(1, null))).toBe(false);
  });
});

describe('update confirmation copy', () => {
  it('names the install-and-restart action', () => {
    expect(UPDATE_COPY.title).toBe('Install Deck Update');
    expect(UPDATE_COPY.okLabel).toBe('Install & Restart');
    expect(UPDATE_COPY.action).toBe('Install update and restart');
  });

  it('warns that the install is not a normal restart', () => {
    // Deck hands the install to the platform and cannot watch it finish, so
    // the dialog is the only place the user learns the stakes.
    expect(UPDATE_COPY.detail).toMatch(/quit while it installs/);
    expect(UPDATE_COPY.detail).toMatch(/terminated/);
    expect(UPDATE_COPY.detail).toMatch(/downloaded again/);
  });

  it('leaves the close and quit dialogs without extra consequences copy', () => {
    expect(QUIT_COPY.detail).toBeUndefined();
  });
});

describe('confirmMessage — pane count', () => {
  it('counts panes, not deduplicated names', () => {
    // Three panes running claude used to read "claude is still running".
    expect(confirmMessage(['claude'], 'Install update and restart', 3)).toBe(
      '3 panes are still running (claude). Install update and restart anyway?',
    );
  });

  it('keeps the singular wording when one pane is busy', () => {
    expect(confirmMessage(['claude'], 'Close', 1)).toBe('claude is still running. Close anyway?');
  });

  it('defaults the count to the number of names', () => {
    expect(confirmMessage(['claude', 'cargo'], 'Quit')).toBe(
      'These processes are still running: claude, cargo. Quit anyway?',
    );
  });
});

describe('busyProcesses', () => {
  it('collects busy names, deduplicated, in order', () => {
    const infos = [
      info(1, 'zsh'),
      info(2, 'claude'),
      info(3, 'vim'),
      info(4, 'claude'),
      info(5, null),
    ];
    expect(busyProcesses(infos)).toEqual(['claude', 'vim']);
  });

  it('omits idle and unknown panes from the named process list', () => {
    expect(busyProcesses([info(1, 'zsh'), info(2, null)])).toEqual([]);
  });
});

describe('confirmClose with injected PtyClient', () => {
  it('skips dialog when MemoryPtyClient reports idle shells', async () => {
    askMock.mockClear();
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'zsh')]]),
    });
    await expect(confirmClose([1], pty)).resolves.toBe(true);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('prompts when MemoryPtyClient reports a busy agent', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(true);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'claude')]]),
    });
    await expect(confirmClose([1], pty)).resolves.toBe(true);
    expect(askMock).toHaveBeenCalledTimes(1);
  });

  it('prompts with the process name for a non-agent busy pane', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'vim')]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'vim is still running. Close anyway?',
      expect.objectContaining({ title: 'Close Terminal' }),
    );
  });

  it('uses generic fail-safe copy when process inspection is unknown', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, null)]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'Deck could not verify whether terminal processes are still running. Close anyway?',
      expect.objectContaining({ title: 'Close Terminal' }),
    );
  });

  it('uses generic fail-safe copy when the IPC omits a requested pane', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient();

    await expect(confirmClose([7], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'Deck could not verify whether terminal processes are still running. Close anyway?',
      expect.objectContaining({ title: 'Close Terminal' }),
    );
  });

  it('uses generic fail-safe copy when fresh IPC fails', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const base = createMemoryPtyClient();
    const pty = {
      ...base,
      ptyInfo: vi.fn().mockRejectedValue(new Error('WMI unavailable')),
    };

    await expect(confirmClose([3], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'Deck could not verify whether terminal processes are still running. Close anyway?',
      expect.objectContaining({ title: 'Close Terminal' }),
    );
  });

  it('fails closed when the native dialog rejects', async () => {
    askMock.mockClear();
    askMock.mockRejectedValue(new Error('dialog unavailable'));
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'claude')]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
  });

  it('rejects a second call while a prompt is open, then resets', async () => {
    askMock.mockClear();
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'claude')]]),
    });
    let resolveAsk!: (ok: boolean) => void;
    askMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAsk = resolve;
      }),
    );

    const first = confirmClose([1], pty);
    await Promise.resolve();
    await Promise.resolve();

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledTimes(1);

    resolveAsk(true);
    await expect(first).resolves.toBe(true);

    askMock.mockResolvedValue(false);
    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledTimes(2);
  });
});

describe('confirmClose dialog copy', () => {
  it('uses the quit copy on the quit path', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(true);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'claude')]]),
    });
    await confirmClose([1], pty, QUIT_COPY);
    expect(askMock).toHaveBeenCalledWith(
      'claude is still running. Quit anyway?',
      expect.objectContaining({ title: 'Quit Deck', okLabel: 'Quit' }),
    );
  });
});

describe('freshPaneInfo', () => {
  it('synthesizes unknown snapshots for omitted requested panes', async () => {
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'zsh')]]),
    });

    await expect(freshPaneInfo([1, 2], pty)).resolves.toEqual([
      info(1, 'zsh'),
      { id: 2, cwd: null, process: null, kind: 'unknown', agent: null },
    ]);
  });

  it('synthesizes unknown snapshots for every requested pane on IPC failure', async () => {
    const base = createMemoryPtyClient();
    const pty = {
      ...base,
      ptyInfo: vi.fn().mockRejectedValue(new Error('WMI unavailable')),
    };

    await expect(freshPaneInfo([4, 9], pty)).resolves.toEqual([
      { id: 4, cwd: null, process: null, kind: 'unknown', agent: null },
      { id: 9, cwd: null, process: null, kind: 'unknown', agent: null },
    ]);
  });
});

/**
 * The unsaved-file half of the guard. No UI reaches it on this branch — the
 * explorer chrome is left to the Electron redesign — so these are the only
 * proof that an unsaved file survives the four exits. They test the layer
 * directly rather than through a surface, which is also why they must not be
 * deleted as "unused" before that surface exists.
 */
describe('dirtyFilesPhrase', () => {
  it('says nothing when nothing is unsaved', () => {
    expect(dirtyFilesPhrase([])).toBeNull();
  });

  it('names one file by its basename, not its path', () => {
    expect(dirtyFilesPhrase(['/home/u/work/src/main.rs'])).toBe('main.rs has unsaved changes');
  });

  it('uses the platform separator the path actually carries', () => {
    expect(dirtyFilesPhrase(['C:\\work\\src\\main.rs'])).toBe('main.rs has unsaved changes');
  });

  it('lists up to three names, then counts the rest', () => {
    expect(dirtyFilesPhrase(['/a/one.ts', '/a/two.ts', '/a/three.ts'])).toBe(
      '3 files have unsaved changes (one.ts, two.ts, three.ts)',
    );
    expect(dirtyFilesPhrase(['/a/one.ts', '/a/two.ts', '/a/three.ts', '/a/four.ts'])).toBe(
      '4 files have unsaved changes (one.ts, two.ts, three.ts and 1 more)',
    );
  });
});

describe('confirmMessage — busy panes and unsaved files together', () => {
  it('asks once, naming both (spec §6: one dialog, never two)', () => {
    expect(confirmMessage(['claude'], 'Quit', 1, ['/a/main.rs'])).toBe(
      'claude is still running, and main.rs has unsaved changes. Quit anyway?',
    );
  });

  it('drops the busy clause entirely when only files are unsaved', () => {
    // Closing a file tab passes no pane ids at all, so there is no "0 panes
    // are still running" half to leak into the sentence.
    expect(confirmMessage([], 'Close', 0, ['/a/main.rs'])).toBe(
      'main.rs has unsaved changes. Close anyway?',
    );
  });
});

describe('unknownMessage', () => {
  it('keeps the fail-safe wording when nothing is unsaved', () => {
    expect(unknownMessage('Quit')).toBe(
      'Deck could not verify whether terminal processes are still running. Quit anyway?',
    );
  });

  it('still names the unsaved files it DOES know about', () => {
    // An unverifiable census is the one case where the file list is the only
    // concrete thing the dialog can offer.
    expect(unknownMessage('Quit', ['/a/main.rs'])).toBe(
      'Deck could not verify whether terminal processes are still running, and main.rs has unsaved changes. Quit anyway?',
    );
  });
});

describe('confirmClose with unsaved files', () => {
  it('prompts even when every pane is an idle shell', async () => {
    // The fast path that skips the dialog is "all idle AND nothing unsaved".
    // Without the second half, ⌘Q with an unsaved file and no busy pane
    // discarded the edits silently.
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'zsh')]]),
    });

    await expect(confirmClose([1], pty, QUIT_COPY, ['/a/main.rs'])).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'main.rs has unsaved changes. Quit anyway?',
      expect.objectContaining({ title: 'Quit Deck' }),
    );
  });

  it('prompts with no panes at all — the file-tab close path', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(true);
    const pty = createMemoryPtyClient();

    await expect(confirmClose([], pty, FILE_CLOSE_COPY, ['/a/notes.md'])).resolves.toBe(true);
    expect(askMock).toHaveBeenCalledWith(
      'notes.md has unsaved changes. Close anyway?',
      expect.objectContaining({
        title: 'Close File',
        okLabel: 'Discard Changes',
      }),
    );
  });

  it('keeps the silent fast path when nothing is unsaved and nothing is busy', async () => {
    askMock.mockClear();
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, 'zsh')]]),
    });

    await expect(confirmClose([1], pty, QUIT_COPY, [])).resolves.toBe(true);
    expect(askMock).not.toHaveBeenCalled();
  });

  it('appends the unsaved files to an unverifiable census', async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, null)]]),
    });

    await expect(confirmClose([1], pty, QUIT_COPY, ['/a/main.rs'])).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      'Deck could not verify whether terminal processes are still running, and main.rs has unsaved changes. Quit anyway?',
      expect.objectContaining({ title: 'Quit Deck' }),
    );
  });
});

describe('confirmMessage', () => {
  it('names the single busy process', () => {
    expect(confirmMessage(['claude'])).toBe('claude is still running. Close anyway?');
  });

  it('uses the provided action verb', () => {
    expect(confirmMessage(['claude'], 'Quit')).toBe('claude is still running. Quit anyway?');
  });

  it('lists multiple busy processes', () => {
    expect(confirmMessage(['claude', 'vim'])).toBe(
      'These processes are still running: claude, vim. Close anyway?',
    );
  });
});
