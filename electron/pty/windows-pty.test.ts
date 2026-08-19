/**
 * A real ConPTY, on a real Windows, in CI.
 *
 * Everything else covering the Windows seam is pure: it takes a snapshot the
 * test wrote itself and checks the walk over it. That class of test cannot see
 * the bug that actually shipped — node-pty ignores `encoding: null` on Windows
 * (`windowsTerminal.js` warns and moves on), so the ConPTY path delivers
 * STRINGS where Unix delivers Buffers, `TextDecoder.decode` threw
 * ERR_INVALID_ARG_TYPE inside node-pty's own emitter where nothing catches it,
 * and the first Windows user to run the preview got a modal
 * "A JavaScript error occurred in the main process" and a pane that never
 * produced a byte.
 *
 * Only bytes moving through a real pty find that. `windows-check` already runs
 * this suite on a `windows-latest` runner, so the machine Gate C was waiting
 * for has been in CI the whole time — it was simply never asked an Electron
 * question.
 *
 * Skipped everywhere else, including the maintainer's Mac, where none of it
 * means anything.
 */
import { describe, expect, it } from "vitest";
import { createStreamDecoder } from "./stream";
import { buildShellLaunch, readProcessTable } from "../platform/windows";

const onWindows = process.platform === "win32";
/** Generous: a cold PowerShell on a shared runner is not fast. */
const OUTPUT_TIMEOUT_MS = 20_000;

describe.skipIf(!onWindows)("a real Windows pty", () => {
  it("produces output the stream decoder can read, and the injected prompt reports itself", async () => {
    const pty = await import("node-pty");
    const launch = buildShellLaunch();
    const session = pty.spawn(launch.executable, [...launch.args], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      // The exact option node-pty ignores here. Kept so this test spawns the
      // way `spawnShell` does rather than a way that happens to work.
      encoding: null,
    } as never);
    const decode = createStreamDecoder();

    try {
      const text = await new Promise<string>((resolve, reject) => {
        let seen = "";
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `No OSC 133 within ${OUTPUT_TIMEOUT_MS}ms. Saw: ${JSON.stringify(seen.slice(0, 400))}`,
              ),
            ),
          OUTPUT_TIMEOUT_MS,
        );
        session.onData((chunk) => {
          try {
            // THE line that threw on the user's machine.
            seen += decode(chunk as unknown as Uint8Array | string);
          } catch (error: unknown) {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          if (seen.includes("]133;")) {
            clearTimeout(timer);
            resolve(seen);
          }
        });
      });

      // OSC 133 means the prompt function survived `-Command`; OSC 9;9 is the
      // only source of a pane's working directory on this platform, so its
      // absence would be a silent loss of the cwd, the git branch and every
      // new tab's starting directory.
      expect(text).toContain("]133;");
      expect(text).toContain("]9;9;");
    } finally {
      session.kill();
    }
  }, 40_000);

  it("reads a process table that contains this very process", async () => {
    // Proves `Get-CimInstance` runs, emits the fields the parser expects, and
    // survives the NDJSON round trip — none of which the fixture-based tests
    // can establish.
    const rows = await readProcessTable();

    expect(rows.length).toBeGreaterThan(10);
    const self = rows.find((row) => row.pid === process.pid);
    expect(self).toBeDefined();
    expect(self?.creationDate).toBeGreaterThan(0);
    expect(self?.executable.toLowerCase()).toContain("node");
  }, 40_000);

  it("finds the shell it just launched in that table", async () => {
    // The join the pane classifier depends on: a spawned shell must be visible
    // as a row, or every pane reports `unknown` and the quit guard stops
    // guarding.
    const pty = await import("node-pty");
    const launch = buildShellLaunch();
    const session = pty.spawn(launch.executable, [...launch.args], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
    } as never);

    try {
      const rows = await readProcessTable();
      expect(rows.some((row) => row.pid === session.pid)).toBe(true);
    } finally {
      session.kill();
    }
  }, 40_000);
});
