/** Translated from `src-tauri/src/prompt_assets.rs`. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clampDescription,
  collect,
  parseFrontmatter,
  parseTomlDescription,
  pluginRoots,
  readHead,
} from './prompt-assets';

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deck-assets-'));
  temps.push(dir);
  return dir;
}

function writeSkill(root: string, name: string, body: string): void {
  const dir = join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseFrontmatter', () => {
  it('reads plain scalars', () => {
    expect(parseFrontmatter('---\nname: brainstorm\ndescription: Do it\n---\n')).toEqual({
      name: 'brainstorm',
      description: 'Do it',
    });
  });

  it('strips one layer of quotes', () => {
    expect(parseFrontmatter('---\nname: "quoted"\n---\n').name).toBe('quoted');
  });

  it("joins a folded scalar's continuation lines with single spaces", () => {
    const head = '---\ndescription: >\n  first line\n  second line\n---\n';

    expect(parseFrontmatter(head).description).toBe('first line second line');
  });

  it('returns nothing when there is no frontmatter block', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({
      name: null,
      description: null,
    });
  });

  it('keeps the FIRST value when a key repeats', () => {
    expect(parseFrontmatter('---\nname: a\nname: b\n---\n').name).toBe('a');
  });
});

describe('parseTomlDescription', () => {
  it('reads a top-level description', () => {
    expect(parseTomlDescription('description = "A codex agent"\n')).toBe('A codex agent');
  });

  it("stops at a table header, so a nested description is not the agent's", () => {
    expect(parseTomlDescription('[tool]\ndescription = "not mine"\n')).toBe(null);
  });

  it('stops at a multi-line value', () => {
    expect(parseTomlDescription('x = """\ndescription = "no"\n')).toBe(null);
  });
});

describe('clampDescription', () => {
  it('collapses whitespace onto one line', () => {
    expect(clampDescription('a\n  b\tc')).toBe('a b c');
  });

  it('clamps by characters, not bytes', () => {
    // Clamping mid-codepoint would corrupt the text.
    const clamped = clampDescription('é'.repeat(300));

    expect([...clamped]).toHaveLength(256);
  });

  it('turns null into an empty string', () => {
    expect(clampDescription(null)).toBe('');
  });
});

describe('readHead', () => {
  it('refuses a symlink rather than following it out of the tree', () => {
    const dir = tempDir();
    const target = join(dir, 'real.md');
    writeFileSync(target, 'hello');
    const link = join(dir, 'link.md');
    symlinkSync(target, link);

    expect(readHead(link)).toBe(null);
    expect(readHead(target)).toBe('hello');
  });

  it('returns null for a directory or a missing file', () => {
    const dir = tempDir();

    expect(readHead(dir)).toBe(null);
    expect(readHead(join(dir, 'nope.md'))).toBe(null);
  });
});

describe('pluginRoots', () => {
  it('takes the plugin name from before the @ and sorts', () => {
    const json = JSON.stringify({
      plugins: {
        'superpowers@market': [{ installPath: '/p/superpowers' }],
        'alpha@market': [{ installPath: '/p/alpha' }],
      },
    });

    expect(pluginRoots(json)).toEqual([
      ['alpha', '/p/alpha'],
      ['superpowers', '/p/superpowers'],
    ]);
  });

  it('returns nothing for malformed json', () => {
    expect(pluginRoots('{ not json')).toEqual([]);
    expect(pluginRoots('{}')).toEqual([]);
  });
});

describe('collect', () => {
  it('finds project and global claude skills, project first', () => {
    const home = tempDir();
    const project = tempDir();
    writeSkill(join(home, '.claude'), 'global-one', '---\ndescription: G\n---\n');
    writeSkill(join(project, '.claude'), 'project-one', '---\ndescription: P\n---\n');

    const assets = collect('claude', home, project);

    expect(assets.skills.map((s) => [s.name, s.source])).toEqual([
      ['project-one', 'project'],
      ['global-one', 'global'],
    ]);
  });

  it('lets a project skill shadow a global one of the same name', () => {
    const home = tempDir();
    const project = tempDir();
    writeSkill(join(home, '.claude'), 'same', '---\ndescription: global\n---\n');
    writeSkill(join(project, '.claude'), 'same', '---\ndescription: project\n---\n');

    const assets = collect('claude', home, project);

    expect(assets.skills).toHaveLength(1);
    expect(assets.skills[0].description).toBe('project');
  });

  it('names a subagent by its file stem, not its frontmatter name', () => {
    // A `name:` that disagrees with the file the CLI loads by path would send
    // the wrong reference into the prompt.
    const home = tempDir();
    const agents = join(home, '.claude', 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'reviewer.md'), '---\nname: something-else\ndescription: R\n---\n');

    const assets = collect('claude', home, null);

    expect(assets.subagents.map((a) => a.name)).toEqual(['reviewer']);
  });

  it('reads codex agents from .toml', () => {
    const home = tempDir();
    const agents = join(home, '.codex', 'agents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'helper.toml'), 'description = "A helper"\n');

    const assets = collect('codex', home, null);

    expect(assets.subagents).toEqual([
      { kind: 'subagent', name: 'helper', description: 'A helper', source: 'global' },
    ]);
  });

  it('returns empty lists for an unverified CLI rather than erroring', () => {
    // The picker hides itself; an unknown agent is not a failure.
    expect(collect('gemini', tempDir(), null)).toEqual({ skills: [], subagents: [] });
  });

  it('qualifies plugin skills with the plugin name', () => {
    const home = tempDir();
    const pluginRoot = tempDir();
    writeSkill(pluginRoot, 'brainstorming', '---\ndescription: B\n---\n');
    const pluginsDir = join(home, '.claude', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'superpowers@m': [{ installPath: pluginRoot }] } }),
    );

    const assets = collect('claude', home, null);

    expect(assets.skills.map((s) => s.name)).toEqual(['superpowers:brainstorming']);
  });
});
