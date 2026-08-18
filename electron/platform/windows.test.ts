/**
 * The pure halves of the Windows seam.
 *
 * What these DO cover: the parser, the descendant walk and its two PID-reuse
 * guards, the shell discovery order, and the pid guard on the one function
 * here that destroys something.
 *
 * What they CANNOT cover, and no test on this machine can: whether
 * `Get-CimInstance` returns these fields on a real Windows, whether
 * `taskkill /T` reaches a ConPTY child, or how long a poll tick actually takes.
 * Gate C is open — a green run here is not Windows evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  buildShellLaunch,
  collectDescendants,
  executableCandidates,
  findExecutable,
  foregroundProcess,
  killablePid,
  parseProcessTable,
  processCwds,
  resolveOnPath,
  PROMPT_INTEGRATION,
  type WindowsProcessRow,
} from './windows';

function row(
  pid: number,
  ppid: number,
  executable: string,
  creationDate: number,
  args = executable,
): WindowsProcessRow {
  return {
    pid,
    pgid: ppid,
    tpgid: -1,
    tty: '',
    args,
    ppid,
    creationDate,
    executable,
  };
}

describe('shell discovery', () => {
  const env = {
    PATH: 'C:\\Windows\\System32;C:\\tools',
    ProgramFiles: 'C:\\Program Files',
    SystemRoot: 'C:\\Windows',
  } as NodeJS.ProcessEnv;

  it('looks on PATH first, then the well-known install location', () => {
    const candidates = executableCandidates('pwsh.exe', env);

    expect(candidates).toEqual([
      'C:\\Windows\\System32\\pwsh.exe',
      'C:\\tools\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    ]);
  });

  it("falls back to Windows PowerShell's versioned directory", () => {
    expect(executableCandidates('powershell.exe', env)).toContain(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
  });

  it('prefers PowerShell 7 when both are installed', () => {
    const launch = buildShellLaunch(
      env,
      (candidate) =>
        candidate === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' ||
        candidate === 'C:\\Windows\\System32\\powershell.exe',
    );

    expect(launch.executable).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
  });

  it('injects the prompt that carries OSC 133 and OSC 9;9', () => {
    // This is the ONLY cwd source on Windows — WMI has no working directory
    // and there is no pure-Node `lsof`. Losing these args loses pane cwd, the
    // git branch, and prompt-ready attention state all at once.
    const launch = buildShellLaunch(env, () => true);

    expect(launch.args).toEqual(['-NoLogo', '-NoExit', '-Command', PROMPT_INTEGRATION]);
    expect(PROMPT_INTEGRATION).toContain(']9;9;');
    expect(PROMPT_INTEGRATION).toContain(']133;A');
    expect(PROMPT_INTEGRATION).toContain(']133;B');
    expect(PROMPT_INTEGRATION).toContain('__DeckOriginalPrompt');
  });

  it('refuses to fall back to cmd.exe', () => {
    // A `cmd` pane would look fine and silently report no cwd and no prompt
    // signal, which is worse than a named failure.
    expect(() => buildShellLaunch(env, () => false)).toThrow(
      'No supported PowerShell executable was found',
    );
  });

  it('returns null when nothing on PATH exists', () => {
    expect(findExecutable('pwsh.exe', env, () => false)).toBeNull();
  });
});

describe('resolveOnPath', () => {
  const env = { PATH: 'C:\\bin;C:\\npm' } as NodeJS.ProcessEnv;

  it('finds an npm .cmd shim that has no bare .exe anywhere', () => {
    // The whole reason this exists. Probing the bare name, or appending only
    // `.exe`, reports "not installed" on a machine that has the agent.
    expect(resolveOnPath('claude', env, (candidate) => candidate === 'C:\\npm\\claude.cmd')).toBe(
      'C:\\npm\\claude.cmd',
    );
  });

  it('prefers an earlier PATH directory over a later one', () => {
    expect(resolveOnPath('codex', env, () => true)).toBe('C:\\bin\\codex');
  });

  it('tries the bare name before any suffix', () => {
    const probed: string[] = [];
    resolveOnPath('agy', { PATH: 'C:\\bin' } as NodeJS.ProcessEnv, (c) => {
      probed.push(c);
      return false;
    });

    expect(probed).toEqual([
      'C:\\bin\\agy',
      'C:\\bin\\agy.exe',
      'C:\\bin\\agy.cmd',
      'C:\\bin\\agy.bat',
      'C:\\bin\\agy.ps1',
    ]);
  });

  it('skips relative PATH entries', () => {
    const probed: string[] = [];
    resolveOnPath('x', { PATH: '.;..\\bin;C:\\bin' } as NodeJS.ProcessEnv, (c) => {
      probed.push(c);
      return false;
    });

    expect(probed.every((candidate) => candidate.startsWith('C:\\bin'))).toBe(true);
  });

  it('returns null when nothing matches', () => {
    expect(resolveOnPath('nope', env, () => false)).toBeNull();
  });
});

describe('parseProcessTable', () => {
  it('reads one NDJSON record per process', () => {
    const output = [
      '{"p":4321,"pp":100,"c":133700000000000000,"n":"pwsh.exe","e":"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe","l":"pwsh.exe -NoLogo"}',
      '{"p":4322,"pp":4321,"c":133700000000000001,"n":"claude.exe","e":"C:\\\\Users\\\\a\\\\claude.exe","l":"claude --resume"}',
    ].join('\n');

    const rows = parseProcessTable(output);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      pid: 4322,
      ppid: 4321,
      pgid: 4321,
      tpgid: -1,
      tty: '',
      args: 'claude --resume',
      executable: 'C:\\Users\\a\\claude.exe',
    });
  });

  it('keeps a command line that contains quotes and separators', () => {
    // The reason this is JSON and not CSV: a command line can hold anything.
    const line = JSON.stringify({
      p: 9,
      pp: 1,
      c: 5,
      n: 'node.exe',
      e: 'C:\\node.exe',
      l: 'node.exe "C:\\a b\\cli.js" --flag=1,2',
    });

    expect(parseProcessTable(line)[0].args).toBe('node.exe "C:\\a b\\cli.js" --flag=1,2');
  });

  it('skips malformed lines instead of blinding every pane', () => {
    const output = [
      'WARNING: something on stderr got interleaved',
      '{"p":7,"pp":1,"c":5,"n":"a.exe","e":"C:\\\\a.exe","l":"a"}',
      '{not json',
      '{"pp":1,"c":5}',
    ].join('\n');

    expect(parseProcessTable(output).map((r) => r.pid)).toEqual([7]);
  });

  it('falls back to the process name when WMI gives no executable path', () => {
    const line = JSON.stringify({ p: 3, pp: 1, c: 5, n: 'svchost.exe' });

    expect(parseProcessTable(line)[0]).toMatchObject({
      executable: 'svchost.exe',
      args: 'svchost.exe',
    });
  });
});

describe('collectDescendants', () => {
  it('walks the whole tree, not just direct children', () => {
    const rows = [
      row(100, 1, 'pwsh.exe', 10),
      row(101, 100, 'node.exe', 20),
      row(102, 101, 'claude.exe', 30),
    ];

    expect(collectDescendants(rows, 100).map((d) => [d.row.pid, d.depth])).toEqual([
      [101, 1],
      [102, 2],
    ]);
  });

  it('drops a process older than the shell — a recycled pid is not a child', () => {
    // Windows reuses pids aggressively. Without this, an unrelated tree grafts
    // onto the pane and an idle shell can report a busy agent.
    const rows = [
      row(100, 1, 'pwsh.exe', 500),
      row(101, 100, 'stale.exe', 499),
      row(102, 100, 'claude.exe', 501),
    ];

    expect(collectDescendants(rows, 100).map((d) => d.row.pid)).toEqual([102]);
  });

  it('terminates on a parent cycle', () => {
    const rows = [
      row(100, 1, 'pwsh.exe', 10),
      row(101, 100, 'a.exe', 20),
      row(100, 101, 'loop.exe', 20),
    ];

    expect(collectDescendants(rows, 100).map((d) => d.row.pid)).toEqual([101]);
  });

  it('returns nothing when the shell is absent from the snapshot', () => {
    expect(collectDescendants([row(1, 0, 'a.exe', 1)], 100)).toEqual([]);
  });
});

describe('foregroundProcess', () => {
  it('reports the shell itself when nothing is running', () => {
    const rows = [row(100, 1, 'C:\\pwsh.exe', 10)];

    // `null` group: there is no tree to terminate, and `classifyProcess`
    // resolves the shell name to idle-shell.
    expect(foregroundProcess(rows, '', 100)).toEqual({
      pid: 100,
      group: null,
      name: 'pwsh.exe',
    });
  });

  it('picks the deepest descendant, so the agent beats its launcher', () => {
    const rows = [
      row(100, 1, 'C:\\pwsh.exe', 10),
      row(101, 100, 'C:\\node.exe', 20),
      row(102, 101, 'C:\\Users\\a\\claude.exe', 30),
    ];

    expect(foregroundProcess(rows, '', 100)).toEqual({
      pid: 102,
      group: 102,
      name: 'claude.exe',
    });
  });

  it('breaks a depth tie by creation time, then by pid', () => {
    const rows = [
      row(100, 1, 'C:\\pwsh.exe', 10),
      row(101, 100, 'C:\\old.exe', 20),
      row(102, 100, 'C:\\new.exe', 30),
    ];

    expect(foregroundProcess(rows, '', 100)?.name).toBe('new.exe');

    const sameInstant = [
      row(100, 1, 'C:\\pwsh.exe', 10),
      row(101, 100, 'C:\\a.exe', 20),
      row(102, 100, 'C:\\b.exe', 20),
    ];

    expect(foregroundProcess(sameInstant, '', 100)?.name).toBe('b.exe');
  });

  it('ignores the tty argument, which Windows does not have', () => {
    const rows = [row(100, 1, 'C:\\pwsh.exe', 10)];

    expect(foregroundProcess(rows, 'ttys004', 100)?.pid).toBe(100);
  });

  it('returns null when the shell is not in the table', () => {
    // The caller turns this into `unknown`, never into `idle-shell`.
    expect(foregroundProcess([row(1, 0, 'C:\\a.exe', 1)], '', 100)).toBeNull();
  });

  it('returns null for rows that are not a Windows snapshot', () => {
    const posix = {
      pid: 100,
      pgid: 100,
      tpgid: 100,
      tty: 'ttys1',
      args: '-zsh',
    };

    expect(foregroundProcess([posix], 'ttys1', 100)).toBeNull();
  });
});

describe('processCwds', () => {
  it('is always empty — cwd comes from OSC 9;9 on this platform', () => {
    return expect(processCwds([1, 2, 3])).resolves.toEqual(new Map());
  });
});

describe('killablePid', () => {
  it('refuses the pids Windows reserves', () => {
    // `taskkill /PID 4 /F` targets the System process.
    expect(killablePid(0)).toBeNull();
    expect(killablePid(4)).toBeNull();
    expect(killablePid(-1)).toBeNull();
  });

  it("refuses Deck's own pid", () => {
    // Passing this through would quit the app instead of the pane.
    expect(killablePid(1234, 1234)).toBeNull();
  });

  it('refuses null and non-integers', () => {
    expect(killablePid(null)).toBeNull();
    expect(killablePid(12.5)).toBeNull();
  });

  it('passes a real pid through', () => {
    expect(killablePid(4321, 999)).toBe(4321);
  });
});
