import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("../host/bridge", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  createMemoryPromptAssetsClient,
  createTauriPromptAssetsClient,
  EMPTY_PROMPT_ASSETS,
} from "./prompt-assets-client";

describe("createTauriPromptAssetsClient", () => {
  it("passes agent and cwd through to the command", async () => {
    invoke.mockResolvedValueOnce({ skills: [], subagents: [] });
    await createTauriPromptAssetsClient().list("claude", "/repo");
    expect(invoke).toHaveBeenCalledWith("list_prompt_assets", {
      agent: "claude",
      cwd: "/repo",
    });
  });
});

describe("createMemoryPromptAssetsClient", () => {
  it("answers with the configured assets", async () => {
    const assets = {
      skills: [
        {
          kind: "skill" as const,
          name: "code-review",
          description: "",
          source: "global" as const,
        },
      ],
      subagents: [],
    };
    await expect(createMemoryPromptAssetsClient(assets).list("claude", null)).resolves.toEqual(
      assets,
    );
  });

  it("can be made to fail, so the caller's degraded path is testable", async () => {
    const client = createMemoryPromptAssetsClient(EMPTY_PROMPT_ASSETS, {
      fail: true,
    });
    await expect(client.list("claude", null)).rejects.toThrow("list_prompt_assets failed");
  });
});
