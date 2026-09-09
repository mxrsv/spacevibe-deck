import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetTaskPrompt,
  noteTaskPrompt,
  paneTaskPrompts,
  resetTaskPrompts,
} from "./board-task-prompts";

describe("board task prompts", () => {
  beforeEach(() => resetTaskPrompts());

  it("keeps the prompt a pane was launched with", () => {
    noteTaskPrompt(7, "Refactor the rail model");
    expect(paneTaskPrompts.value.get(7)).toBe("Refactor the rail model");
  });

  it("writes a new map rather than mutating the old one (C1)", () => {
    noteTaskPrompt(7, "one");
    const before = paneTaskPrompts.value;
    noteTaskPrompt(8, "two");
    expect(before.has(8)).toBe(false);
    expect(paneTaskPrompts.value.size).toBe(2);
  });

  it("ignores a blank prompt — a card must not print an empty Task line", () => {
    noteTaskPrompt(7, "   ");
    expect(paneTaskPrompts.value.has(7)).toBe(false);
  });

  it("forgets a pane's prompt when the pane goes", () => {
    noteTaskPrompt(7, "one");
    forgetTaskPrompt(7);
    expect(paneTaskPrompts.value.has(7)).toBe(false);
  });
});
