// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { EMPTY_DRAFT, withAgent, withPrompt, withWorkspace } from "./new-task-draft";
import { QuickLaunch, QuickLaunchSubview, type QuickLaunchProps } from "./quick-launch";

const AGENTS: readonly AgentOption[] = [
  { id: "claude", label: "Claude Code", detail: "/usr/bin/claude", missing: false },
];

let host: HTMLDivElement;

function readyDraft(promptExpanded = true) {
  return withPrompt(
    withAgent(withWorkspace({ ...EMPTY_DRAFT, promptExpanded }, "/repo/deck"), "claude", null),
    "ship it",
  );
}

function mount(overrides: Partial<QuickLaunchProps> = {}) {
  const onClose = vi.fn();
  const onDraftChange = vi.fn();
  const onPromptExpandedChange = vi.fn();
  const onStartTask = vi.fn();
  const onOpenAgent = vi.fn();
  const onTransferToBoard = vi.fn();
  const onRetryDelivery = vi.fn();
  const onFocusOpenedAgent = vi.fn();
  const onClearDraft = vi.fn();
  const props: QuickLaunchProps = {
    // The staged prompt is hidden in production behind
    // `TASK_PROMPT_STAGING_ENABLED`; these tests keep it wired, the
    // `deliverGrab(…, pasteDisabled)` precedent.
    promptStaging: true,
    draft: readyDraft(),
    agents: AGENTS,
    recents: [{ path: "/repo/deck", lastOpenedAt: 1 }],
    declaredModels: {},
    agentRuntimeDefaults: {},
    canCreateWorkspace: true,
    canCreateWorktree: true,
    pending: null,
    problem: null,
    openProblem: null,
    agentsResolved: true,
    notice: null,
    retarget: null,
    canRetryDelivery: false,
    canFocusOpenedAgent: false,
    hasUserDraftContent: true,
    onDraftChange,
    onPromptExpandedChange,
    onPickFolder: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onCreateWorktree: vi.fn(),
    onManageAgents: vi.fn(),
    onStartTask,
    onOpenAgent,
    onRetryDelivery,
    onFocusOpenedAgent,
    onClearDraft,
    onKeepRetarget: vi.fn(),
    onMoveRetarget: vi.fn(),
    onClearRetarget: vi.fn(),
    onTransferToBoard,
    onClose,
    ...overrides,
  };
  act(() => render(<QuickLaunch {...props} />, host));
  return {
    onClose,
    onDraftChange,
    onPromptExpandedChange,
    onStartTask,
    onOpenAgent,
    onRetryDelivery,
    onFocusOpenedAgent,
    onClearDraft,
    onTransferToBoard,
  };
}

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetDesktopEnvironmentForTests();
});

describe("QuickLaunch", () => {
  it("is a non-modal popover and stays open when the background is pressed", () => {
    const { onClose } = mount();

    expect(host.querySelector(".nt-quick-launch")).not.toBeNull();
    expect(host.querySelector(".modal-scrim")).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from Escape anywhere in the document", () => {
    const { onClose } = mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the user's focused control across ordinary prop updates", () => {
    mount();
    const workspace = host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]');
    workspace?.focus();

    mount({ notice: "Still working…" });

    expect(document.activeElement).toBe(workspace);
  });

  it("starts from the expanded prompt and opens only the agent when collapsed", () => {
    const expanded = mount();
    host.querySelector<HTMLButtonElement>(".nt-primary-action")?.click();
    expect(expanded.onStartTask).toHaveBeenCalledTimes(1);
    expect(expanded.onOpenAgent).not.toHaveBeenCalled();

    act(() => render(null, host));
    const collapsed = mount({ draft: readyDraft(false) });
    const primary = host.querySelector<HTMLButtonElement>(".nt-primary-action");
    expect(primary?.textContent).toContain("Open agent");
    primary?.click();
    expect(collapsed.onOpenAgent).toHaveBeenCalledTimes(1);
    expect(collapsed.onStartTask).not.toHaveBeenCalled();
  });

  it("persists the prompt visibility choice while updating the shared draft", () => {
    const { onDraftChange, onPromptExpandedChange } = mount();
    const hide = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Hide prompt",
    );
    hide?.click();

    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ promptExpanded: false }));
    expect(onPromptExpandedChange).toHaveBeenCalledWith(false);
  });

  it("hands the complete draft to the full composer", () => {
    const { onTransferToBoard } = mount();
    host.querySelector<HTMLButtonElement>('[aria-label="Open full composer"]')?.click();
    expect(onTransferToBoard).toHaveBeenCalledTimes(1);
  });

  it("runs Cmd+Enter only while the visible prompt is valid", () => {
    const { onStartTask } = mount();
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(onStartTask).toHaveBeenCalledTimes(1);

    act(() => render(null, host));
    const blocked = mount({ problem: "empty-prompt", draft: readyDraft() });
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    expect(blocked.onStartTask).not.toHaveBeenCalled();
  });

  it("returns from an in-place subview before closing the launcher", () => {
    const onBack = vi.fn();
    act(() =>
      render(
        <QuickLaunchSubview label="Create workspace" onBack={onBack}>
          <input aria-label="Subview field" />
        </QuickLaunchSubview>,
        host,
      ),
    );

    document.body.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps a staged prompt visible with focus recovery but no retry", () => {
    const { onFocusOpenedAgent, onRetryDelivery } = mount({
      notice: "Your task is waiting in the agent — press Enter there to send it",
      canFocusOpenedAgent: true,
      canRetryDelivery: false,
    });

    expect(host.querySelector(".nt-quick-launch")).not.toBeNull();
    expect(host.textContent).toContain("press Enter there");
    expect(host.textContent).not.toContain("Retry delivery");
    const focus = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Focus opened agent",
    );
    focus?.click();
    expect(onFocusOpenedAgent).toHaveBeenCalledTimes(1);
    expect(onRetryDelivery).not.toHaveBeenCalled();
  });

  it("forwards retry and explicit clear actions once", () => {
    const { onRetryDelivery, onClearDraft } = mount({ canRetryDelivery: true });
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((button) => button.textContent === "Retry delivery")?.click();
    buttons.find((button) => button.textContent === "Clear draft")?.click();
    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onClearDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps the current project selected until a retarget choice is explicit", () => {
    const onKeepRetarget = vi.fn();
    const onMoveRetarget = vi.fn();
    const onClearRetarget = vi.fn();
    mount({
      retarget: { currentPath: "/repo/alpha", requestedPath: "/repo/beta" },
      draft: { ...readyDraft(), workspacePath: "/repo/alpha" },
      recents: [
        { path: "/repo/alpha", lastOpenedAt: 2 },
        { path: "/repo/beta", lastOpenedAt: 1 },
      ],
      onKeepRetarget,
      onMoveRetarget,
      onClearRetarget,
    });

    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]')?.value).toBe(
      "/repo/alpha",
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain("beta");
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((button) => button.textContent === "Keep alpha")?.click();
    buttons.find((button) => button.textContent === "Move to beta")?.click();
    buttons.find((button) => button.textContent === "Clear and use beta")?.click();
    expect(onKeepRetarget).toHaveBeenCalledTimes(1);
    expect(onMoveRetarget).toHaveBeenCalledTimes(1);
    expect(onClearRetarget).toHaveBeenCalledTimes(1);
  });

  it("disambiguates retarget choices when both repositories share a basename", () => {
    mount({
      retarget: { currentPath: "/client/app", requestedPath: "/server/app" },
      draft: { ...readyDraft(), workspacePath: "/client/app" },
      recents: [
        { path: "/client/app", lastOpenedAt: 2 },
        { path: "/server/app", lastOpenedAt: 1 },
      ],
    });

    expect(host.querySelector('[role="status"]')?.textContent).toContain("/client/app");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("/server/app");
    expect(host.querySelector('button[aria-label="Keep draft in /client/app"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Move draft to /server/app"]')).not.toBeNull();
  });
});
