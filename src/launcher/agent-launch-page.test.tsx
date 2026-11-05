// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeNames } from "../lib/agent-catalog";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import {
  registerAgentInstallHost,
  resetAgentInstallForTests,
  startAgentInstall,
} from "./agent-install-store";
import { AgentLaunchPage, type AgentLaunchPageProps } from "./agent-launch-page";

// Track B's real commands are not the subject here: `amp` has one, every other agent has none.
vi.mock("../lib/agent-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-catalog")>();
  const amp = {
    macos: { command: "amp-installer", source: "https://example.test", checked: "2026-10-10" },
    windows: null,
  };
  return {
    ...actual,
    BUILTIN_AGENTS: actual.BUILTIN_AGENTS.map((agent) => ({
      ...agent,
      install: agent.id === "amp" ? amp : { macos: null, windows: null },
    })),
  };
});

const probe = vi.hoisted(() => ({ ensureAgentsDetected: vi.fn(async () => []) }));
vi.mock("../terminal/agent-detection-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../terminal/agent-detection-store")>()),
  ensureAgentsDetected: probe.ensureAgentsDetected,
}));

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
    commands: { claude: { default: "claude --model opus", commands: ["claude --model opus"] } },
    resolved: true,
    pending: false,
    error: null,
    onRun: vi.fn(),
    onRetry: vi.fn(),
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
    // The profile lives in the chip under the grid, not on the cards.
    expect(host.querySelector(".agent-launch-page__grid")?.textContent).not.toContain("profile");
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

  it("shows a missing agent as a disabled tile, with no New space button or arrow", () => {
    mount({
      agents: [{ id: "codex", label: "Codex", missing: true, detail: "codex" }],
      onRunInNewSpace: vi.fn(),
    });
    const buttons = host.querySelectorAll<HTMLButtonElement>(AGENT_BUTTONS);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].getAttribute("aria-label")).toBe("Codex is not installed");
    expect(buttons[0].textContent).toContain("Not installed");
    expect(host.querySelector(".agent-launch-page__card--missing")).not.toBeNull();
  });

  it("puts the Terminal card after the installed agents and before the missing ones", () => {
    mount({
      agents: [
        { id: "claude", label: "Claude Code", missing: false, detail: "claude" },
        { id: "amp", label: "Amp", missing: true, detail: "amp" },
        { id: "codex", label: "Codex", missing: false, detail: "codex" },
      ],
    });
    const names = [...host.querySelectorAll(".agent-launch-page__main strong")].map(
      (name) => name.textContent,
    );
    expect(names).toEqual(["Claude Code", "Codex", "Terminal", "Amp"]);
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
    expect(host.querySelector(".agent-launch-page__notice-text")?.textContent).toBe(
      "Folder unavailable",
    );
    expect(
      host.querySelector<HTMLButtonElement>(".agent-launch-page__notice button")?.disabled,
    ).toBe(true);
  });

  it("shows a failure as an alert with Retry, and no exit code (PAGE5)", () => {
    const props = mount({ error: "Could not open the agent. Try again." });
    const alert = host.querySelector<HTMLElement>(".agent-launch-page__notice")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Could not open the agent. Try again.");
    expect(alert.textContent).not.toMatch(/exit|code \d/i);
    const retry = alert.querySelector<HTMLButtonElement>("button")!;
    expect(retry.textContent).toBe("Retry");
    expect(retry.disabled).toBe(false);
    act(() => retry.click());
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("shows no notice while nothing has failed", () => {
    mount();
    expect(host.querySelector(".agent-launch-page__notice")).toBeNull();
  });
  it("shows discovery before empty-state settings, with no invented agent", () => {
    mount({ agents: [], resolved: false });
    expect(host.textContent).toContain("Looking for installed agents");
    expect(host.textContent).not.toContain("No quick agents");
    const props = mount({ agents: [] });
    act(() => host.querySelector<HTMLButtonElement>("[data-launch-primary]")!.click());
    expect(props.onSettings).toHaveBeenCalledOnce();
  });
  it("keeps the route to Settings when only missing tiles are on the page", () => {
    const props = mount({ agents: [{ id: "amp", label: "Amp", missing: true, detail: "amp" }] });
    expect(host.textContent).toContain("No quick agents available");
    const route = host.querySelector<HTMLButtonElement>("[data-launch-primary]:not(:disabled)")!;
    expect(document.activeElement).toBe(route);
    act(() => route.click());
    expect(props.onSettings).toHaveBeenCalledOnce();
  });
  describe("command preview", () => {
    const CLAUDE_COMMAND = "claude --model opus";
    const preview = () => host.querySelector<HTMLElement>(".agent-launch-page__preview-line")!;
    const hover = (element: Element) =>
      act(() => void element.dispatchEvent(new MouseEvent("mouseenter")));
    const unhover = (element: Element) =>
      act(() => void element.dispatchEvent(new MouseEvent("mouseleave")));
    const claudeCard = () => host.querySelector<HTMLElement>(".agent-launch-page__card")!;

    // jsdom answers `false` for a script-driven focus; Chromium answers `true` after a key.
    function focusVisible(): () => void {
      const original = Element.prototype.matches;
      const spy = vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ":focus-visible" ? true : original.call(this, selector);
      });
      return () => spy.mockRestore();
    }

    it("says how to see the command while nothing is hovered or keyboard-focused", () => {
      mount();
      expect(preview().textContent).toBe("Hover or focus an agent to see the exact command");
      expect(preview().querySelector("code")).toBeNull();
      // A line that changes on every hover must not be announced.
      expect(preview().getAttribute("role")).toBeNull();
      expect(preview().getAttribute("aria-live")).toBeNull();
    });

    it("prints the exact command, the folder and the chip's placement on hover", () => {
      mount();
      hover(claudeCard());
      expect(preview().querySelector("code")?.textContent).toBe(CLAUDE_COMMAND);
      expect(preview().textContent).toBe(`${CLAUDE_COMMAND}in /repo· Split beside Claude Code`);
      unhover(claudeCard());
      expect(preview().querySelector("code")).toBeNull();
    });

    it("lets the folder shorten, with its full path as the title, and keeps the placement whole", () => {
      mount({
        contextRow: contextRow({ checkoutPath: "/Users/dev/code/a-very-long-checkout-name" }),
      });
      hover(claudeCard());
      const path = preview().querySelector<HTMLElement>(".agent-launch-page__preview-path")!;
      expect(path.textContent).toBe("in ~/code/a-very-long-checkout-name");
      expect(path.title).toBe("/Users/dev/code/a-very-long-checkout-name");
      expect(preview().querySelector(".agent-launch-page__preview-where")?.textContent).toBe(
        "· Split beside Claude Code",
      );
    });

    it("stays the page's last child, below the Opening line, so it can pin to the bottom", () => {
      mount({ pending: true });
      const inner = host.querySelector(".agent-launch-page__inner")!;
      expect(inner.lastElementChild?.className).toBe("agent-launch-page__preview");
      expect(inner.textContent).toContain("Opening agent…");
    });

    it("always says New space for the ⊕ button, then falls back to the press", () => {
      mount({ onRunInNewSpace: vi.fn() });
      const alt = host.querySelector<HTMLButtonElement>(".agent-launch-page__alt")!;
      hover(claudeCard());
      hover(alt);
      expect(preview().textContent).toContain(CLAUDE_COMMAND);
      expect(preview().textContent).toContain("· New space");
      expect(alt.getAttribute("aria-describedby")).toBe(preview().id);
      unhover(alt);
      expect(preview().textContent).toContain("· Split beside Claude Code");
      unhover(claudeCard());
      expect(preview().querySelector("code")).toBeNull();
    });

    it("shows it on keyboard focus, names it from the focused press, and drops it on blur", () => {
      const restore = focusVisible();
      try {
        mount();
        const press = host.querySelector<HTMLButtonElement>("[data-launch-primary]")!;
        act(() => press.blur());
        expect(preview().querySelector("code")).toBeNull();
        act(() => press.focus());
        expect(preview().querySelector("code")?.textContent).toBe(CLAUDE_COMMAND);
        expect(press.getAttribute("aria-describedby")).toBe(preview().id);
        act(() => press.blur());
        expect(preview().querySelector("code")).toBeNull();
        expect(press.getAttribute("aria-describedby")).toBeNull();
      } finally {
        restore();
      }
    });

    it("describes the Terminal card in plain words, without a command", () => {
      mount();
      hover(host.querySelector("[data-launch-terminal]")!);
      expect(preview().querySelector("code")).toBeNull();
      expect(preview().textContent).toBe("Opens a plain shellin /repo· Split beside Claude Code");
    });

    it("keeps the hint for a missing tile, which has no command to run", () => {
      mount({ agents: [{ id: "amp", label: "Amp", missing: true, detail: "amp" }] });
      hover(host.querySelector(".agent-launch-page__card--missing")!);
      expect(preview().textContent).toBe("Hover or focus an agent to see the exact command");
    });
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

  it("has no heading, Add agent card, editor or footer (PAGE6)", () => {
    mount();
    expect(host.querySelector("h1, header, footer")).toBeNull();
    expect(host.textContent).not.toContain("QUICK LAUNCH");
    expect(host.textContent).not.toContain("Add agent");
    expect(host.querySelector("[data-launch-add], .agent-launch-page__editor")).toBeNull();
    expect(host.querySelector('[aria-label="Choose quick agents"]')).toBeNull();
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

describe("launch cards and a pending install", () => {
  beforeEach(() => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    settings.value = DEFAULT_SETTINGS;
    detectedAgents.value = [];
    agentsProbed.value = true;
    probe.ensureAgentsDetected.mockClear();
  });
  afterEach(() => {
    resetAgentInstallForTests();
    resetDesktopEnvironmentForTests();
    detectedAgents.value = [];
    agentsProbed.value = false;
  });

  it("forces one full-list probe when the cards mount with an install pending", async () => {
    registerAgentInstallHost({
      open: async () => ({
        kind: "spawned",
        receipt: { tabKey: 1, paneId: 2, canFocus: () => false },
      }),
      focus: vi.fn(),
    });
    await startAgentInstall("amp");
    expect(probe.ensureAgentsDetected).not.toHaveBeenCalled();
    mount();
    expect(probe.ensureAgentsDetected).toHaveBeenCalledExactlyOnceWith(
      probeNames(settings.value.customAgents),
      { force: true },
    );
  });

  it("does not probe when nothing is pending", () => {
    mount();
    expect(probe.ensureAgentsDetected).not.toHaveBeenCalled();
  });

  it("carries Install on a missing tile as a sibling of its disabled press", () => {
    const unregister = registerAgentInstallHost({ open: vi.fn(), focus: vi.fn() });
    try {
      mount({ agents: [{ id: "amp", label: "Amp", missing: true, detail: "amp" }] });
      const card = host.querySelector<HTMLElement>(".agent-launch-page__card--missing")!;
      const press = card.querySelector<HTMLButtonElement>("[data-launch-primary]")!;
      const install = card.querySelector<HTMLButtonElement>('[aria-label="Install Amp"]');
      expect(press.disabled).toBe(true);
      expect(install).not.toBeNull();
      expect(install!.disabled).toBe(false);
      expect(press.contains(install)).toBe(false);
      expect(card.contains(install)).toBe(true);
    } finally {
      unregister();
    }
  });

  it("offers no Install control where the host cannot install", () => {
    mount({ agents: [{ id: "amp", label: "Amp", missing: true, detail: "amp" }] });
    expect(host.querySelector("[data-agent-install]")).toBeNull();
  });
});
