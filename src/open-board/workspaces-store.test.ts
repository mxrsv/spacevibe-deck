import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async (key: string) => disk.get(key)),
      set: vi.fn(async (key: string, value: unknown) => void disk.set(key, value)),
      save: vi.fn(async () => {}),
    })),
  },
}));

const launcher = vi.hoisted(() => ({ enabled: true }));
vi.mock("../launcher/stage-launcher-enabled", () => ({
  stageLauncherEnabled: () => launcher.enabled,
}));

import { MAX_RECENTS, MAX_STORED_RECENTS, WORKSPACES_VERSION } from "../lib/workspace-recents";
import {
  initWorkspaces,
  recordWorkspaceOpen,
  removeWorkspaceRecents,
  shownWorkspaces,
  workspacesData,
} from "./workspaces-store";

const file = (count: number) => ({
  version: WORKSPACES_VERSION,
  recents: Array.from({ length: count }, (_, i) => ({ path: `/p${i}`, lastOpenedAt: 1_000 - i })),
});

beforeEach(async () => {
  launcher.enabled = true;
  disk.clear();
  workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  await initWorkspaces();
});

describe("workspace history", () => {
  it("keeps the project menu's history whole, while every list shows the newest few", async () => {
    for (let i = 0; i < 23; i += 1) recordWorkspaceOpen(`/p${i}`);

    expect(workspacesData.value.recents).toHaveLength(23);
    expect(shownWorkspaces.value.map((r) => r.path)).toEqual(
      workspacesData.value.recents.slice(0, MAX_RECENTS).map((r) => r.path),
    );
    expect(shownWorkspaces.value).toHaveLength(MAX_RECENTS);
  });

  it("caps what it writes at the stored limit, newest first", async () => {
    for (let i = 0; i < MAX_STORED_RECENTS + 5; i += 1) recordWorkspaceOpen(`/p${i}`);
    await Promise.resolve();

    const written = disk.get("workspaces") as ReturnType<typeof file>;
    expect(written.recents).toHaveLength(MAX_STORED_RECENTS);
    expect(written.recents[0].path).toBe(`/p${MAX_STORED_RECENTS + 4}`);
  });

  it("reads a long file back whole", async () => {
    disk.set("workspaces", file(MAX_STORED_RECENTS));

    await initWorkspaces();

    expect(workspacesData.value.recents).toHaveLength(MAX_STORED_RECENTS);
    expect(shownWorkspaces.value).toHaveLength(MAX_RECENTS);
  });

  it("lets the next-oldest folder take a removed folder's place in the shown list", async () => {
    disk.set("workspaces", file(12));
    await initWorkspaces();

    removeWorkspaceRecents(["/p0"]);

    expect(shownWorkspaces.value.map((r) => r.path)).toEqual(
      Array.from({ length: MAX_RECENTS }, (_, i) => `/p${i + 1}`),
    );
  });
});

describe("workspace history with the stage launcher off", () => {
  beforeEach(() => {
    launcher.enabled = false;
  });

  it("writes only the newest few, as before the launcher", async () => {
    for (let i = 0; i < MAX_RECENTS + 5; i += 1) recordWorkspaceOpen(`/p${i}`);
    await Promise.resolve();

    const written = disk.get("workspaces") as ReturnType<typeof file>;
    expect(written.recents).toHaveLength(MAX_RECENTS);
    expect(written.recents[0].path).toBe(`/p${MAX_RECENTS + 4}`);
  });

  it("reads a long file without error, keeping the newest few", async () => {
    disk.set("workspaces", file(MAX_STORED_RECENTS));

    await initWorkspaces();

    expect(workspacesData.value.recents.map((r) => r.path)).toEqual(
      Array.from({ length: MAX_RECENTS }, (_, i) => `/p${i}`),
    );
  });

  it("leaves one fewer after removing a folder, instead of revealing an older one", async () => {
    disk.set("workspaces", file(12));
    await initWorkspaces();

    removeWorkspaceRecents(["/p0"]);

    expect(shownWorkspaces.value).toHaveLength(MAX_RECENTS - 1);
    expect(shownWorkspaces.value.map((r) => r.path)).not.toContain(`/p${MAX_RECENTS}`);
  });
});
