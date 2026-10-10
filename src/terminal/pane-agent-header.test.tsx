// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tabViews, type PaneView } from "./tabs-store";
import { paneTails } from "./session-tail-store";
import { mountPaneAgentHeader } from "./pane-agent-header";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { detectedAgents } from "./agent-detection-store";
vi.mock("../ui/controls/deck-icon", () => ({ DeckIcon: () => null }));

const pane: PaneView = {
  paneId: 1,
  agent: "claude",
  sessionId: "session-1",
  attention: "none",
  phase: "idle",
  hasRun: false,
  changedAt: 0,
};
const send = vi.fn<(data: string) => Promise<boolean>>();
const focus = vi.fn();
function publish(next: PaneView) {
  tabViews.value = [
    {
      key: 1,
      process: next.agent ?? "shell",
      name: null,
      dotColor: null,
      workspacePath: "/repo",
      agents: next.agent ? [next.agent] : [],
      agentBusy: false,
      unread: false,
      panes: [next],
    },
  ];
}
let element: HTMLDivElement;
let bar: HTMLDivElement;
let stop: () => void;
function mountHeader() {
  act(() => {
    stop = mountPaneAgentHeader(1, element, bar, { send, focus });
  });
}
beforeEach(() => {
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
  vi.resetAllMocks();
  send.mockResolvedValue(true);
  settings.value = DEFAULT_SETTINGS;
  publish(pane);
  paneTails.value = new Map([[1, "Checking launch behavior"]]);
  element = document.createElement("div");
  bar = document.createElement("div");
  bar.className = "pane__bar";
  element.append(bar);
  document.body.append(element);
  mountHeader();
});
afterEach(() => {
  act(() => stop());
  element.remove();
  tabViews.value = [];
  paneTails.value = new Map();
  settings.value = DEFAULT_SETTINGS;
  vi.unstubAllGlobals();
});
describe("agent pane header", () => {
  it("uses the same tail as the sidebar", () => {
    expect(element.textContent).toContain("Checking launch behavior");
    act(() => {
      paneTails.value = new Map([[1, "Running tests"]]);
    });
    expect(element.textContent).toContain("Running tests");
    act(() => publish({ ...pane, agent: null }));
    expect(element.classList.contains("pane--agent-header")).toBe(false);
  });
  it("draws no buttons: no Effort picker and no split, expand or close actions", () => {
    expect(element.querySelector("button")).toBeNull();
  });
});
describe("shell pane header in a split tab", () => {
  const shell: PaneView = { ...pane, agent: null, sessionId: null };
  const sibling: PaneView = { ...shell, paneId: 2 };
  function publishPanes(panes: readonly PaneView[]) {
    tabViews.value = [{ ...tabViews.value[0], panes }];
  }
  beforeEach(() => {
    detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
    settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
  });
  afterEach(() => {
    detectedAgents.value = [];
  });

  it("stays bare while the shell is alone in its tab", () => {
    act(() => publishPanes([shell]));
    expect(element.querySelector(".pane-quick-agents")).toBeNull();
    expect(element.classList.contains("pane--agent-header")).toBe(false);
  });

  it("offers the pinned agents once the tab holds two panes", () => {
    act(() => publishPanes([shell, sibling]));
    expect(element.classList.contains("pane--agent-header")).toBe(true);
    expect(
      [...element.querySelectorAll(".pane-quick-agents button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Run Claude Code here"]);
  });

  it("types the agent's command into this pane's shell", async () => {
    act(() => publishPanes([shell, sibling]));
    await act(async () => {
      (element.querySelector(".pane-quick-agents button") as HTMLButtonElement).click();
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.stringMatching(/^claude\b.*\r$/));
  });
});
