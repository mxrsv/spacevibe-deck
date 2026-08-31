import { beforeEach, describe, expect, it } from "vitest";
import { boardOpen } from "../chrome/events";
import {
  clearDraft,
  clearDraftAndUseRetarget,
  closeQuickLaunch,
  keepDraftWorkspace,
  moveDraftToRetarget,
  newTaskDraft,
  taskDraftTouched,
  openQuickLaunch,
  prefillWorkspace,
  quickLaunchOpen,
  quickLaunchRetarget,
  quickLaunchWorkspace,
  resetLauncherStore,
  transferToBoard,
  toggleQuickLaunch,
  updateDraft,
} from "./launcher-store";
import { withAgent, withPrompt } from "./new-task-draft";

beforeEach(() => {
  resetLauncherStore();
  boardOpen.value = false;
});

describe("launcher-store", () => {
  it("keeps the draft across closing and reopening quick launch", () => {
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    openQuickLaunch("/repo");
    closeQuickLaunch();
    openQuickLaunch(null);
    expect(newTaskDraft.value.prompt).toBe("ship it");
  });

  it("clears the pinned workspace when quick launch closes", () => {
    openQuickLaunch("/repo");
    expect(quickLaunchOpen.value).toBe(true);
    expect(quickLaunchWorkspace.value).toBe("/repo");
    closeQuickLaunch();
    expect(quickLaunchOpen.value).toBe(false);
    expect(quickLaunchWorkspace.value).toBeNull();
  });

  it("prefills the pinned workspace into the draft when it opens", () => {
    openQuickLaunch("/repo");
    expect(newTaskDraft.value.workspacePath).toBe("/repo");
  });

  it("closes when the active trigger is pressed again", () => {
    toggleQuickLaunch("/repo");
    expect(quickLaunchOpen.value).toBe(true);
    toggleQuickLaunch("/repo");
    expect(quickLaunchOpen.value).toBe(false);
  });

  it("asks before retargeting a draft that belongs to another project", () => {
    toggleQuickLaunch("/repo/a");
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    const before = newTaskDraft.value;
    toggleQuickLaunch("/repo/b");
    expect(quickLaunchOpen.value).toBe(true);
    expect(quickLaunchWorkspace.value).toBe("/repo/b");
    expect(newTaskDraft.value).toBe(before);
    expect(newTaskDraft.value.workspacePath).toBe("/repo/a");
    expect(quickLaunchRetarget.value).toEqual({
      currentPath: "/repo/a",
      requestedPath: "/repo/b",
    });
  });

  it("retargets an untouched contextual draft without an unnecessary choice", () => {
    openQuickLaunch("/repo/a");
    closeQuickLaunch();
    openQuickLaunch("/repo/b");

    expect(taskDraftTouched.value).toBe(false);
    expect(newTaskDraft.value.workspacePath).toBe("/repo/b");
    expect(quickLaunchRetarget.value).toBeNull();
  });

  it("does not treat an auto-seeded workspace and agent as user-authored content", () => {
    prefillWorkspace("/repo/a", "claude");
    openQuickLaunch("/repo/b");

    expect(taskDraftTouched.value).toBe(false);
    expect(newTaskDraft.value.workspacePath).toBe("/repo/b");
    expect(newTaskDraft.value.agentId).toBe("claude");
    expect(quickLaunchRetarget.value).toBeNull();
  });

  it("reuses the same project without raising a retarget choice", () => {
    openQuickLaunch("/repo/a");
    closeQuickLaunch();
    openQuickLaunch("/repo/a");
    expect(quickLaunchRetarget.value).toBeNull();
    expect(newTaskDraft.value.workspacePath).toBe("/repo/a");
  });

  it("keeps, moves, or clears the draft only through explicit choices", () => {
    openQuickLaunch("/repo/a");
    updateDraft(withPrompt(withAgent(newTaskDraft.value, "codex", null), "ship it"));
    openQuickLaunch("/repo/b");

    keepDraftWorkspace();
    expect(newTaskDraft.value.workspacePath).toBe("/repo/a");
    expect(newTaskDraft.value.prompt).toBe("ship it");
    expect(quickLaunchRetarget.value).toBeNull();

    openQuickLaunch("/repo/b");
    moveDraftToRetarget();
    expect(newTaskDraft.value.workspacePath).toBe("/repo/b");
    expect(newTaskDraft.value.prompt).toBe("ship it");
    expect(newTaskDraft.value.agentId).toBe("codex");

    openQuickLaunch("/repo/c");
    clearDraftAndUseRetarget();
    expect(newTaskDraft.value.workspacePath).toBe("/repo/c");
    expect(newTaskDraft.value.prompt).toBe("");
    expect(newTaskDraft.value.agentId).toBeNull();
    expect(quickLaunchRetarget.value).toBeNull();
  });

  it("prefills a workspace without touching an explicit agent choice", () => {
    updateDraft(withAgent(newTaskDraft.value, "codex", null));
    prefillWorkspace("/repo", "claude");
    expect(newTaskDraft.value.workspacePath).toBe("/repo");
    expect(newTaskDraft.value.agentId).toBe("codex");
  });

  it("seeds the agent only while the draft has none", () => {
    prefillWorkspace("/repo", "claude");
    expect(newTaskDraft.value.agentId).toBe("claude");
  });

  it("leaves the agent null when no seed is offered", () => {
    prefillWorkspace("/repo");
    expect(newTaskDraft.value.agentId).toBeNull();
  });

  it("transfers the whole draft to the board and closes quick launch", () => {
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    openQuickLaunch("/repo");
    transferToBoard();
    expect(quickLaunchOpen.value).toBe(false);
    expect(boardOpen.value).toBe(true);
    expect(newTaskDraft.value.prompt).toBe("ship it");
    expect(newTaskDraft.value.workspacePath).toBe("/repo");
  });

  it("clears a pending retarget when quick launch closes", () => {
    openQuickLaunch("/repo/a");
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    openQuickLaunch("/repo/b");
    expect(quickLaunchRetarget.value).not.toBeNull();
    closeQuickLaunch();
    expect(quickLaunchRetarget.value).toBeNull();
  });

  it("clearDraft empties everything", () => {
    updateDraft(withPrompt(withAgent(newTaskDraft.value, "claude", null), "ship it"));
    prefillWorkspace("/repo");
    clearDraft();
    expect(newTaskDraft.value.prompt).toBe("");
    expect(newTaskDraft.value.workspacePath).toBeNull();
    expect(newTaskDraft.value.agentId).toBeNull();
  });

  it("keeps the prompt-expanded preference across a clear", () => {
    updateDraft({ ...newTaskDraft.value, promptExpanded: false });
    clearDraft();
    expect(newTaskDraft.value.promptExpanded).toBe(false);
  });
});
