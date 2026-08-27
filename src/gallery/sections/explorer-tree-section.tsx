/**
 * The shipping explorer tree, at the docked column's 360px floor.
 *
 * The REAL component and the real store — not a drawing. It replaces the
 * `explorer header direction` comparison page, whose candidate C shipped on
 * 2026-08-25; that file stays in the tree as the record of the review, out of
 * the registry, like `unread-mark-variants`.
 *
 * What it exists to answer is measurable and nothing else can answer it: jsdom
 * has no layout, so "every row is still 22px, the cluster fits inside the root
 * row, and nothing overflows at the floor" is a browser question.
 */
import { useMemo } from "preact/hooks";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import { createFileSurfaceController } from "../../files/file-surface-controller";
import type { FileClient } from "../../files/file-client";
import { setListing, toggleDirectory } from "../../files/file-surface-store";
import type { DirEntry } from "../../files/file-tree";

const ROOT = "/Users/deck/spacevibe-workspace/spacevibe-deck";
/** DL-19.4's floor for the docked column. */
const COLUMN_FLOOR = "360px";

const dir = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: true,
  outOfRoot: false,
});
const file = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: false,
  outOfRoot: false,
});

/** Answers nothing: the specimen seeds the store directly, so no listing is
 * ever fetched and no write ever leaves the page. */
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

function seed(): void {
  setListing(ROOT, ROOT, [
    dir(ROOT, "electron"),
    dir(ROOT, "src"),
    file(ROOT, "AGENTS.md"),
    file(ROOT, "package.json"),
  ]);
  setListing(ROOT, `${ROOT}/src`, [dir(`${ROOT}/src`, "files"), file(`${ROOT}/src`, "main.tsx")]);
  setListing(ROOT, `${ROOT}/src/files`, [
    file(`${ROOT}/src/files`, "file-tree.ts"),
    file(`${ROOT}/src/files`, "entry-name.ts"),
  ]);
  toggleDirectory(ROOT, `${ROOT}/src`);
  toggleDirectory(ROOT, `${ROOT}/src/files`);
}

export function ExplorerTreeSection() {
  const controller = useMemo(() => {
    seed();
    return createFileSurfaceController({ client: inertClient });
  }, []);

  return (
    <section class="gx-section">
      <h2>explorer tree</h2>
      <p class="gx-note">
        The shipping <code>FileTreeView</code> at the docked column&rsquo;s 360px floor: the root as
        row 0 with a caret and no type glyph, and DL-19.9&rsquo;s four actions riding that row.
      </p>
      <div
        class="gx-explorer-tree"
        style={{ width: COLUMN_FLOOR, height: "260px", background: "var(--sidebar-bg)" }}
      >
        <ExplorerTab controller={controller} workspacePath={ROOT} canCreate />
      </div>
    </section>
  );
}
