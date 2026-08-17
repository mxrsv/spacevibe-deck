/** Git branch for a pane's cwd — the port of `git_branch` in `info.rs`. */
import { execFile } from "node:child_process";

/**
 * Current branch name, or null outside a repository.
 *
 * Runs once per distinct pane cwd, not per poll tick. Every failure mode —
 * not a repo, git missing, detached HEAD with empty output — collapses to
 * null, because a branch label is decoration and must never surface an error.
 */
export function gitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      // `windowsHide`, like both siblings that spawn on this platform: this
      // runs on every cwd change, and without it Windows flashes a console
      // window each time. The same defect was found and fixed in the Rust host.
      { encoding: "utf8", timeout: 4000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const branch = stdout.trim();
        resolve(branch.length > 0 ? branch : null);
      },
    );
  });
}
