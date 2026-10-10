// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../host/bridge", () => ({ invoke }));
vi.mock("./controls/deck-icon", () => ({
  FEATURE_ICON: 15,
  DeckIcon: () => <span data-fallback-icon="folder" />,
}));

import { WorkspaceIcon } from "./workspace-icon";

const ROOT = "/work/project";
const FAVICON = "data:image/png;base64,aGVsbG8=";

describe("WorkspaceIcon", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    invoke.mockReset();
    invoke.mockImplementation(async (channel: string) =>
      channel === "activate_image_workspace_root" ? true : FAVICON,
    );
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      render(<WorkspaceIcon path={ROOT} />, host);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("activates a saved Electron grant before scanning the workspace favicon", async () => {
    await mount();

    expect(invoke.mock.calls).toEqual([
      ["activate_image_workspace_root", { root: ROOT }],
      ["scan_workspace_favicon", { dir: ROOT }],
    ]);
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(FAVICON));
  });

  it("keeps the folder fallback when Electron cannot activate the saved grant", async () => {
    invoke.mockResolvedValue(false);
    await mount();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("activate_image_workspace_root", { root: ROOT });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("[data-fallback-icon='folder']")).not.toBeNull();
  });

  it("preserves the legacy Tauri scan without calling the Electron-only activation", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.stubGlobal("__deckHost", undefined);
    await mount();

    expect(invoke.mock.calls).toEqual([["scan_workspace_favicon", { dir: ROOT }]]);
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe(FAVICON));
  });
});
