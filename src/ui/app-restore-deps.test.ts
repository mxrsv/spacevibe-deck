import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dirsExist: vi.fn(async (paths: readonly string[]) => paths.map(() => true)),
  resumeLookup: vi.fn(async () => []),
  resumeWorkspace: vi.fn<(...args: never[]) => Promise<boolean>>(),
  reportPersistError: vi.fn(),
  suspendSessionJournal: vi.fn(),
  resumeSessionJournal: vi.fn(),
  flushSessionJournal: vi.fn(async () => undefined),
}));

vi.mock("../host/resume-host", () => ({ resumeLookup: mocks.resumeLookup }));
vi.mock("../files/file-client", () => ({ defaultFileClient: { statFiles: vi.fn() } }));
vi.mock("../terminal/pty-client", () => ({ defaultPtyClient: { dirsExist: mocks.dirsExist } }));
vi.mock("../terminal/session-restore", () => ({ resumeWorkspace: mocks.resumeWorkspace }));
vi.mock("../terminal/session-journal", async () => {
  const { signal } = await import("@preact/signals");
  return {
    sessionArchive: signal({}),
    suspendSessionJournal: mocks.suspendSessionJournal,
    resumeSessionJournal: mocks.resumeSessionJournal,
    flushSessionJournal: mocks.flushSessionJournal,
  };
});
vi.mock("../settings/settings-store", () => ({ settings: { value: { customAgents: [] } } }));
vi.mock("../chrome/events", () => ({ reportPersistError: mocks.reportPersistError }));
vi.mock("../repositories/repository-model", () => ({ worktreeForPath: () => null }));

import { sessionArchive } from "../terminal/session-journal";
import { resumeArchivedWorktree } from "./app-restore-deps";

const path = "/repo/worktree";
const manager = {} as never;

describe("resumeArchivedWorktree", () => {
  const setResuming = vi.fn();

  beforeEach(() => {
    sessionArchive.value = {};
    setResuming.mockClear();
    mocks.dirsExist.mockClear();
    mocks.resumeLookup.mockClear();
    mocks.resumeWorkspace.mockReset();
    mocks.reportPersistError.mockClear();
    mocks.suspendSessionJournal.mockClear();
    mocks.resumeSessionJournal.mockClear();
    mocks.flushSessionJournal.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("reports when the archive has no matching workspace", () => {
    resumeArchivedWorktree(path, {
      manager,
      resumingWorkspaces: new Set(),
      setResumingWorkspaces: setResuming,
    });

    expect(mocks.reportPersistError).toHaveBeenCalledWith("Couldn't find that archived workspace.");
    expect(mocks.suspendSessionJournal).not.toHaveBeenCalled();
    expect(mocks.resumeWorkspace).not.toHaveBeenCalled();
  });

  it("resumes an archived workspace and recaptures after releasing the journal", async () => {
    const entry = { savedAt: 1, tabs: [] } as const;
    sessionArchive.value = { [path]: entry };
    mocks.resumeWorkspace.mockResolvedValue(true);

    resumeArchivedWorktree(path, {
      manager,
      resumingWorkspaces: new Set(),
      setResumingWorkspaces: setResuming,
    });

    await vi.waitFor(() => expect(setResuming).toHaveBeenLastCalledWith(new Set()));

    expect(setResuming).toHaveBeenNthCalledWith(1, new Set([path]));
    expect(mocks.suspendSessionJournal).toHaveBeenCalledOnce();
    expect(mocks.resumeWorkspace).toHaveBeenCalledWith(expect.anything(), entry, path);
    expect(mocks.resumeSessionJournal).toHaveBeenCalledOnce();
    expect(mocks.flushSessionJournal).toHaveBeenCalledOnce();
    expect(mocks.resumeSessionJournal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.flushSessionJournal.mock.invocationCallOrder[0],
    );
    expect(mocks.reportPersistError).not.toHaveBeenCalled();
  });

  it("reports a failed resume and still recaptures the journal", async () => {
    sessionArchive.value = { [path]: { savedAt: 1, tabs: [] } };
    mocks.resumeWorkspace.mockResolvedValue(false);

    resumeArchivedWorktree(path, {
      manager,
      resumingWorkspaces: new Set(),
      setResumingWorkspaces: setResuming,
    });

    await vi.waitFor(() => expect(setResuming).toHaveBeenLastCalledWith(new Set()));

    expect(mocks.reportPersistError).toHaveBeenCalledWith("Couldn't resume that workspace.");
    expect(mocks.resumeSessionJournal).toHaveBeenCalledOnce();
    expect(mocks.flushSessionJournal).toHaveBeenCalledOnce();
  });

  it("reports a rejected resume and still releases and recaptures the journal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sessionArchive.value = { [path]: { savedAt: 1, tabs: [] } };
    mocks.resumeWorkspace.mockRejectedValue(new Error("restore failed"));

    resumeArchivedWorktree(path, {
      manager,
      resumingWorkspaces: new Set(),
      setResumingWorkspaces: setResuming,
    });

    await vi.waitFor(() => expect(setResuming).toHaveBeenLastCalledWith(new Set()));

    expect(mocks.reportPersistError).toHaveBeenCalledWith("Couldn't resume that workspace.");
    expect(mocks.resumeSessionJournal).toHaveBeenCalledOnce();
    expect(mocks.flushSessionJournal).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("Failed to resume archived workspace:", expect.any(Error));
  });

  it("clears the in-progress state and reports a recapture failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sessionArchive.value = { [path]: { savedAt: 1, tabs: [] } };
    mocks.resumeWorkspace.mockResolvedValue(true);
    mocks.flushSessionJournal.mockRejectedValue(new Error("store unavailable"));

    resumeArchivedWorktree(path, {
      manager,
      resumingWorkspaces: new Set(),
      setResumingWorkspaces: setResuming,
    });

    await vi.waitFor(() => expect(setResuming).toHaveBeenLastCalledWith(new Set()));

    expect(mocks.reportPersistError).toHaveBeenCalledWith("Couldn't save that restored workspace.");
    expect(warn).toHaveBeenCalledWith("Failed to capture restored workspace:", expect.any(Error));
    warn.mockRestore();
  });
});
