// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../host/bridge", () => ({ invoke: vi.fn(async () => null) }));

import type { RepositoryScan } from "./repository-client";
import {
  configureRepositoryClient,
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  invalidateRepositoryScans,
  refreshRepositoryScans,
  repositoryScans,
} from "./repositories-store";

function repo(key: string, worktreePaths: readonly string[]): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktreePaths[0],
    worktrees: worktreePaths.map((path) => ({
      path,
      head: "0".repeat(40),
      branch: null,
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  };
}

const BOTH = repo("/r/.git", ["/r/main", "/r/side"]);
const PRIMARY_ONLY = repo("/r/.git", ["/r/main"]);

/** Let every scan promise and its `.then` settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("repository scan refresh", () => {
  let answers: RepositoryScan;
  let scanned: string[];

  beforeEach(() => {
    answers = BOTH;
    scanned = [];
    invalidateRepositoryScans();
    configureRepositoryClient({
      scan: async (path) => {
        scanned.push(path);
        return answers;
      },
    });
  });

  it("keeps the previous scans on screen while it re-reads", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();
    expect(repositoryScans.value.get("/r/main")).toBe(BOTH);

    refreshRepositoryScans();

    // The window came back and git has not answered yet. Emptying the map here
    // is what made the rail re-key every cluster to `plain:<path>`, split each
    // repository into one cluster per worktree and unfold every remembered
    // header — then put it all back a moment later.
    expect(repositoryScans.value.get("/r/main")).toBe(BOTH);
    expect(repositoryScans.value.size).toBeGreaterThan(0);
  });

  it("re-reads a path it has already answered once refreshed", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();
    expect(scanned).toEqual(["/r/main"]);

    // Without a refresh the answer stands: one scan serves every worktree.
    ensureRepositoriesScanned(["/r/main", "/r/side"]);
    await settle();
    expect(scanned).toEqual(["/r/main"]);

    refreshRepositoryScans();
    ensureRepositoriesScanned(["/r/main"]);
    await settle();
    expect(scanned).toEqual(["/r/main", "/r/main"]);
  });

  it("drops a worktree the fresh scan no longer reports", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();
    expect(repositoryScans.value.has("/r/side")).toBe(true);

    // The reason the map was emptied in the first place: a worktree removed on
    // disk has to be able to leave the list. Replacing per repository does that
    // without an empty window.
    answers = PRIMARY_ONLY;
    refreshRepositoryScans();
    ensureRepositoriesScanned(["/r/main"]);
    await settle();

    expect(repositoryScans.value.get("/r/main")).toBe(PRIMARY_ONLY);
    expect(repositoryScans.value.has("/r/side")).toBe(false);
  });

  it("ignores a scan that lands after a newer refresh superseded it", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();

    // Held in an object rather than a `let`: TypeScript narrows a local
    // assigned only inside a Promise executor to `never` at the call below.
    const held: { release?: (scan: RepositoryScan) => void } = {};
    configureRepositoryClient({
      scan: async () =>
        new Promise<RepositoryScan>((resolve) => {
          held.release = resolve;
        }),
    });
    refreshRepositoryScans();
    ensureRepositoriesScanned(["/r/main"]);
    await settle();

    // A second refresh while that read is still out.
    refreshRepositoryScans();
    held.release?.(PRIMARY_ONLY);
    await settle();

    // The stale answer must not land: it describes the repository as it was
    // before the event that asked for a re-read.
    expect(repositoryScans.value.get("/r/main")).toBe(BOTH);
  });

  it("still empties the map on an explicit invalidate", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();

    // The hard reset the suite's own `beforeEach` hooks depend on.
    invalidateRepositoryScans();
    expect(repositoryScans.value.size).toBe(0);
  });

  it("refreshes rather than empties when the window comes back", async () => {
    ensureRepositoriesScanned(["/r/main"]);
    await settle();
    const dispose = installRepositoryRescanOnFocus();

    window.dispatchEvent(new Event("focus"));

    expect(repositoryScans.value.get("/r/main")).toBe(BOTH);
    dispose();
  });
});
