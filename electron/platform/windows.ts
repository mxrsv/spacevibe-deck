/**
 * Windows platform seam — DELIBERATELY UNIMPLEMENTED.
 *
 * The Tauri build carries ~1,100 audited lines for Windows:
 * `platform/windows/job_object.rs` (428 LOC) creates a Job Object with
 * kill-on-close so a grandchild cannot outlive its pane, and
 * `platform/windows/process_snapshot.rs` (682 LOC) classifies a process tree
 * into IdleShell / Agent / Busy, feeding attention state and the quit census.
 *
 * Neither is ported, and that is a decision rather than an omission. No Windows
 * machine is available (Gate C in the migration spec), and porting a
 * kill-tree implementation that nobody can run would manufacture confidence in
 * exactly the code where being wrong is worst: a wrong classification either
 * lets Cmd/Ctrl+Q kill a working agent, or leaves the user unable to quit.
 *
 * The migration's written abort criterion covers this: if Windows kill-tree or
 * process inspection cannot be done without a native addon, the "pure Node/TS
 * host" decision was wrong and must be reopened explicitly.
 *
 * Failing loudly here is the point. A silent fallback to POSIX semantics would
 * produce a build that looks like it works on Windows and leaks processes.
 */

const GATE_C =
  "Windows support is not implemented in the Electron host (Gate C). " +
  "Kill-tree and process classification have no verified pure-Node path, and " +
  "no Windows machine is available to test one. See " +
  "docs/specs/2026-08-11-electron-migration-design.md §11.";

export class WindowsGateUnresolvedError extends Error {
  constructor(operation: string) {
    super(`${operation}: ${GATE_C}`);
    this.name = "WindowsGateUnresolvedError";
  }
}

export function shellLaunch(): never {
  throw new WindowsGateUnresolvedError("shellLaunch");
}

export function userHome(): never {
  throw new WindowsGateUnresolvedError("userHome");
}

export function readProcessTable(): never {
  throw new WindowsGateUnresolvedError("readProcessTable");
}

export function foregroundProcess(): never {
  throw new WindowsGateUnresolvedError("foregroundProcess");
}

export function terminateProcessGroups(): never {
  throw new WindowsGateUnresolvedError("terminateProcessGroups");
}
