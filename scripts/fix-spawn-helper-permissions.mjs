/**
 * Restore the exec bit on node-pty's `spawn-helper` binaries.
 *
 * node-pty's own postinstall chmods `build/Release/` and never `prebuilds/`,
 * so a fresh `npm install` writes the prebuilt helpers at 0644. The only
 * symptom is `posix_spawnp failed` on the first shell spawn, with nothing said
 * about permissions: the app paints, the window is fine, and the terminal
 * simply never starts. The 2026-08-11 spike recorded this and said a
 * postinstall step must do it for real; this is that step.
 *
 * Deliberately silent on success and never fatal. `npm install` failing
 * because a helper for another platform is missing would be a worse bug than
 * the one this fixes.
 */
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOTS = [
  "node_modules/node-pty/prebuilds",
  "node_modules/node-pty/build/Release",
];

/** Every `spawn-helper` one level under `dir`, plus `dir/spawn-helper`. */
export function spawnHelpersUnder(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const found = [];
  const direct = join(dir, "spawn-helper");
  if (existsSync(direct)) {
    found.push(direct);
  }
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (!statSync(child).isDirectory()) {
      continue;
    }
    const helper = join(child, "spawn-helper");
    if (existsSync(helper)) {
      found.push(helper);
    }
  }
  return found;
}

/** Owner-execute. Anything without it cannot be `posix_spawn`ed. */
export const EXEC_BIT = 0o100;

function main() {
  if (process.platform === "win32") {
    return; // no exec bit, and no spawn-helper — Windows uses conpty
  }
  for (const root of ROOTS) {
    for (const helper of spawnHelpersUnder(root)) {
      try {
        const mode = statSync(helper).mode;
        if ((mode & EXEC_BIT) === 0) {
          chmodSync(helper, (mode & 0o7777) | 0o755);
        }
      } catch (error) {
        console.warn(`spawn-helper chmod skipped for ${helper}:`, error.message);
      }
    }
  }
}

// Only when run as the postinstall, never on import. The test beside this file
// imports `spawnHelpersUnder`, and a module that repaired the permissions as a
// side effect of being imported would make that test structurally incapable of
// failing — it would chmod the very files it was about to assert on.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
