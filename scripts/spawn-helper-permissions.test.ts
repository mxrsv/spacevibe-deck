import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
// @ts-expect-error — plain ESM script, no types; the postinstall must stay
// runnable by `node` with nothing compiled.
import { spawnHelpersUnder, EXEC_BIT } from './fix-spawn-helper-permissions.mjs';

/**
 * The gate for handoff §3.1.
 *
 * Without it the failure surfaces as `posix_spawnp failed` on the first shell
 * spawn — an error that names no file and no permission, in an app that has
 * already painted. This asserts the mode instead, so a regression fails here
 * rather than in somebody's terminal three commands later.
 */
describe('node-pty spawn-helper permissions', () => {
  const helpers = [
    ...spawnHelpersUnder('node_modules/node-pty/prebuilds'),
    ...spawnHelpersUnder('node_modules/node-pty/build/Release'),
  ] as string[];

  it('finds the helpers it claims to check', () => {
    // Otherwise a moved prebuilds directory would make the assertion below
    // vacuously green — which is how this bug survived a postinstall the first
    // time. node-pty ships every platform's prebuilds in the tarball, so this
    // holds on Linux and macOS alike.
    expect(helpers.length).toBeGreaterThan(0);
  });

  it.runIf(process.platform !== 'win32')('leaves every one of them executable', () => {
    const notExecutable = helpers.filter((helper) => (statSync(helper).mode & EXEC_BIT) === 0);
    expect(notExecutable).toEqual([]);
  });

  it('is wired to run on every install', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.postinstall).toContain('fix-spawn-helper-permissions.mjs');
  });
});
