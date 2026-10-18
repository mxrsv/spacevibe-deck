// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import type { AgentLaunchResult } from "../terminal/agent-launch-target";
import { AgentInstallControl } from "./agent-install-control";
import {
  registerAgentInstallHost,
  resetAgentInstallForTests,
  type AgentInstallHost,
} from "./agent-install-store";

// Track B's real commands are not the subject here: `amp` has one, every other agent has none.
vi.mock("../lib/agent-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-catalog")>();
  const none = { macos: null, windows: null };
  const amp = {
    macos: { command: "curl -fsSL https://example.test/amp | bash", source: "", checked: "" },
    windows: null,
  };
  return {
    ...actual,
    BUILTIN_AGENTS: actual.BUILTIN_AGENTS.map((agent) => ({
      ...agent,
      install: agent.id === "amp" ? amp : none,
    })),
  };
});

const shell = vi.hoisted(() => ({ openUrl: vi.fn<(url: string) => Promise<void>>() }));
vi.mock("../host/shell-host", () => ({ openUrl: shell.openUrl }));

const SPAWNED: AgentLaunchResult = {
  kind: "spawned",
  receipt: { tabKey: 1, paneId: 2, canFocus: () => false },
};

let host: HTMLDivElement;
let fake: { open: ReturnType<typeof vi.fn<AgentInstallHost["open"]>>; focus: () => void };

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = true;
  fake = { open: vi.fn(async () => SPAWNED), focus: vi.fn() };
  registerAgentInstallHost(fake);
  shell.openUrl.mockReset();
  shell.openUrl.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetAgentInstallForTests();
  resetDesktopEnvironmentForTests();
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = false;
});

function mount(agentId: string, label: string) {
  act(() => render(<AgentInstallControl agentId={agentId} label={label} />, host));
}

describe("AgentInstallControl", () => {
  it("shows Install with the exact command as its tooltip for a missing, enabled built-in", () => {
    mount("amp", "Amp");
    const button = host.querySelector("button")!;
    expect(button.textContent).toBe("Install");
    expect(button.title).toBe("curl -fsSL https://example.test/amp | bash");
    expect(button.getAttribute("aria-label")).toBe("Install Amp");
    expect(host.querySelector("[data-agent-install='amp']")).not.toBeNull();
  });

  it("opens the install pane once per press and is disabled while it opens", async () => {
    let finish: (result: AgentLaunchResult) => void = () => {};
    fake.open.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    mount("amp", "Amp");
    const button = host.querySelector("button")!;
    act(() => button.click());
    expect(fake.open).toHaveBeenCalledExactlyOnceWith(
      "amp",
      "curl -fsSL https://example.test/amp | bash",
    );
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => button.click());
    expect(fake.open).toHaveBeenCalledOnce();
    await act(async () => finish(SPAWNED));
    expect(button.hasAttribute("aria-disabled")).toBe(false);
  });

  it("keeps keyboard focus on the button after a failed install", async () => {
    fake.open.mockResolvedValue({ kind: "failed", message: "Couldn't open a terminal." });
    mount("amp", "Amp");
    const button = host.querySelector("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(host.querySelector("[role='alert']")).not.toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("shows a failed press next to the button as an alert", async () => {
    fake.open.mockResolvedValue({ kind: "failed", message: "Couldn't open a terminal." });
    mount("amp", "Amp");
    await act(async () => host.querySelector("button")!.click());
    const alert = host.querySelector("[role='alert']")!;
    expect(alert.textContent).toBe("Couldn't open a terminal.");
    expect(alert.parentElement).toBe(host.querySelector(".agent-install"));
  });

  it("shows Get with the page as its tooltip when there is no command, and opens it", () => {
    mount("kimi", "Kimi Code");
    const link = host.querySelector("a")!;
    expect(host.querySelector("button")).toBeNull();
    expect(link.textContent).toBe("Get");
    expect(link.title).toBe(link.getAttribute("href"));
    expect(link.getAttribute("aria-label")).toBe("Get Kimi Code");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(shell.openUrl).toHaveBeenCalledExactlyOnceWith(link.title);
  });

  it("says so inline when the link cannot be opened", async () => {
    shell.openUrl.mockRejectedValue(new Error("blocked"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mount("kimi", "Kimi Code");
    await act(async () => host.querySelector("a")!.click());
    expect(host.querySelector("[role='alert']")?.textContent).toBe("Couldn't open the link");
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("renders nothing without a host, for a found agent, a disabled agent or a custom id", () => {
    resetAgentInstallForTests();
    mount("amp", "Amp");
    expect(host.innerHTML).toBe("");

    registerAgentInstallHost(fake);
    detectedAgents.value = [{ name: "amp", path: "/bin/amp" }];
    mount("amp", "Amp");
    expect(host.innerHTML).toBe("");

    detectedAgents.value = [];
    settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["amp"] };
    mount("amp", "Amp");
    expect(host.innerHTML).toBe("");

    settings.value = DEFAULT_SETTINGS;
    mount("custom:aider", "Aider");
    expect(host.innerHTML).toBe("");
  });
});
