// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UsageSnapshot, UsageSource, UsageSourceState } from '../../lib/usage-snapshot';
import { UsageStatus } from './usage-status';

const source = (agent: 'claude' | 'codex', state: UsageSourceState): UsageSource => ({
  agent,
  state,
  filesScanned: 0,
});

const snapshot = (patch: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  scannedAtMs: 1_754_800_000_000,
  buckets: [],
  sources: [source('claude', 'ok'), source('codex', 'ok')],
  skippedLines: 0,
  ...patch,
});

describe('UsageStatus', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (props: Partial<Parameters<typeof UsageStatus>[0]> = {}): void => {
    act(() => {
      render(<UsageStatus snapshot={snapshot()} loading={false} stale={false} {...props} />, host);
    });
  };

  const notes = (): string[] =>
    [...host.querySelectorAll('.usage-status__note')].map((node) => node.textContent ?? '');

  it('says nothing when both sources are fine and nothing was skipped', () => {
    mount();
    expect(notes()).toEqual([]);
  });

  it('announces the cold scan while there is no snapshot yet', () => {
    mount({ snapshot: null, loading: true });
    expect(notes()).toEqual(["reading this machine's recorded history…"]);
  });

  it('does NOT re-announce the scan once data is on screen', () => {
    // A 5 s poll must not flash a loading line over data the user is reading.
    mount({ loading: true });
    expect(notes()).toEqual([]);
  });

  it("keeps 'missing' and 'unreadable' as different states (major M7)", () => {
    mount({
      snapshot: snapshot({
        sources: [source('claude', 'unreadable'), source('codex', 'missing')],
      }),
    });

    const unreadable = host.querySelector('.usage-status__note--error') as HTMLElement;
    const missing = host.querySelector('.usage-status__note--faint') as HTMLElement;

    expect(unreadable.textContent).toBe("couldn't read Claude Code history on this machine");
    expect(missing.textContent).toBe('Codex: no data yet');
    // An error must never be dressed as an absence, or the reverse.
    expect(unreadable.textContent).not.toContain('no data yet');
    expect(missing.classList.contains('usage-status__note--error')).toBe(false);
  });

  it('reports skipped lines only when there are some, grouped', () => {
    mount();
    expect(notes().join(' ')).not.toContain('skipped');

    mount({ snapshot: snapshot({ skippedLines: 12345 }) });
    expect(notes()).toContain('12,345 lines skipped');
  });

  it('marks the data stale without hiding it', () => {
    mount({ stale: true });
    expect(notes()).toEqual(['stale — showing the last good read']);
  });

  it('never overclaims what the numbers cover', () => {
    mount({
      snapshot: snapshot({
        sources: [source('claude', 'unreadable'), source('codex', 'missing')],
        skippedLines: 3,
      }),
      loading: true,
      stale: true,
    });
    expect(host.textContent).not.toContain('machine-wide');
    expect(host.textContent).not.toContain('all-time');
  });
});
