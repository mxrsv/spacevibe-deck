import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "./bridge";

vi.mock("./bridge", () => ({ invoke: vi.fn() }));

describe("workspace-create-host", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.unstubAllGlobals();
  });

  it("reports unavailable without the Electron preload", async () => {
    vi.stubGlobal("__deckHost", undefined);
    vi.resetModules();
    const { available } = await import("./workspace-create-host");
    expect(available).toBe(false);
  });

  it("sends the flat parent and name payload", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    vi.resetModules();
    const bridge = await import("./bridge");
    vi.mocked(bridge.invoke).mockResolvedValue({ path: "/repo/new" });
    const { createWorkspace } = await import("./workspace-create-host");

    await expect(createWorkspace("/repo", "new")).resolves.toEqual({ path: "/repo/new" });
    expect(bridge.invoke).toHaveBeenCalledWith("create_directory", {
      parent: "/repo",
      name: "new",
    });
  });
});
