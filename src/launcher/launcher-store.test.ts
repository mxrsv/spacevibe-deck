import { beforeEach, describe, expect, it } from "vitest";
import { boardOpen } from "../chrome/events";
import {
  clearDraft,
  newTaskDraft,
  taskDraftTouched,
  prefillWorkspace,
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
  it("does not treat an auto-seeded workspace and agent as user-authored content", () => {
    prefillWorkspace("/repo/a", "claude");

    expect(taskDraftTouched.value).toBe(false);
    expect(newTaskDraft.value.workspacePath).toBe("/repo/a");
    expect(newTaskDraft.value.agentId).toBe("claude");
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

  it("transfers the whole draft to the board", () => {
    updateDraft(withPrompt(newTaskDraft.value, "ship it"));
    prefillWorkspace("/repo");
    transferToBoard();
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
