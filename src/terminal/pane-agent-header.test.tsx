// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tabViews, type PaneView } from "./tabs-store";
import { paneTails } from "./session-tail-store";
import { mountPaneAgentHeader } from "./pane-agent-header";
import { registerPaneHeaderActions } from "./pane-header-actions";
import { persistError } from "../chrome/events";
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
const handlers = {
  split: vi.fn<(paneId: number, direction: "row" | "column") => void>(),
  toggleExpand: vi.fn<(paneId: number) => void>(),
  close: vi.fn<(paneId: number) => void>(),
};
let element: HTMLDivElement;
let bar: HTMLDivElement;
let stop: () => void;
let unregister: () => void;
function mountHeader() {
  act(() => {
    stop = mountPaneAgentHeader(1, element, bar, { send, focus });
  });
}
beforeEach(() => {
  vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
  vi.resetAllMocks();
  send.mockResolvedValue(true);
  persistError.value = null;
  settings.value = DEFAULT_SETTINGS;
  unregister = registerPaneHeaderActions(handlers);
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
  unregister();
  element.remove();
  tabViews.value = [];
  paneTails.value = new Map();
  settings.value = DEFAULT_SETTINGS;
  vi.unstubAllGlobals();
});
describe("Claude pane effort control", () => {
  it("uses the same tail as the sidebar", () => {
    expect(element.textContent).toContain("Checking launch behavior");
    act(() => {
      paneTails.value = new Map([[1, "Running tests"]]);
    });
    expect(element.textContent).toContain("Running tests");
    act(() => publish({ ...pane, agent: null }));
    expect(element.classList.contains("pane--agent-header")).toBe(false);
  });
  it("opens Claude's native picker without submitting or clearing a draft", async () => {
    const button = element.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(send).toHaveBeenCalledExactlyOnceWith("\x1bp");
    expect(focus).toHaveBeenCalledOnce();
    expect(persistError.value).toBeNull();
    expect(button.textContent).toBe("Effort");
  });
  it.each(["codex", "gemini", "opencode"] as const)("does not offer effort for %s", (agent) => {
    act(() => publish({ ...pane, agent }));
    expect(element.querySelector(".pane-agent-header__control")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not require hooks or a transcript session ID to open the native picker", async () => {
    act(() => publish({ ...pane, sessionId: null }));
    await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(send).toHaveBeenCalledExactlyOnceWith("\x1bp");
  });
  it("blocks exited agents and stale clicks after the pane becomes a shell", async () => {
    act(() => publish({ ...pane, phase: "exited" }));
    const button = element.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    act(() => publish({ ...pane, agent: null }));
    await act(async () => button.click());
    expect(send).not.toHaveBeenCalled();
  });
  it("reports a failed send without claiming an effort change", async () => {
    send.mockResolvedValue(false);
    await act(async () => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(persistError.value).toBe("Could not open Claude Code's effort picker. Try again.");
    expect(focus).toHaveBeenCalledOnce();
  });
  it("ignores late completion after a session change and prevents duplicate sends", async () => {
    let resolve!: (value: boolean) => void;
    send.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const button = element.querySelector<HTMLButtonElement>("button")!;
    act(() => {
      button.click();
      button.click();
    });
    expect(send).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    act(() => publish({ ...pane, sessionId: "session-2" }));
    await act(async () => resolve(true));
    expect(focus).not.toHaveBeenCalled();
    expect(persistError.value).toBeNull();
  });
  it("does not steal focus back when a delayed send completes", async () => {
    let resolve!: (value: boolean) => void;
    send.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    act(() => element.querySelector<HTMLButtonElement>("button")!.click());
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    await act(async () => resolve(true));
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
describe("pane header actions (DL-32.8)", () => {
  const actions = () =>
    Array.from(element.querySelectorAll<HTMLButtonElement>(".pane-agent-header__act"));
  const named = (name: string) => actions().find((button) => button.ariaLabel === name)!;

  it("ends the header with the four actions, named as More names them", () => {
    expect(actions().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Split vertically",
      "Split horizontally",
      "Focus expand",
      "Close pane",
    ]);
    // After Effort in DOM order, so a keyboard walks the control before the actions.
    const children = Array.from(element.querySelector(".pane-agent-header")?.children ?? []);
    expect(children.at(-1)?.className).toBe("pane-agent-header__actions");
    expect(children.at(-2)?.className).toBe("pane-agent-header__control");
  });

  it("offers them on every agent, not just Claude", () => {
    act(() => publish({ ...pane, agent: "codex" }));
    expect(actions()).toHaveLength(4);
  });

  it("closes THIS pane, whichever pane holds the focus", () => {
    tabViews.value = [
      { ...tabViews.value[0]!, panes: [{ ...pane, paneId: 2, focused: true }, pane] },
    ];

    act(() => named("Close pane").click());

    expect(handlers.close).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("asks for each split on this pane's own id", () => {
    act(() => named("Split vertically").click());
    act(() => named("Split horizontally").click());

    expect(handlers.split.mock.calls).toEqual([
      [1, "row"],
      [1, "column"],
    ]);
  });

  it("reports Focus expand as pressed from the setting, paints nothing and flips it through the handler", () => {
    expect(named("Focus expand").getAttribute("aria-pressed")).toBe("false");
    act(() => {
      settings.value = { ...settings.value, focusExpand: true };
    });
    const expand = named("Focus expand");
    expect(expand.getAttribute("aria-pressed")).toBe("true");
    // DL-21.8: state reaches ARIA alone.
    expect(expand.className).toBe("pane-agent-header__act");

    act(() => expand.click());
    expect(handlers.toggleExpand).toHaveBeenCalledExactlyOnceWith(1);
    // The setting itself is `App`'s to write, through the handler.
    expect(settings.value.focusExpand).toBe(true);
  });

  it("never starts the pane drag from a press on a button", () => {
    const reachedBar = vi.fn();
    bar.addEventListener("pointerdown", reachedBar);
    bar.addEventListener("mousedown", reachedBar);
    const button = named("Close pane");

    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(reachedBar).not.toHaveBeenCalled();
  });

  it("opens the DL-23 tooltip below the button on keyboard focus, with the chord", () => {
    act(() => named("Close pane").focus());

    const tip = document.querySelector(".action-tip");
    expect(tip?.classList.contains("action-tip--above")).toBe(false);
    expect(tip?.querySelector(".action-tip__label")?.textContent).toBe("Close pane");
    expect(tip?.querySelector(".action-tip__kbd")?.textContent).not.toBe("");
    expect(named("Close pane").getAttribute("aria-describedby")).toBe(tip?.id);
  });

  it("draws no actions on a plain shell pane, which has no agent header", () => {
    act(() => publish({ ...pane, agent: null }));

    expect(actions()).toHaveLength(0);
  });

  it("renders and presses without throwing when no handlers are registered", () => {
    unregister();

    expect(() => {
      for (const button of actions()) {
        act(() => button.click());
      }
    }).not.toThrow();
    expect(handlers.close).not.toHaveBeenCalled();
  });

  it("drops the splits first when the pane is too narrow, keeping expand and close", () => {
    let observe: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observe = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    act(() => stop());
    mountHeader();
    const resize = (width: number) =>
      act(() =>
        observe(
          [{ contentRect: { width } } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        ),
      );

    resize(200);
    expect(actions().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Focus expand",
      "Close pane",
    ]);

    resize(400);
    expect(actions()).toHaveLength(4);
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
