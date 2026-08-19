/**
 * Starring Deck's own repository, through the user's `gh` CLI.
 *
 * Deck has no accounts and stores no token, so the star has to be made with
 * credentials that already exist on the machine. `gh` is the one place a
 * developer's GitHub authorization reliably lives, and Deck's users run agent
 * CLIs for a living — the assumption costs nothing when it is wrong, because
 * every failure here is one closed code the renderer answers by opening the
 * repository page in a browser instead.
 *
 * Nothing reaches a shell with data in it. The repository is a constant in
 * this file, `gh` is resolved to an absolute path once, and every call is an
 * `execFile` argv array. The ONE shell invocation is the PATH probe, whose
 * script is a literal — a packaged GUI process inherits a bare launchd PATH,
 * so an interactive login shell is the only way to find a Homebrew `gh`
 * (the reasoning `agents.ts` documents at length).
 */
import { execFile } from "node:child_process";
import { parseCommandVOutput } from "./agents";
import * as macos from "./platform/macos";
import * as windows from "./platform/windows";

/** `owner/repo` — the star endpoint's path segment, and never user input. */
const REPOSITORY = "mxrsv/spacevibe-deck";

/** A hanging rc file must not wedge the button; same budget as agent detect. */
const PROBE_TIMEOUT_MS = 3000;
/** One HTTP round trip through `gh`, plus its own start-up. */
const API_TIMEOUT_MS = 8000;

/**
 * `unavailable` is deliberately one code for "no `gh`", "not signed in" and
 * "the network refused": the renderer does the same thing for all three —
 * open the page and let the user press Star themselves — and a finer
 * vocabulary would only invite a UI that explains someone else's tool.
 */
export type GithubStarState = "starred" | "not-starred" | "unavailable";

export type GithubStarResult =
  { readonly ok: true } | { readonly ok: false; readonly error: "unavailable" };

/**
 * Resolved once per process. `undefined` = not probed yet, `null` = probed and
 * absent — a machine without `gh` must not pay for a login shell on every
 * board open.
 */
let ghPathCache: string | null | undefined;

function probeGhPath(): Promise<string | null> {
  if (process.platform === "win32") {
    return Promise.resolve(windows.resolveOnPath("gh"));
  }
  const launch = macos.shellLaunch();
  return new Promise((resolve) => {
    execFile(
      launch.executable,
      ["-ilc", "command -v gh"],
      { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, env: process.env },
      (_error, stdout) => {
        const found = parseCommandVOutput(String(stdout ?? ""), ["gh"]);
        resolve(found[0]?.path ?? null);
      },
    );
  });
}

async function ghPath(): Promise<string | null> {
  if (ghPathCache === undefined) {
    ghPathCache = await probeGhPath();
  }
  return ghPathCache;
}

interface GhOutcome {
  /** True when `gh` exited 0 — for these endpoints, HTTP 2xx. */
  readonly ok: boolean;
  /** Combined stderr, kept main-process side for classification only. */
  readonly stderr: string;
  /** True when `gh` itself could not be run at all. */
  readonly spawnFailed: boolean;
}

function runGh(
  args: readonly string[],
  executable: string,
): Promise<GhOutcome> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      {
        encoding: "utf8",
        timeout: API_TIMEOUT_MS,
        windowsHide: true,
        env: process.env,
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, stderr: "", spawnFailed: false });
          return;
        }
        resolve({
          ok: false,
          stderr: String(stderr ?? ""),
          spawnFailed: (error as NodeJS.ErrnoException).code === "ENOENT",
        });
      },
    );
  });
}

/**
 * Is the signed-in account starring Deck?
 *
 * `GET /user/starred/{repo}` answers 204 when it is and 404 when it is not,
 * which is why a 404 is the one failure that means something here — every
 * other one leaves the answer unknown, and unknown is reported as
 * `unavailable` so the caller shows the button rather than hiding it on a
 * guess.
 */
export async function readStarState(): Promise<GithubStarState> {
  const executable = await ghPath();
  if (executable === null) {
    return "unavailable";
  }
  const outcome = await runGh(
    ["api", "--silent", `user/starred/${REPOSITORY}`],
    executable,
  );
  if (outcome.ok) {
    return "starred";
  }
  if (outcome.spawnFailed) {
    // The cached path went stale (uninstalled between calls) — re-probe next
    // time rather than reporting "absent" forever.
    ghPathCache = undefined;
    return "unavailable";
  }
  return /HTTP 404/i.test(outcome.stderr) ? "not-starred" : "unavailable";
}

/**
 * Star the repository. Never rejects and never returns `gh`'s own text (C5/C6):
 * the caller's whole decision is "did it happen", and the text that explains
 * why it did not is logged here.
 */
export async function starRepository(): Promise<GithubStarResult> {
  const executable = await ghPath();
  if (executable === null) {
    return { ok: false, error: "unavailable" };
  }
  const outcome = await runGh(
    ["api", "--silent", "-X", "PUT", `user/starred/${REPOSITORY}`],
    executable,
  );
  if (outcome.ok) {
    return { ok: true };
  }
  if (outcome.spawnFailed) {
    ghPathCache = undefined;
  }
  console.error(
    `github_star failed: gh api -X PUT user/starred/${REPOSITORY} →`,
    outcome.stderr || "gh could not be run",
  );
  return { ok: false, error: "unavailable" };
}
