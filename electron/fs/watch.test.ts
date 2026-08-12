import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWatchRegistry, type WatchFs } from "./watch";

/**
 * The scope-set arithmetic and teardown, over a FAKE watcher.
 *
 * Whether `fs.watch` actually fires is a platform question no unit test can
 * answer — that is the manual pass's job, and the reason the design carries a
 * re-`stat` reconcile instead of trusting the watcher.
 */
let base: string;
let root: string;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "deck-fs-watch-"));
  root = path.join(base, "workspace");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "index.ts"), "a\n");
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

interface FakeWatcher {
  readonly directory: string;
  closed: boolean;
  fire(filename: string | null): void;
}

function fakeFs(): { io: WatchFs; watchers: FakeWatcher[] } {
  const watchers: FakeWatcher[] = [];
  const io: WatchFs = {
    watch(directory, listener) {
      const watcher: FakeWatcher = {
        directory,
        closed: false,
        fire: (filename) => listener("change", filename),
      };
      watchers.push(watcher);
      return {
        close() {
          watcher.closed = true;
        },
      };
    },
    statSync: (target) => fs.statSync(target),
  };
  return { io, watchers };
}

describe("scope", () => {
  it("watches expanded directories and the PARENTS of open files", () => {
    // A per-file watcher holds an inode, and every atomic writer — Deck's own
    // save included — renames a new file over the target. The parent sees that.
    const { io } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", {
      root,
      directories: [root],
      files: [path.join(root, "src", "index.ts")],
    });
    expect(registry.watchedDirectories("main")).toEqual(
      [root, path.join(root, "src")].sort(),
    );
  });

  it("watches one directory once when it is both expanded and a file's parent", () => {
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", {
      root,
      directories: [root, path.join(root, "src")],
      files: [path.join(root, "src", "index.ts")],
    });
    expect(watchers).toHaveLength(2);
  });

  it("REPLACES the set, so a collapsed directory cannot leak a watcher", () => {
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", {
      root,
      directories: [root, path.join(root, "src")],
      files: [],
    });
    registry.replace("main", { root, directories: [root], files: [] });
    expect(registry.watchedDirectories("main")).toEqual([root]);
    expect(watchers.find((w) => w.directory.endsWith("src"))?.closed).toBe(true);
  });

  it("keeps an unchanged directory's watcher across a replace", () => {
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", { root, directories: [root], files: [] });
    registry.replace("main", {
      root,
      directories: [root, path.join(root, "src")],
      files: [],
    });
    expect(watchers.filter((w) => w.directory === root)).toHaveLength(1);
  });

  it("survives a directory that vanished between listing and watching", () => {
    const io: WatchFs = {
      watch: () => {
        throw new Error("ENOENT");
      },
      statSync: (target) => fs.statSync(target),
    };
    const registry = createWatchRegistry(() => {}, io);
    expect(() =>
      registry.replace("main", { root, directories: [root], files: [] }),
    ).not.toThrow();
  });

  it("keeps two windows' scopes apart", () => {
    const { io } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", { root, directories: [root], files: [] });
    registry.replace("deck-2", {
      root,
      directories: [path.join(root, "src")],
      files: [],
    });
    expect(registry.watchedDirectories("main")).toEqual([root]);
    expect(registry.watchedDirectories("deck-2")).toEqual([
      path.join(root, "src"),
    ]);
  });
});

describe("events", () => {
  it("coalesces a duplicate fire into one event", () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(
      (_label, event) => events.push(event),
      io,
    );
    registry.replace("main", {
      root,
      directories: [path.join(root, "src")],
      files: [],
    });
    // fs.watch fires twice on macOS routinely.
    watchers[0].fire("index.ts");
    watchers[0].fire("index.ts");
    vi.advanceTimersByTime(100);
    expect(events).toEqual([
      {
        path: path.join(root, "src", "index.ts"),
        kind: "changed",
        mtimeMs: expect.any(Number),
        size: expect.any(Number),
      },
    ]);
  });

  it("reports a vanished file as deleted", () => {
    vi.useFakeTimers();
    const events: { kind: string }[] = [];
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(
      (_label, event) => events.push(event),
      io,
    );
    registry.replace("main", {
      root,
      directories: [path.join(root, "src")],
      files: [],
    });
    watchers[0].fire("never-existed.ts");
    vi.advanceTimersByTime(100);
    expect(events.map((event) => event.kind)).toEqual(["deleted"]);
  });

  it("ignores an entry of a directory nobody is showing", () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(
      (_label, event) => events.push(event),
      io,
    );
    // `src` is watched only as the parent of one open file, not as a listing.
    registry.replace("main", {
      root,
      directories: [],
      files: [path.join(root, "src", "index.ts")],
    });
    watchers[0].fire("sibling.ts");
    watchers[0].fire("index.ts");
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(1);
  });

  it("delivers to the window that asked, and only to it", () => {
    vi.useFakeTimers();
    const labels: string[] = [];
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry((label) => labels.push(label), io);
    registry.replace("main", { root, directories: [root], files: [] });
    registry.replace("deck-2", { root, directories: [root], files: [] });
    watchers[1].fire("readme.md");
    vi.advanceTimersByTime(100);
    expect(labels).toEqual(["deck-2"]);
  });
});

describe("teardown", () => {
  it("closes every watcher when the window dies", () => {
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", {
      root,
      directories: [root, path.join(root, "src")],
      files: [],
    });
    registry.forgetWindow("main");
    expect(watchers.every((w) => w.closed)).toBe(true);
    expect(registry.watchedDirectories("main")).toEqual([]);
  });

  it("drops a pending coalesced event with the window", () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(
      (_label, event) => events.push(event),
      io,
    );
    registry.replace("main", { root, directories: [root], files: [] });
    watchers[0].fire("readme.md");
    registry.forgetWindow("main");
    vi.advanceTimersByTime(100);
    expect(events).toEqual([]);
  });

  it("closes everything on dispose", () => {
    const { io, watchers } = fakeFs();
    const registry = createWatchRegistry(() => {}, io);
    registry.replace("main", { root, directories: [root], files: [] });
    registry.replace("deck-2", { root, directories: [root], files: [] });
    registry.dispose();
    expect(watchers.every((w) => w.closed)).toBe(true);
  });
});
