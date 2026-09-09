import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addWorktree } from "./worktree";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ lstat: vi.fn() }));

const execFileMock = vi.mocked(execFile);

/** Queues the next `execFile` call to resolve with this error/stderr pair. */
function mockNextRun(
  error: (Error & { code?: string | number }) | null,
  stderr = "",
  stdout = "",
): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: (Error & { code?: string }) | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(error as Error | null, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

describe("addWorktree", () => {
  afterEach(() => {
    execFileMock.mockReset();
    vi.mocked(lstat).mockReset();
  });

  it("resolves ok with the destination path on success", async () => {
    mockNextRun(null);
    const result = await addWorktree({
      repoPath: "/repo",
      branch: "feature/x",
      destPath: "/repo-worktrees/feature-x",
    });
    expect(result).toEqual({ ok: true, path: "/repo-worktrees/feature-x" });
  });

  it("runs `git -C <repoPath> worktree add <destPath> -b <branch>`", async () => {
    mockNextRun(null);
    await addWorktree({
      repoPath: "/repo",
      branch: "feature/x",
      destPath: "/repo-worktrees/feature-x",
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "worktree", "add", "/repo-worktrees/feature-x", "-b", "feature/x"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("classifies 'not a git repository' as not-a-repository", async () => {
    mockNextRun(
      new Error("Command failed"),
      "fatal: not a git repository (or any of the parent directories): .git\n",
    );
    const result = await addWorktree({
      repoPath: "/not-a-repo",
      branch: "x",
      destPath: "/dest",
    });
    expect(result).toEqual({ ok: false, error: "not-a-repository" });
  });

  it("classifies an existing branch as branch-exists", async () => {
    mockNextRun(new Error("Command failed"), "fatal: a branch named 'feature' already exists\n");
    const result = await addWorktree({
      repoPath: "/repo",
      branch: "feature",
      destPath: "/dest",
    });
    expect(result).toEqual({ ok: false, error: "branch-exists" });
  });

  it("classifies an existing destination as destination-exists", async () => {
    mockNextRun(new Error("Command failed"), "fatal: '/dest' already exists\n");
    const result = await addWorktree({
      repoPath: "/repo",
      branch: "x",
      destPath: "/dest",
    });
    expect(result).toEqual({ ok: false, error: "destination-exists" });
  });

  it("classifies a missing git binary as git-not-found", async () => {
    const enoent = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
    });
    mockNextRun(enoent, "");
    const result = await addWorktree({
      repoPath: "/repo",
      branch: "x",
      destPath: "/dest",
    });
    expect(result).toEqual({ ok: false, error: "git-not-found" });
  });

  it("falls back to unknown for an unrecognized failure", async () => {
    mockNextRun(new Error("Command failed"), "fatal: something else entirely\n");
    const result = await addWorktree({
      repoPath: "/repo",
      branch: "x",
      destPath: "/dest",
    });
    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("never leaks stderr text back to the caller", async () => {
    mockNextRun(
      new Error("Command failed"),
      "fatal: not a git repository (or any of the parent directories): .git\n",
    );
    const result = await addWorktree({
      repoPath: "/not-a-repo",
      branch: "x",
      destPath: "/dest",
    });
    expect(JSON.stringify(result)).not.toContain("fatal:");
  });

  it("allows a checkout to take up to one minute", async () => {
    mockNextRun(null);
    await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" });
    expect(execFileMock.mock.calls[0][2]).toMatchObject({ timeout: 60_000 });
  });

  it.each([
    ["fatal: 'bad name' is not a valid branch name", "invalid-branch"],
    ["fatal: cannot mkdir '/dest': Permission denied", "permission-denied"],
    ["fatal: invalid reference: HEAD", "no-commits"],
    ["fatal: not a valid object name: 'HEAD'", "no-commits"],
    ["fatal: cannot change to '/missing': No such file or directory", "repository-unavailable"],
    ["fatal: cannot create directory: No space left on device", "disk-full"],
  ])("classifies %s", async (stderr, code) => {
    mockNextRun(new Error("Command failed"), stderr);
    expect(await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" })).toEqual({
      ok: false,
      error: code,
    });
  });

  it("reports a timeout only after confirming that no branch, directory or registration remains", async () => {
    mockNextRun(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }));
    mockNextRun(null); // no matching branch
    mockNextRun(null, "", "worktree /repo\0HEAD abc\0branch refs/heads/main\0\0");
    vi.mocked(lstat).mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" })).toEqual({
      ok: false,
      error: "timed-out",
    });
    expect(execFileMock).toHaveBeenCalledTimes(3);
    expect(lstat).toHaveBeenCalledWith(path.resolve("/dest"));
  });

  it.each(["branch", "directory", "registration"])(
    "reports timeout leftovers: %s",
    async (leftover) => {
      mockNextRun(Object.assign(new Error("timed out"), { killed: true }));
      mockNextRun(null, "", leftover === "branch" ? "refs/heads/x\n" : "");
      mockNextRun(
        null,
        "",
        leftover === "registration" ? "worktree /dest\0HEAD abc\0branch refs/heads/x\0\0" : "",
      );
      if (leftover === "directory") {
        vi.mocked(lstat).mockResolvedValueOnce({} as Awaited<ReturnType<typeof lstat>>);
      } else {
        vi.mocked(lstat).mockRejectedValueOnce(
          Object.assign(new Error("missing"), { code: "ENOENT" }),
        );
      }
      expect(await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" })).toEqual({
        ok: false,
        error: "incomplete-worktree",
      });
      expect(execFileMock).toHaveBeenCalledTimes(3); // inspection only, no cleanup or retry
    },
  );

  it("does not recommend retrying when timeout inspection fails", async () => {
    mockNextRun(Object.assign(new Error("timed out"), { killed: true }));
    mockNextRun(new Error("cannot inspect refs"));
    mockNextRun(null);
    vi.mocked(lstat).mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" })).toEqual({
      ok: false,
      error: "recovery-check-failed",
    });
  });
});

describe("worktree input and recovery guards", () => {
  afterEach(() => {
    execFileMock.mockReset();
    vi.mocked(lstat).mockReset();
  });

  it.each(["worktree-list", "destination-access"])(
    "fails closed when %s cannot be inspected",
    async (probe) => {
      mockNextRun(Object.assign(new Error("timed out"), { killed: true }));
      mockNextRun(null);
      mockNextRun(probe === "worktree-list" ? new Error("cannot list worktrees") : null);
      vi.mocked(lstat).mockRejectedValueOnce(
        Object.assign(new Error("cannot inspect"), {
          code: probe === "destination-access" ? "EACCES" : "ENOENT",
        }),
      );
      expect(await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest" })).toEqual({
        ok: false,
        error: "recovery-check-failed",
      });
    },
  );

  it.each([
    [{ repoPath: "relative" }, "invalid-path"],
    [{ destPath: "relative" }, "invalid-path"],
    [{ repoPath: "/repo\0" }, "invalid-path"],
    [{ destPath: "/dest\0" }, "invalid-path"],
    [{ branch: " " }, "invalid-branch"],
    [{ branch: "-B" }, "invalid-branch"],
    [{ branch: "x\0" }, "invalid-branch"],
  ])("rejects invalid inputs before running Git: %j", async (input, error) => {
    expect(
      await addWorktree({ repoPath: "/repo", branch: "x", destPath: "/dest", ...input }),
    ).toEqual({ ok: false, error });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("addWorktree with real Git", () => {
  let scratch: string;
  let repoPath: string;
  const fs = () => vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const child = () => vi.importActual<typeof import("node:child_process")>("node:child_process");

  async function git(...args: string[]): Promise<string> {
    const { execFileSync } = await child();
    return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  }

  beforeEach(async () => {
    const realFs = await fs();
    scratch = await realFs.mkdtemp(path.join(tmpdir(), "deck-worktree-test-"));
    repoPath = path.join(scratch, "repo");
    await realFs.mkdir(repoPath);
    await realFs.mkdir(path.join(scratch, "hooks"));
    const { execFile: realExecFile } = await child();
    execFileMock.mockImplementation(realExecFile);
    vi.mocked(lstat).mockImplementation(realFs.lstat);
    await git("init", "-q");
    await git("config", "core.hooksPath", path.join(scratch, "hooks"));
    await git(
      "-c",
      "user.name=Deck test",
      "-c",
      "user.email=deck@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-qm",
      "Initial",
    );
  });

  afterEach(async () => {
    execFileMock.mockReset();
    vi.mocked(lstat).mockReset();
    if (scratch) await (await fs()).rm(scratch, { recursive: true, force: true });
  });

  it("creates a real checkout and refuses to overwrite its branch on retry", async () => {
    const destPath = path.join(scratch, "checkout with spaces");
    const params = { repoPath, branch: "feature/task", destPath };
    expect(await addWorktree(params)).toEqual({ ok: true, path: destPath });
    const realFs = await fs();
    await realFs.writeFile(path.join(destPath, "keep.txt"), "user work");
    expect(await addWorktree(params)).toEqual({ ok: false, error: "branch-exists" });
    expect(await realFs.readFile(path.join(destPath, "keep.txt"), "utf8")).toBe("user work");
    expect(await git("branch", "--list", "feature/task")).toContain("feature/task");
  });

  it("reports a real invalid branch name", async () => {
    expect(
      await addWorktree({ repoPath, branch: "bad name", destPath: path.join(scratch, "invalid") }),
    ).toEqual({ ok: false, error: "invalid-branch" });
  });

  it("reports an unborn current branch when Git cannot use HEAD", async () => {
    await git("symbolic-ref", "HEAD", "refs/heads/unborn");
    expect(
      await addWorktree({
        repoPath,
        branch: "task",
        destPath: path.join(scratch, "empty-worktree"),
      }),
    ).toEqual({ ok: false, error: "no-commits" });
  });

  it.skipIf(process.platform === "win32")(
    "allows a real checkout hook to run past the old four-second timeout",
    async () => {
      await (
        await fs()
      ).writeFile(path.join(scratch, "hooks", "post-checkout"), "#!/bin/sh\nsleep 5\n", {
        mode: 0o755,
      });
      const destPath = path.join(scratch, "slow");
      expect(await addWorktree({ repoPath, branch: "slow", destPath })).toEqual({
        ok: true,
        path: destPath,
      });
    },
    15_000,
  );

  it.skipIf(process.platform === "win32")(
    "inspects a genuinely interrupted Git checkout without deleting it",
    async () => {
      const realFs = await fs();
      await realFs.writeFile(path.join(scratch, "hooks", "post-checkout"), "#!/bin/sh\nsleep 2\n", {
        mode: 0o755,
      });
      const { execFile: realExecFile } = await child();
      // Keep the production timeout test above; shorten only this real interruption.
      execFileMock.mockImplementationOnce(((file, args, options, callback) =>
        realExecFile(file, args, { ...options, timeout: 500 }, callback)) as typeof execFile);
      const destPath = path.join(scratch, "interrupted");
      expect(await addWorktree({ repoPath, branch: "interrupted", destPath })).toEqual({
        ok: false,
        error: "incomplete-worktree",
      });
      expect(await realFs.readFile(path.join(destPath, ".git"), "utf8")).toContain("gitdir:");
      expect(await git("branch", "--list", "interrupted")).toContain("interrupted");
    },
    10_000,
  );
});
