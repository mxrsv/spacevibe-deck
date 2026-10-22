// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_DESTINATION, FIXTURE_PARENT, FIXTURE_REQUEST } from "../../src/lib/clone-fixtures";
import { createHarness, queueChild, type Harness } from "./clone-test-support";

let h: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  h = createHarness();
  h.vfs.directories.add(FIXTURE_PARENT);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("failures", () => {
  const cases: [string, string, string][] = [
    [
      "authentication-required",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "https",
    ],
    [
      "authentication-required",
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      "ssh key",
    ],
    [
      "authentication-required",
      "fatal: Authentication failed for 'https://github.com/x/y.git/'",
      "bad token",
    ],
    [
      "repository-unavailable",
      "remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found",
      "https missing",
    ],
    [
      "repository-unavailable",
      "ERROR: Repository not found.\nfatal: Could not read from remote repository.",
      "ssh missing",
    ],
    [
      "network",
      "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
      "dns",
    ],
    [
      "network",
      "ssh: Could not resolve hostname github.com\nfatal: Could not read from remote repository.",
      "ssh dns",
    ],
    [
      "network",
      "error: RPC failed; curl 56 OpenSSL SSL_read: connection reset\nfatal: early EOF",
      "reset",
    ],
    [
      "permission-denied",
      "fatal: could not create work tree dir '/x/y': Permission denied",
      "local",
    ],
    [
      "disk-full",
      "error: unable to write file a: No space left on device\nwarning: Clone succeeded, but checkout failed.",
      "disk",
    ],
    ["incomplete-checkout", "warning: Clone succeeded, but checkout failed.", "checkout"],
    ["unknown", "fatal: something nobody planned for", "other"],
  ];

  it.each(cases)("classifies %s (%s)", async (expected, stderr) => {
    const child = queueChild(h);
    await h.service.start("w1", FIXTURE_REQUEST);
    child.write(`${stderr}\n`);
    child.finish(128);
    await h.settle();
    expect(h.service.status("w1")).toMatchObject({
      phase: "failed",
      error: expected,
      leftoverPath: null,
      percent: null,
    });
    expect(h.locks.size).toBe(0);
  });

  it.each(["http-proxy", "ssl-tools", "tls"])(
    "classifies by git's words, not the folder name %s",
    async (name) => {
      const child = queueChild(h);
      const started = await h.service.start("w1", {
        ...FIXTURE_REQUEST,
        repository: `someone/${name}`,
        name,
      });
      const destination = started.ok ? started.job.destination : "";
      child.write(`Cloning into '${destination}'...\n`);
      child.write(`fatal: could not create work tree dir '${destination}': Permission denied\n`);
      child.finish(128);
      await h.settle();
      expect(h.service.status("w1")).toMatchObject({
        phase: "failed",
        error: "permission-denied",
      });
    },
  );

  it("discloses what a failed clone left behind, and deletes nothing", async () => {
    const child = queueChild(h);
    await h.service.start("w1", FIXTURE_REQUEST);
    h.vfs.directories.add(FIXTURE_DESTINATION);
    child.write("fatal: the remote end hung up unexpectedly\n");
    child.finish(128);
    await h.settle();
    expect(h.service.status("w1")).toMatchObject({
      phase: "failed",
      leftoverPath: FIXTURE_DESTINATION,
    });
    expect(h.vfs.directories.has(FIXTURE_DESTINATION)).toBe(true);
    expect(h.spawn).toHaveBeenCalledTimes(1); // no automatic retry
  });

  it("keeps the error text when a flood of output precedes it", async () => {
    const child = queueChild(h);
    await h.service.start("w1", FIXTURE_REQUEST);
    for (let index = 0; index < 400; index += 1) {
      child.write(`remote: noise ${"x".repeat(2_000)}\n`);
    }
    child.write("remote: Repository not found.\n");
    child.finish(128);
    await h.settle();
    expect(h.service.status("w1")?.error).toBe("repository-unavailable");
    const logged = JSON.stringify(h.logs);
    expect(logged.length).toBeLessThan(8_000); // the log carries a bounded tail
  });

  it("never lets stderr or credentials into a snapshot or a log", async () => {
    const child = queueChild(h);
    await h.service.start("w1", FIXTURE_REQUEST);
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    child.write(`fatal: unable to access 'https://octocat:${token}@github.com/x/y.git/': 403\n`);
    child.write(`fatal: also https://user:hunter2@example.com/r.git and ${token}\n`);
    child.finish(128);
    await h.settle();

    const everything = JSON.stringify([h.events, h.service.status("w1")]);
    expect(everything).not.toMatch(/ghp_|hunter2|octocat:|fatal/);
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toMatch(/ghp_|hunter2|octocat:/);
    expect(logged).toContain("***@");
  });
});
