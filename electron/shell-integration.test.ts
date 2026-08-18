/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
/**
 * Translated from the Rust tests in `src-tauri/src/shell_integration.rs`.
 * Same cases, same names, so a behavioural divergence between the two hosts
 * shows up as a named failure rather than as a mystery in the app.
 */
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  hasRejectedRoot,
  retainValidCwd,
  ShellIntegrationParser,
  type ShellIntegrationEvent,
} from './shell-integration';

const PROMPT_READY: ShellIntegrationEvent = { kind: 'prompt-ready' };

describe('ShellIntegrationParser', () => {
  it('parses a prompt-ready marker split across single-character chunks', () => {
    const marker = '\u001b]133;B\u0007';
    let parser = new ShellIntegrationParser();
    const events: ShellIntegrationEvent[] = [];

    for (const character of marker) {
      const result = parser.parse(character);
      parser = result.parser;
      events.push(...result.events);
    }

    expect(events).toEqual([PROMPT_READY]);
  });

  it('parses a Windows cwd marker at every split point', () => {
    const cwd = String.raw`C:\Users\dev\Space Vibe`;
    const marker = `\u001b]9;9;"${cwd}"\u001b\\`;

    for (let split = 1; split < marker.length; split += 1) {
      const first = new ShellIntegrationParser().parse(marker.slice(0, split));
      const second = first.parser.parse(marker.slice(split));

      expect(first.events, `split ${split} emitted too early`).toEqual([]);
      expect(second.events, `split ${split} lost the CWD marker`).toEqual([
        { kind: 'current-directory', value: cwd },
      ]);
    }
  });

  it('emits every complete ready marker in one chunk', () => {
    const data = '\u001b]133;B\u0007text\u001b]133;B\u001b\\';

    const { events } = new ShellIntegrationParser().parse(data);

    expect(events).toEqual([PROMPT_READY, PROMPT_READY]);
  });

  it('keeps incomplete noise bounded', () => {
    const noise = `\u001b]9;9;${'x'.repeat(300_000)}`;

    const { parser, events } = new ShellIntegrationParser().parse(noise);

    expect(events).toEqual([]);
    // Reaches into the private field on purpose: the cap is the point of the
    // test, and it has no other observable surface.
    expect((parser as unknown as { pending: Buffer }).pending.length).toBeLessThan(300_000);
  });
});

describe('retainValidCwd', () => {
  const current = os.tmpdir();

  it('rejects a relative cwd', () => {
    expect(retainValidCwd(current, 'relative/workspace')).toBe(current);
  });

  it('rejects a missing cwd', () => {
    const missing = path.join(os.tmpdir(), 'deck-missing-shell-cwd-for-test');

    expect(retainValidCwd(current, missing)).toBe(current);
  });

  it('retains the last valid cwd', () => {
    const accepted = retainValidCwd(null, os.tmpdir());

    expect(retainValidCwd(accepted, 'not/absolute')).toBe(os.tmpdir());
  });

  it('retains the current cwd for a rejected root', () => {
    expect(retainValidCwd(current, String.raw`\\10.255.255.1\share`)).toBe(current);
  });
});

describe('hasRejectedRoot', () => {
  it('rejects network and verbatim roots', () => {
    for (const candidate of [
      String.raw`\\10.255.255.1\share`,
      String.raw`\\corp\projects\deck`,
      String.raw`\\?\C:\Users\dev`,
      String.raw`\\?\UNC\corp\projects`,
    ]) {
      expect(
        hasRejectedRoot(candidate),
        `${candidate} must be rejected before any filesystem call`,
      ).toBe(true);
    }
  });

  it('accepts ordinary local roots', () => {
    expect(hasRejectedRoot(os.tmpdir())).toBe(false);
    expect(hasRejectedRoot(String.raw`C:\Users\dev`)).toBe(false);
  });
});
