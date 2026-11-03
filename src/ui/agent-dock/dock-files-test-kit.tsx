/** Test seam: the dock's file bodies over a real controller and an in-memory file client. */
import { selectDockFile } from "./agent-dock-state";
import type { DockFileBodies } from "./dock-column";
import { createFileSurfaceController } from "../../files/file-surface-controller";
import type { FileClient } from "../../files/file-client";

export const fakeFileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root: string, parent: string, name: string) => ({
    path: `${parent}/${name}`,
  }),
  listenFileChanged: async () => () => {},
};

export interface TestFileBodiesOptions {
  readonly explorer?: DockFileBodies["explorer"];
  readonly document?: DockFileBodies["document"];
  readonly confirmDiscard?: (dirtyFiles: readonly string[]) => Promise<boolean>;
  readonly client?: FileClient;
}

/** Bodies that print what they were asked to show, so a test reads which one is on screen. */
export function testFileBodies(options: TestFileBodiesOptions = {}): DockFileBodies {
  return {
    controller: createFileSurfaceController({
      client: options.client ?? fakeFileClient,
      confirmDiscard: options.confirmDiscard,
      // What `App` wires: a file taking the stage puts its tab on the dock's body.
      beforeActivate: selectDockFile,
    }),
    explorer: options.explorer ?? ((root) => <p>explorer body at {root ?? "no folder"}</p>),
    document: options.document ?? ((root) => <p>document body at {root}</p>),
  };
}
