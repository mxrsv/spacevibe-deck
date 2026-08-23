import { beforeEach, describe, expect, it } from "vitest";
import { boardOpen } from "../chrome/events";
import {
  clearDraft,
  closeQuickLaunch,
  newTaskDraft,
  openQuickLaunch,
  prefillWorkspace,
  quickLaunchOpen,
  quickLaunchWorkspace,
  resetLauncherStore,
  transferToBoard,
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
