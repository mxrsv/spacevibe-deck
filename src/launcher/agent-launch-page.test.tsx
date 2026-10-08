// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLaunchPage, type AgentLaunchPageProps } from "./agent-launch-page";

// Keep the real module's other exports (CHROME_ICON, ...) so a new export cannot break this mock.
vi.mock("../ui/controls/deck-icon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ui/controls/deck-icon")>()),
  DeckIcon: () => <span />,
}));

/** The agents' own buttons: the Terminal card is exercised separately. */
const AGENT_BUTTONS = ".agent-launch-page__card:not([data-launch-terminal]) button";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function contextRow(
  overrides: Partial<AgentLaunchPageProps["contextRow"]["context"]> = {},
): AgentLaunchPageProps["contextRow"] {
  return {
    context: {
      workspaces: [{ path: "/repo", label: "repo" }],
      workspacePath: "/repo",
      checkouts: [],
      checkoutPath: "/repo",
      chip: "Split beside Claude Code",
      ...overrides,
    },
    homeDir: "/Users/dev",
    disabled: false,
    onSelectWorkspace: vi.fn(),
    onSelectCheckout: vi.fn(),
    onPickFolder: vi.fn(async () => {}),
  };
}

function mount(overrides: Partial<AgentLaunchPageProps> = {}) {
  const props: AgentLaunchPageProps = {
    target: { kind: "split", tabKey: 1, paneId: 2, workspacePath: "/repo" },
    contextRow: contextRow(),
    agents: [{ id: "claude", label: "Claude Code", missing: false, detail: "claude" }],
    resolved: true,
    pending: false,
    error: null,
    onRun: vi.fn(),
    onBack: vi.fn(),
    onSettings: vi.fn(),
    ...overrides,
  };
  act(() => render(<AgentLaunchPage {...props} />, host));
  return props;
}

describe("compact Original launch page", () => {
  it("focuses Run without starting and uses an explicit button", () => {
    const props = mount();
    const run = host.querySelector<HTMLButtonElement>("[data-launch-primary]")!;
    expect(document.activeElement).toBe(run);
    expect(props.onRun).not.toHaveBeenCalled();
    act(() => run.click());
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("claude");
    expect(host.textContent).not.toContain("Recently used");
    expect(host.textContent).not.toContain("Default profile");
  });
  it("makes the card Split and offers New space as an icon beside it when the folder has a tab", () => {
    const props = mount({ onRunInNewSpace: vi.fn() });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(AGENT_BUTTONS)];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Split Claude Code into the current tab",
      "Run Claude Code in a new space",
    ]);
    // Split stays the first, focused control: Enter behaves as it always did.
    expect(document.activeElement).toBe(buttons[0]);
    act(() => buttons[1].click());
    expect(props.onRunInNewSpace).toHaveBeenCalledExactlyOnceWith("claude");
    expect(props.onRun).not.toHaveBeenCalled();
    act(() => buttons[0].click());
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("claude");
    // The buttons say what will happen, so the context row does not repeat it.
    expect(host.textContent).not.toContain("Split · same tab");
  });

  it("keeps one Run, and a New space chip, when nothing exists to split", () => {
    mount({
      target: { kind: "first-pane", workspacePath: "/repo" },
      contextRow: contextRow({ chip: "New space" }),
      onRunInNewSpace: vi.fn(),
    });
    const buttons = host.querySelectorAll(AGENT_BUTTONS);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe("Run Claude Code");
    expect(host.querySelector(".agent-launch-page__chip")?.textContent).toBe("New space");
  });

  it("says New space before the press when the focused pane is in another checkout (RAIL4)", () => {
    const props = mount({
      target: { kind: "new-space", workspacePath: "/repo" },
      contextRow: contextRow({ chip: "New space" }),
      onRunInNewSpace: vi.fn(),
    });
    expect(host.querySelector(".agent-launch-page__chip")?.textContent).toBe("New space");
    // One Run, and it does what the line said: the captured target is a new space.
    const buttons = host.querySelectorAll<HTMLButtonElement>(AGENT_BUTTONS);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe("Run Claude Code");
    act(() => buttons[0].click());
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("claude");
    expect(props.onRunInNewSpace).not.toHaveBeenCalled();
  });

  it("shows a missing agent as disabled, with no New space button", () => {
    mount({
      agents: [{ id: "codex", label: "Codex", missing: true, detail: "codex" }],
      onRunInNewSpace: vi.fn(),
    });
    const buttons = host.querySelectorAll<HTMLButtonElement>(AGENT_BUTTONS);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].textContent).toContain("Not installed");
  });

  it("never offers the second button to a page that cannot open a space", () => {
    mount();
    expect(host.querySelectorAll(AGENT_BUTTONS)).toHaveLength(1);
  });

  it("offers a Terminal card after the agents that runs a bare shell", () => {
    const props = mount({ onRunInNewSpace: vi.fn() });
    const terminal = [...host.querySelectorAll<HTMLButtonElement>("[data-launch-terminal] button")];
    expect(terminal.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Split Terminal into the current tab",
      "Run Terminal in a new space",
    ]);
    expect(
      host
        .querySelector(".agent-launch-page__card:last-of-type")
        ?.hasAttribute("data-launch-terminal"),
    ).toBe(true);
    act(() => terminal[0].click());
    expect(props.onRun).toHaveBeenCalledExactlyOnceWith("deck:terminal");
    act(() => terminal[1].click());
    expect(props.onRunInNewSpace).toHaveBeenCalledExactlyOnceWith("deck:terminal");
  });

  it("keeps the Terminal card when no agent is installed", () => {
    mount({ agents: [] });
    expect(host.querySelector("[data-launch-terminal] button")?.textContent).toContain("Terminal");
  });

  it("prevents repeated Run while pending and displays a recoverable error", () => {
    const props = mount({ pending: true, error: "Folder unavailable" });
    host.querySelector<HTMLButtonElement>("[data-launch-primary]")!.click();
    expect(props.onRun).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Folder unavailable");
  });
  it("shows discovery before empty-state settings, with no invented agent", () => {
    mount({ agents: [], resolved: false });
    expect(host.textContent).toContain("Looking for installed agents");
    expect(host.textContent).not.toContain("No quick agents");
    const props = mount({ agents: [] });
    act(() => host.querySelector<HTMLButtonElement>("[data-launch-primary]")!.click());
    expect(props.onSettings).toHaveBeenCalledOnce();
  });
  it("consumes Escape only when this page owns interaction", () => {
    const props = mount();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.activeElement!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(props.onBack).toHaveBeenCalledOnce();
    const covered = mount({ active: false });
    act(
      () =>
        void host
          .querySelector("section")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(covered.onBack).not.toHaveBeenCalled();
  });

  it("opens the agent editor from Add agent, and Escape closes it before leaving the page", () => {
    const onToggleChoice = vi.fn();
    const props = mount({
      choices: [
        { id: "claude", label: "Claude Code", pinned: true, blocked: null, toggleable: true },
        { id: "droid", label: "Droid", pinned: false, blocked: "Not installed", toggleable: false },
      ],
      onToggleChoice,
    });
    const add = host.querySelector<HTMLButtonElement>("[data-launch-add]")!;
    expect(host.querySelector(".agent-launch-page__editor")).toBeNull();
    act(() => add.click());
    expect(add.getAttribute("aria-expanded")).toBe("true");
    const boxes = host.querySelectorAll<HTMLInputElement>(".agent-launch-page__editor input");
    expect([...boxes].map((box) => [box.checked, box.disabled])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(host.querySelector(".agent-launch-page__editor")?.textContent).toContain(
      "Not installed",
    );
    act(() => boxes[0].click());
    expect(onToggleChoice).toHaveBeenCalledExactlyOnceWith("claude");
    const escape = () =>
      act(() => {
        host
          .querySelector("section")!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
    escape();
    expect(host.querySelector(".agent-launch-page__editor")).toBeNull();
    expect(props.onBack).not.toHaveBeenCalled();
    escape();
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("offers no Add agent card when the page cannot edit the list", () => {
    mount();
    expect(host.querySelector("[data-launch-add]")).toBeNull();
  });

  it("lets an open popover take Escape before the page does", () => {
    const props = mount({
      contextRow: contextRow({
        checkouts: [
          { path: "/repo", label: "main", linked: false },
          { path: "/wt", label: "feat", linked: true },
        ],
      }),
    });
    const triggers = host.querySelectorAll<HTMLButtonElement>(".nt-workspace-picker__trigger");
    expect(triggers).toHaveLength(2);
    act(() => triggers[1].click());
    const checked = host.querySelector<HTMLButtonElement>('[aria-checked="true"]')!;
    expect(document.activeElement).toBe(checked);
    act(() => {
      checked.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(props.onBack).not.toHaveBeenCalled();
  });
});
