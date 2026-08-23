import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  openAgentProblem,
  startTaskProblem,
  withAgent,
  withPrompt,
  withPromptExpanded,
  withRuntime,
  withWorkspace,
  type DraftContext,
} from "./new-task-draft";
import { runtimeFor } from "./runtime-catalog";

const RUNNABLE: DraftContext = { runnableAgentIds: ["claude"], unavailableAgentIds: [] };

describe("new-task-draft", () => {
  it("never mutates the draft it was given", () => {
    const next = withPrompt(EMPTY_DRAFT, "ship it");
    expect(next).not.toBe(EMPTY_DRAFT);
    expect(EMPTY_DRAFT.prompt).toBe("");
    expect(next.prompt).toBe("ship it");
  });

  it("resets model and effort when the agent changes", () => {
    const started = withRuntime(withAgent(EMPTY_DRAFT, "claude", null), "opus", "high");
    const moved = withAgent(started, "codex", runtimeFor("codex"));
    expect(moved.modelId).toBeNull();
    expect(moved.reasoningEffort).toBeNull();
  });

  it("seeds the new agent's defaults when it has them", () => {
    const capability = runtimeFor("claude");
    const seeded = withAgent(EMPTY_DRAFT, "claude", {
      ...capability!,
      defaultModel: "sonnet",
      defaultEffort: "low",
    });
    expect(seeded.modelId).toBe("sonnet");
    expect(seeded.reasoningEffort).toBe("low");
  });

  it("keeps everything else when the agent changes", () => {
    const draft = withPrompt(withWorkspace(EMPTY_DRAFT, "/repo"), "ship it");
    const moved = withAgent(draft, "codex", null);
    expect(moved.prompt).toBe("ship it");
    expect(moved.workspacePath).toBe("/repo");
  });

  it("blocks Start task on an empty prompt but not Open agent", () => {
    const draft = withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "claude", null);
    expect(startTaskProblem(draft, RUNNABLE)).toBe("empty-prompt");
    expect(openAgentProblem(draft, RUNNABLE)).toBeNull();
  });

  it("blocks a whitespace-only prompt", () => {
    const draft = withPrompt(
      withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "claude", null),
      "   \n  ",
    );
    expect(startTaskProblem(draft, RUNNABLE)).toBe("empty-prompt");
  });

  it("accepts a complete draft", () => {
    const draft = withPrompt(
      withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "claude", null),
      "ship it",
    );
    expect(startTaskProblem(draft, RUNNABLE)).toBeNull();
    expect(openAgentProblem(draft, RUNNABLE)).toBeNull();
  });

  it("refuses an agent that is enabled but not installed", () => {
    const draft = withPrompt(
      withAgent(withWorkspace(EMPTY_DRAFT, "/repo"), "codex", null),
      "ship it",
    );
    expect(
      startTaskProblem(draft, { runnableAgentIds: ["claude"], unavailableAgentIds: ["codex"] }),
    ).toBe("agent-unavailable");
  });

  it("reports no-runnable-agent when nothing can launch", () => {
    const draft = withPrompt(withWorkspace(EMPTY_DRAFT, "/repo"), "ship it");
    expect(startTaskProblem(draft, { runnableAgentIds: [], unavailableAgentIds: ["claude"] })).toBe(
      "no-runnable-agent",
    );
  });

  it("reports the most structural problem first", () => {
    // No workspace AND no agent AND no prompt: the workspace is what the user
    // must answer first, so that is the one stated.
    expect(startTaskProblem(EMPTY_DRAFT, RUNNABLE)).toBe("no-workspace");
    expect(startTaskProblem(withWorkspace(EMPTY_DRAFT, "/repo"), RUNNABLE)).toBe("no-agent");
  });

  it("carries the prompt-expanded preference immutably", () => {
    const collapsed = withPromptExpanded(EMPTY_DRAFT, false);
    expect(collapsed.promptExpanded).toBe(false);
    expect(EMPTY_DRAFT.promptExpanded).toBe(true);
  });
});
