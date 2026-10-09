/**
 * The shipping Changes list inside the Explorer, in every state it can be in
 * (plan 2026-10-10-changes-list, Task 4).
 *
 * The REAL `ExplorerTab` — the Files / Changes switch, the list, the status
 * line — over a fake controller that holds one state per frame. It replaces the
 * three-variant specimen page; variant A shipped, and B and C are in git
 * history (commit c04000b). What it exists to answer is a browser question:
 * does every state fit the docked column's 360px floor without overflow?
 * Never imported by shipping code (R7).
 */
import { useMemo } from "preact/hooks";
import { signal } from "@preact/signals";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import { createFileSurfaceController } from "../../files/file-surface-controller";
import type { FileClient } from "../../files/file-client";
import { setListing } from "../../files/file-surface-store";
import type { DirEntry } from "../../files/file-tree";
import { explorerView } from "../../files/changes/explorer-view";
import type { ChangesController, ChangesState } from "../../files/changes/changes-controller";
import type { ChangeEntry, ChangesSnapshot } from "../../host/git-changes-host";
import "./explorer-changes-section.css";

const HOME = "/Users/deck";
/** DL-19.4's floor for the docked column. */
const FLOOR = "360px";

// Each frame needs its own root, and the host stub answers `repository` only
// for the paths in its fixture list (`host-stub.ts`); `~/scratch` falls
// through to `plain` on purpose.
const ROOTS = {
  populated: `${HOME}/spacevibe-deck`,
  wide: `${HOME}/deck-worktrees/electron-migration`,
  clean: `${HOME}/spacevibe-api`,
  failed: `${HOME}/api-worktrees/billing`,
  initial: `${HOME}/spacevibe-hub`,
  plain: `${HOME}/scratch`,
};

const inertClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "gallery specimen" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 0, size: 0 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 0, size: 0 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root, parent, name) => ({ path: `${parent}/${name}` }),
  listenFileChanged: async () => () => {},
};

const entry = (over: Partial<ChangeEntry> & Pick<ChangeEntry, "path">): ChangeEntry => ({
  status: "modified",
  oldPath: null,
  added: 0,
  removed: 0,
  binary: false,
  counted: true,
  ...over,
});

const ENTRIES: readonly ChangeEntry[] = [
  entry({ path: "src/files/ui/changes-list.tsx", added: 212, removed: 14 }),
  entry({ path: "src/files/changes/changes-scheduler.ts", status: "added", added: 96 }),
  entry({ path: "electron/git/changes.ts", added: 31, removed: 7 }),
  entry({
    path: "docs/internals/file-surface.md",
    status: "renamed",
    oldPath: "docs/internals/file-surface-old.md",
  }),
  entry({ path: "src/styles/14-dock.css", added: 58, removed: 2 }),
  entry({ path: "public/brand/mark.png", status: "added", binary: true }),
  entry({ path: "scripts/old-gate.mjs", status: "deleted", removed: 40 }),
  entry({ path: "notes.txt", status: "untracked", added: 7 }),
  entry({
    path: "scratch/a-very-long-directory-name/with-a-deeper-one/and-a-long-file-name.ts",
    added: 3,
    removed: 1,
  }),
];

function snapshot(entries: readonly ChangeEntry[], over: Partial<ChangesSnapshot> = {}) {
  return {
    kind: "changes",
    branch: "feat/changes-list",
    detached: false,
    oid: null,
    initial: false,
    entries,
    omitted: 0,
    totals: {
      added: entries.reduce((sum, item) => sum + item.added, 0),
      removed: entries.reduce((sum, item) => sum + item.removed, 0),
    },
    ...over,
  } satisfies ChangesSnapshot;
}

function fakeController(initial: ChangesState): ChangesController {
  return {
    state: signal(initial),
    setShown: () => {},
    setWindowVisible: () => {},
    trigger: () => {},
    turnEnded: () => {},
    dispose: () => {},
  };
}

const idle = (
  root: string,
  snap: ChangesSnapshot | null,
  failure: ChangesState["failure"] = null,
) => fakeController({ root, snapshot: snap, failure, reading: false });

interface Frame {
  readonly label: string;
  readonly root: string;
  readonly width: string;
  readonly changes: ChangesController;
}

function frames(): readonly Frame[] {
  return [
    {
      label: "changes, 360px",
      root: ROOTS.populated,
      width: FLOOR,
      changes: idle(ROOTS.populated, snapshot(ENTRIES)),
    },
    {
      label: "changes, 520px, over the cap (37 not shown)",
      root: ROOTS.wide,
      width: "520px",
      changes: idle(ROOTS.wide, snapshot(ENTRIES, { omitted: 37 })),
    },
    {
      label: "clean",
      root: ROOTS.clean,
      width: FLOOR,
      changes: idle(ROOTS.clean, snapshot([])),
    },
    {
      label: "read failed: red line, last list kept",
      root: ROOTS.failed,
      width: FLOOR,
      changes: idle(ROOTS.failed, snapshot(ENTRIES.slice(0, 4)), {
        kind: "timeout",
        message: "git took longer than 10 s to answer",
      }),
    },
    {
      label: "no commit yet",
      root: ROOTS.initial,
      width: FLOOR,
      changes: idle(
        ROOTS.initial,
        snapshot([entry({ path: "README.md", status: "untracked", added: 12 })], {
          branch: "main",
          initial: true,
        }),
      ),
    },
    {
      label: "not a repository: Changes unavailable",
      root: ROOTS.plain,
      width: FLOOR,
      changes: idle(ROOTS.plain, null),
    },
  ];
}

function seedFiles(): void {
  const listing = (root: string, name: string): DirEntry[] => [
    { name, path: `${root}/${name}`, directory: false, outOfRoot: false },
  ];
  for (const root of Object.values(ROOTS)) {
    setListing(root, root, listing(root, "README.md"));
  }
}

export function ExplorerChangesSection() {
  const { controller, set } = useMemo(() => {
    seedFiles();
    // The switch is a window-wide choice; every frame but the unavailable one
    // shows the list.
    explorerView.value = "changes";
    return { controller: createFileSurfaceController({ client: inertClient }), set: frames() };
  }, []);

  return (
    <section class="gx-section">
      <h2>explorer changes</h2>
      <p class="gx-note">
        The shipping Changes list (variant A, the Files / Changes switch) at the docked
        column&rsquo;s 360px floor and at 520px. Counts are neutral and tabular, a deleted row is
        struck through and not pressable, and a failed read keeps the last list under a red line.
      </p>
      <div class="gx-changes-frames">
        {set.map((frame) => (
          <figure class="gx-changes-frame" key={frame.label}>
            <figcaption class="gx-changes-label">{frame.label}</figcaption>
            <div
              class="gx-changes-column"
              style={{ width: frame.width, background: "var(--sidebar-bg)" }}
            >
              <ExplorerTab
                controller={controller}
                workspacePath={frame.root}
                canCreate
                changesAvailable
                changes={frame.changes}
              />
            </div>
          </figure>
        ))}
      </div>
    </section>
  );
}
