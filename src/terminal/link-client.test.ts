import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenEditorRequest } from "../lib/editor-command";
import { createMemoryLinkClient, createTauriLinkClient } from "./link-client";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const REQUEST: OpenEditorRequest = {
  editor: "cursor",
  template: "",
  file: String.raw`C:\work\a b.ts`,
  line: 12,
  column: 4,
};

describe("createTauriLinkClient", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(openUrl).mockReset();
  });

  it("sends a structured editor request over IPC", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const client = createTauriLinkClient();

    await client.openEditor(REQUEST);

    expect(invoke).toHaveBeenCalledWith("open_editor", { request: REQUEST });
  });

  it("keeps URL opening separate from editor IPC", async () => {
    vi.mocked(openUrl).mockResolvedValue(undefined);
    const client = createTauriLinkClient();

    await client.openUrl("https://example.com");

    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves editor IPC rejection", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("backend rejected request"));
    const client = createTauriLinkClient();

    await expect(client.openEditor(REQUEST)).rejects.toThrow(
      "backend rejected request",
    );
  });
});

describe("createMemoryLinkClient", () => {
  it("records immutable structured editor requests", async () => {
    const client = createMemoryLinkClient();

    await client.openEditor(REQUEST);

    expect(client.openedEditor).toEqual([REQUEST]);
  });
});
