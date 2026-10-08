import { beforeEach, describe, expect, it, vi } from "vitest";

const { open, invoke, recordWorkspaceOpen, ensureRepositoriesScanned } = vi.hoisted(() => ({
  open: vi.fn(),
  invoke: vi.fn(),
  recordWorkspaceOpen: vi.fn(),
  ensureRepositoriesScanned: vi.fn(),
}));

vi.mock("../host/dialog-host", () => ({ open }));
vi.mock("../host/bridge", () => ({ invoke }));
vi.mock("../open-board/workspaces-store", () => ({ recordWorkspaceOpen }));
vi.mock("../repositories/repositories-store", () => ({ ensureRepositoriesScanned }));

import { addFolderToRail } from "./rail-add-folder";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("addFolderToRail (DL-27.14, amended 2026-10-08)", () => {
  it("records a picked folder and rescans it, with nothing to say", async () => {
    open.mockResolvedValue("/w/new");
    invoke.mockResolvedValue([true]);

    await expect(addFolderToRail()).resolves.toBeNull();

    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(recordWorkspaceOpen).toHaveBeenCalledExactlyOnceWith("/w/new");
    expect(ensureRepositoriesScanned).toHaveBeenCalledExactlyOnceWith(["/w/new"]);
  });

  it("changes nothing when the picker is cancelled", async () => {
    open.mockResolvedValue(null);

    await expect(addFolderToRail()).resolves.toBeNull();

    expect(invoke).not.toHaveBeenCalled();
    expect(recordWorkspaceOpen).not.toHaveBeenCalled();
  });

  it("reports a failed picker", async () => {
    open.mockRejectedValue(new Error("no display"));

    await expect(addFolderToRail()).resolves.toBe("Couldn't open the folder picker — try again");

    expect(recordWorkspaceOpen).not.toHaveBeenCalled();
  });

  it("refuses a folder that is gone", async () => {
    open.mockResolvedValue("/w/gone");
    invoke.mockResolvedValue([false]);

    await expect(addFolderToRail()).resolves.toBe("gone is missing — pick another folder");

    expect(recordWorkspaceOpen).not.toHaveBeenCalled();
  });

  it("goes ahead when the liveness probe itself fails", async () => {
    open.mockResolvedValue("/w/new");
    invoke.mockRejectedValue(new Error("probe"));

    await expect(addFolderToRail()).resolves.toBeNull();

    expect(recordWorkspaceOpen).toHaveBeenCalledExactlyOnceWith("/w/new");
  });
});
