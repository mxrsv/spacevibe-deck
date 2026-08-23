// @vitest-environment jsdom
import { render } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { EMPTY_DRAFT, withAgent, withWorkspace } from "../launcher/new-task-draft";
import { BoardComposer, type BoardComposerProps } from "./board-composer";

const AGENTS: readonly AgentOption[] = [
  { id: "claude", label: "Claude Code", detail: "/usr/bin/claude", missing: false },
];

const RECENTS: readonly RecentWorkspace[] = [
  { path: "/repo/deck", lastOpenedAt: 2 },
  { path: "/repo/api", lastOpenedAt: 1 },
];

let host: HTMLDivElement;

function mount(overrides: Partial<BoardComposerProps> = {}): {
  onSelectWorkspace: ReturnType<typeof vi.fn>;
  onStartTask: ReturnType<typeof vi.fn>;
  onOpenAgent: ReturnType<typeof vi.fn>;
} {
  const onSelectWorkspace = vi.fn();
  const onStartTask = vi.fn();
  const onOpenAgent = vi.fn();
  const props: BoardComposerProps = {
    draft: { ...withAgent(withWorkspace(EMPTY_DRAFT, "/repo/deck"), "claude", null), prompt: "go" },
    agents: AGENTS,
    recents: RECENTS,
    declaredModels: {},
    agentRuntimeDefaults: {},
    canCreateWorkspace: true,
    canCreateWorktree: true,
    pending: null,
    problem: null,
    notice: null,
    onDraftChange: vi.fn(),
    onPickFolder: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onCreateWorktree: vi.fn(),
    onManageAgents: vi.fn(),
    onSelectWorkspace,
    onStartTask,
    onOpenAgent,
    ...overrides,
  };
  render(<BoardComposer {...props} />, host);
  return { onSelectWorkspace, onStartTask, onOpenAgent };
}

function rows(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>(".nt-recent"));
}

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("BoardComposer", () => {
  it("keeps the prompt visible even when the draft says collapsed", () => {
    mount({ draft: { ...EMPTY_DRAFT, promptExpanded: false } });
    expect(host.querySelector("textarea")).not.toBeNull();
  });

  it("a recents row selects the workspace and never launches", () => {
    const { onSelectWorkspace, onStartTask, onOpenAgent } = mount();
    const second = rows()[1];
    expect(second.textContent).toContain("api");
    second.click();
    expect(onSelectWorkspace).toHaveBeenCalledWith("/repo/api");
    expect(onStartTask).not.toHaveBeenCalled();
    expect(onOpenAgent).not.toHaveBeenCalled();
  });

  it("marks the row that matches the draft", () => {
    mount();
    expect(rows()[0].getAttribute("aria-pressed")).toBe("true");
    expect(rows()[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("returns focus to the prompt after a row is picked", async () => {
    mount();
    rows()[1].click();
    await new Promise((resolve) => queueMicrotask(() => resolve(null)));
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("Cmd+Enter starts the task once", () => {
    const { onStartTask } = mount();
    const textarea = host.querySelector("textarea");
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(onStartTask).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Enter does nothing while the draft is blocked", () => {
    const { onStartTask } = mount({ problem: "empty-prompt" });
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(onStartTask).not.toHaveBeenCalled();
  });

  it("a bare Enter is left to the textarea", () => {
    const { onStartTask } = mount();
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onStartTask).not.toHaveBeenCalled();
  });

  it("hides the host-only shortcuts rather than disabling them", () => {
    mount({ canCreateWorkspace: false, canCreateWorktree: false });
    const labels = Array.from(host.querySelectorAll(".nt-board__shortcuts button")).map(
      (button) => button.textContent,
    );
    expect(labels.join(" ")).toContain("Open folder");
    expect(labels.join(" ")).not.toContain("Create workspace");
    expect(labels.join(" ")).not.toContain("Create worktree");
  });

  it("omits the recents section entirely when there are none", () => {
    mount({ recents: [] });
    expect(host.querySelector(".nt-recents")).toBeNull();
  });
});
