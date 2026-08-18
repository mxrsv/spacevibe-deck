/**
 * Translated from the Rust tests in `src-tauri/src/agents.rs`, case for case.
 * The metacharacter list in particular is a security assertion, not a style
 * check: each entry would execute if it reached `sh -ilc`.
 */
import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  discoverAgentsWindows,
  BUILTIN_AGENTS,
  dirsExist,
  isProbeSafe,
  parseCommandVOutput,
  probeNames,
  stripAnsi,
} from './agents';

const builtins = [...BUILTIN_AGENTS];
const PROBE_NAME_MAX = 128;

describe('isProbeSafe', () => {
  it('rejects every shell metacharacter', () => {
    for (const name of [
      'x; rm -rf ~',
      'x && rm -rf ~',
      'x | tee /tmp/x',
      '$(id)',
      '`id`',
      'x>out',
      'x<in',
      'a b',
      'a\nb',
      'a\tb',
      "'x'",
      '"x"',
      'x(1)',
      'x{1}',
      'x[1]',
      'x*',
      'x?',
      'x!',
      'x#c',
      'x\\y',
      'x%y',
      'x=y',
      'x:y',
      'x,y',
      'x@y',
      'x^y',
      '',
    ]) {
      expect(isProbeSafe(name), `${name} must not reach the shell`).toBe(false);
    }
  });

  it('accepts real binary names and paths', () => {
    for (const name of ['aider', 'my-agent_1', '~/bin/agent.sh', '/opt/bin/claude', 'g++']) {
      expect(isProbeSafe(name), `${name} is a legitimate binary name`).toBe(true);
    }
    expect(isProbeSafe('a'.repeat(PROBE_NAME_MAX))).toBe(true);
    expect(isProbeSafe('a'.repeat(PROBE_NAME_MAX + 1))).toBe(false);
  });
});

describe('probeNames', () => {
  it('keeps the built-ins whatever the caller sends', () => {
    // A renderer bug (empty list) or a hostile one (all-invalid) must never
    // collapse the picker to Shell only.
    expect(probeNames([])).toEqual(builtins);
    expect(probeNames(['x; rm -rf ~'])).toEqual(builtins);
  });

  it('appends safe requests once', () => {
    expect(probeNames(['aider', 'aider', 'claude'])).toEqual([...builtins, 'aider']);
  });
});

describe('parseCommandVOutput', () => {
  it('matches a declared path by its basename', () => {
    // `command -v ~/bin/agent.sh` answers with the resolved absolute path, so
    // the two sides only ever agree on the last segment.
    expect(parseCommandVOutput('/Users/dev/bin/agent.sh\n', ['~/bin/agent.sh'])).toEqual([
      { name: 'agent.sh', path: '/Users/dev/bin/agent.sh' },
    ]);
  });

  it('parses absolute paths in allowlist order', () => {
    const out = '/usr/local/bin/claude\n/Users/dev/.local/bin/gemini\n/opt/homebrew/bin/opencode\n';

    expect(parseCommandVOutput(out, builtins)).toEqual([
      { name: 'claude', path: '/usr/local/bin/claude' },
      { name: 'gemini', path: '/Users/dev/.local/bin/gemini' },
      { name: 'opencode', path: '/opt/homebrew/bin/opencode' },
    ]);
  });

  it('ignores non-paths and unknown binaries', () => {
    const out = "alias claude='claude --tips'\n/usr/local/bin/ripgrep\n\n/opt/bin/codex\n";

    expect(parseCommandVOutput(out, builtins)).toEqual([{ name: 'codex', path: '/opt/bin/codex' }]);
  });

  it('dedupes repeated names', () => {
    expect(parseCommandVOutput('/a/claude\n/b/claude\n', builtins)).toHaveLength(1);
  });

  it('recovers a path buried behind iTerm OSC noise', () => {
    // Verbatim capture from a real machine: iTerm shell-integration hooks emit
    // OSC 1337 with no trailing newline, so they prefix the first path line.
    const out =
      "[oh-my-zsh] theme 'x/y' not found\n" +
      '\u001b]1337;RemoteHost=user@host' +
      '\u001b]1337;CurrentDir=/Users/dev/proj' +
      '\u001b]1337;ShellIntegrationVersion=14;shell=zsh' +
      '/Users/dev/.local/bin/claude\n';

    expect(parseCommandVOutput(out, builtins)).toEqual([
      { name: 'claude', path: '/Users/dev/.local/bin/claude' },
    ]);
  });

  it('strips powerlevel10k CSI colour codes', () => {
    const out =
      '\u001b[32m\u001b[1m/opt/homebrew/bin/codex\u001b[0m\n' +
      '\u001b]0;title\u001b\\/usr/local/bin/gemini\n';

    expect(parseCommandVOutput(out, builtins)).toEqual([
      { name: 'codex', path: '/opt/homebrew/bin/codex' },
      { name: 'gemini', path: '/usr/local/bin/gemini' },
    ]);
  });
});

describe('stripAnsi', () => {
  it('preserves UTF-8 paths', () => {
    expect(stripAnsi('\u001b[1m/Users/bình/.local/bin/claude\u001b[0m')).toBe(
      '/Users/bình/.local/bin/claude',
    );
  });
});

describe('dirsExist', () => {
  it('checks each path, in order', async () => {
    const missing = path.join(os.tmpdir(), 'deck-definitely-missing-dir');

    expect(await dirsExist([os.tmpdir(), missing])).toEqual([true, false]);
  });
});

describe('discoverAgentsWindows', () => {
  it('finds an agent that only exists as a .cmd shim', () => {
    // The Windows failure this replaces: discovery ran the macOS login-shell
    // probe, ENOENTed, was swallowed to `[]`, and the picker said "Shell only"
    // on a machine with every agent installed.
    const found = discoverAgentsWindows([], (name) =>
      name === 'claude' ? 'C:\\npm\\claude.cmd' : null,
    );

    expect(found).toEqual([{ name: 'claude', path: 'C:\\npm\\claude.cmd' }]);
  });

  it("reports the probe key, not the file's basename", () => {
    // `lastAgent` on disk is `claude`; storing `claude.cmd` would stop every
    // remembered workspace from resolving.
    const found = discoverAgentsWindows([], (name) =>
      name === 'codex' ? 'C:\\bin\\CODEX.EXE' : null,
    );

    expect(found[0].name).toBe('codex');
  });

  it('probes every built-in even when the caller asks for none', () => {
    const probed: string[] = [];
    discoverAgentsWindows([], (name) => {
      probed.push(name);
      return null;
    });

    expect(probed).toEqual([...BUILTIN_AGENTS]);
  });

  it('adds a safe declared agent and skips an unsafe one', () => {
    const probed: string[] = [];
    discoverAgentsWindows(['my-agent', 'rm -rf /; evil'], (name) => {
      probed.push(name);
      return null;
    });

    expect(probed).toContain('my-agent');
    expect(probed).not.toContain('rm -rf /; evil');
  });

  it('omits an agent that is not installed', () => {
    expect(discoverAgentsWindows([], () => null)).toEqual([]);
  });
});
