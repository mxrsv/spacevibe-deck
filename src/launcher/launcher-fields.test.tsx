// @vitest-environment jsdom
import { render } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { RecentWorkspace } from "../lib/workspace-recents";
import {
  LauncherFields,
  launcherPendingLabel,
  problemTone,
  type LauncherFieldsProps,
} from "./launcher-fields";
import { EMPTY_DRAFT, withAgent, withWorkspace, type NewTaskDraft } from "./new-task-draft";

const AGENTS: readonly AgentOption[] = [
  { id: "claude", label: "Claude Code", detail: "/usr/bin/claude", missing: false },
  { id: "codex", label: "Codex", detail: "/usr/bin/codex", missing: false },
];

const RECENTS: readonly RecentWorkspace[] = [{ path: "/repo/deck", lastOpenedAt: 1 }];

let host: HTMLDivElement;

function mount(overrides: Partial<LauncherFieldsProps> = {}): {
  onDraftChange: ReturnType<typeof vi.fn>;
  onManageAgents: ReturnType<typeof vi.fn>;
  onStartTask: ReturnType<typeof vi.fn>;
  onPickFolder: ReturnType<typeof vi.fn>;
} {
  const onDraftChange = vi.fn();
  const onManageAgents = vi.fn();
  const onStartTask = vi.fn();
  const onPickFolder = vi.fn();
  const props: LauncherFieldsProps = {
    idPrefix: "test",
    compact: false,
    draft: EMPTY_DRAFT,
    agents: AGENTS,
    recents: RECENTS,
    declaredModels: {},
    agentRuntimeDefaults: {},
    canCreateWorkspace: true,
    canCreateWorktree: true,
    pending: null,
    problem: null,
    openProblem: null,
    agentsResolved: true,
    notice: null,
    canRetryDelivery: false,
    canFocusOpenedAgent: false,
    hasUserDraftContent: false,
    onDraftChange,
    onPickFolder,
    onCreateWorkspace: vi.fn(),
    onCreateWorktree: vi.fn(),
    onManageAgents,
    onStartTask,
    onOpenAgent: vi.fn(),
    onRetryDelivery: vi.fn(),
    onFocusOpenedAgent: vi.fn(),
    onClearDraft: vi.fn(),
    ...overrides,
  };
  render(<LauncherFields {...props} />, host);
  return { onDraftChange, onManageAgents, onStartTask, onPickFolder };
}

function ready(): NewTaskDraft {
  return { ...withAgent(withWorkspace(EMPTY_DRAFT, "/repo/deck"), "claude", null), prompt: "go" };
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("LauncherFields", () => {
  it("prints identity, not field labels", () => {
    mount({ draft: ready() });
    const text = host.textContent ?? "";
    expect(text).toContain("Claude Code");
    // The words exist only as aria-labels, where a screen reader needs them.
    expect(text).not.toContain("Workspace");
    expect(text).not.toContain("Agent");
    expect(text).not.toContain("Model");
    expect(text).not.toContain("Effort");
    expect(host.querySelector('select[aria-label="Workspace"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Agent"]')).not.toBeNull();
  });

  it("omits the runtime select for an agent with nothing to offer", () => {
    // codex documents a --model flag but enumerates no models, and has no
    // effort flag — so there is nothing to choose and DL-19.7 says omit.
    mount({ draft: { ...ready(), agentId: "codex" } });
    expect(host.querySelector('select[aria-label="Model and effort"]')).toBeNull();
  });

  it("offers model x effort for an agent that has both", () => {
    mount({ draft: ready(), declaredModels: { claude: ["opus"] } });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Model and effort"]');
    expect(select).not.toBeNull();
    const labels = Array.from(select?.options ?? []).map((option) => option.textContent);
    expect(labels).toContain("opus · high");
  });

  it("offers the user's declared models for an agent the catalog seeds empty", () => {
    mount({ draft: { ...ready(), agentId: "codex" }, declaredModels: { codex: ["gpt-5"] } });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Model and effort"]');
    expect(select).not.toBeNull();
    expect(Array.from(select?.options ?? []).map((o) => o.textContent)).toContain("gpt-5");
  });

  it("routes an unavailable agent to Settings and blocks the launch", () => {
    const { onManageAgents } = mount({ draft: ready(), problem: "agent-unavailable" });
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("not on your PATH");
    const manage = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Manage agents"),
    );
    expect(manage).toBeDefined();
    manage?.click();
    expect(onManageAgents).toHaveBeenCalledTimes(1);
    const primary = host.querySelector<HTMLButtonElement>(".nt-primary-action");
    expect(primary?.disabled).toBe(true);
  });

  it("disables Start task while a problem stands and enables it when clear", () => {
    mount({ draft: ready(), problem: "empty-prompt" });
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.disabled).toBe(true);
    mount({ draft: ready(), problem: null });
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.disabled).toBe(false);
  });

  it("selecting a workspace action calls it instead of editing the draft", () => {
    const { onDraftChange, onPickFolder } = mount({ draft: ready() });
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Workspace"]');
    if (select === null) {
      throw new Error("no workspace select");
    }
    select.value = "__pick-folder";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onPickFolder).toHaveBeenCalledTimes(1);
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("hides host-only workspace actions rather than disabling them", () => {
    mount({ draft: ready(), canCreateWorkspace: false, canCreateWorktree: false });
    const values = Array.from(
      host.querySelectorAll<HTMLOptionElement>('select[aria-label="Workspace"] option'),
    ).map((option) => option.value);
    expect(values).toContain("__pick-folder");
    expect(values).not.toContain("__create-workspace");
    expect(values).not.toContain("__create-worktree");
  });

  it("keeps the prompt visible on the full composer and collapsible when compact", () => {
    mount({ draft: { ...ready(), promptExpanded: false }, compact: false });
    expect(host.querySelector("textarea")).not.toBeNull();
    mount({ draft: { ...ready(), promptExpanded: false }, compact: true });
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.textContent).toContain(
      "Open agent",
    );
  });

  it("shows a finished attempt as a status, not an alert", () => {
    mount({ draft: ready(), notice: "Your task is in the composer — press Enter to send" });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("press Enter");
  });

  it("does not alert about a draft nobody has filled in yet", () => {
    // The composer used to open red: `role="alert"` fired on first paint for
    // the resting state of an untouched form. An unanswered field is still
    // said — quietly, and without claiming something went wrong.
    mount({ draft: EMPTY_DRAFT, problem: "no-workspace", openProblem: "no-workspace" });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("Pick a folder to work in");
  });

  it("keeps an empty prompt entirely silent — the label already asked", () => {
    mount({ draft: { ...ready(), prompt: "" }, problem: "empty-prompt", openProblem: null });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("Describe the task first");
    // The disabled primary is what says "not ready".
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.disabled).toBe(true);
  });

  it("waits for discovery before declaring no agent is installed", () => {
    const blocked = {
      draft: EMPTY_DRAFT,
      agents: [],
      problem: "no-runnable-agent" as const,
      openProblem: "no-runnable-agent" as const,
    };
    mount({ ...blocked, agentsResolved: false });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("No agent is installed");

    mount({ ...blocked, agentsResolved: true });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("No agent is installed");
  });

  it("gates Open agent first on the structural chain, not on the prompt", () => {
    mount({ draft: { ...ready(), prompt: "" }, problem: "empty-prompt", openProblem: null });
    expect(host.querySelector<HTMLButtonElement>(".nt-secondary-action")?.disabled).toBe(false);

    // Without a workspace it cannot open anything, and used to say so by
    // launching and blaming the folder it was never given.
    mount({ draft: EMPTY_DRAFT, problem: "no-workspace", openProblem: "no-workspace" });
    expect(host.querySelector<HTMLButtonElement>(".nt-secondary-action")?.disabled).toBe(true);
  });

  it("a collapsed prompt does not block Open agent", () => {
    mount({
      compact: true,
      draft: { ...ready(), prompt: "", promptExpanded: false },
      problem: "empty-prompt",
      openProblem: null,
    });
    const primary = host.querySelector<HTMLButtonElement>(".nt-primary-action");
    expect(primary?.textContent).toContain("Open agent");
    // It offers exactly "open it with no task", so a missing task cannot block it.
    expect(primary?.disabled).toBe(false);
  });

  it("disables the fields while an operation is pending", () => {
    mount({ draft: ready(), pending: "opening-agent" });
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.disabled).toBe(true);
  });

  it.each([
    ["picking-folder", "Opening folder picker…"],
    ["selecting-workspace", "Checking workspace…"],
    ["creating-workspace", "Creating workspace…"],
    ["creating-worktree", "Creating worktree…"],
    ["opening-agent", "Opening agent…"],
    ["sending-prompt", "Starting agent and staging task…"],
    ["retrying-prompt", "Retrying task delivery…"],
  ] as const)("announces %s by name", (pending, label) => {
    expect(launcherPendingLabel(pending)).toBe(label);
    mount({ draft: ready(), pending });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(label);
  });

  it("offers focus without retry when the prompt is already staged", () => {
    const onFocusOpenedAgent = vi.fn();
    const onRetryDelivery = vi.fn();
    mount({
      draft: ready(),
      notice: "Task staged — press Enter in Claude Code",
      canFocusOpenedAgent: true,
      canRetryDelivery: false,
      onFocusOpenedAgent,
      onRetryDelivery,
    });

    const focus = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Focus opened agent",
    );
    expect(focus).toBeDefined();
    expect(host.textContent).not.toContain("Retry delivery");
    focus?.click();
    expect(onFocusOpenedAgent).toHaveBeenCalledTimes(1);
    expect(onRetryDelivery).not.toHaveBeenCalled();
  });

  it("offers safe retry and an explicit draft reset", () => {
    const onRetryDelivery = vi.fn();
    const onClearDraft = vi.fn();
    mount({
      draft: ready(),
      canFocusOpenedAgent: true,
      canRetryDelivery: true,
      hasUserDraftContent: true,
      onRetryDelivery,
      onClearDraft,
    });

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    buttons.find((button) => button.textContent === "Retry delivery")?.click();
    buttons.find((button) => button.textContent === "Clear draft")?.click();
    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onClearDraft).toHaveBeenCalledTimes(1);
  });

  it("does not call contextual workspace and agent defaults a user-authored draft", () => {
    mount({
      draft: { ...ready(), prompt: "" },
      hasUserDraftContent: false,
    });

    expect(host.textContent).not.toContain("Clear draft");
  });

  it("blocks transfer to the full composer while a launch is pending", () => {
    const onOpenFullComposer = vi.fn();
    mount({
      draft: ready(),
      pending: "sending-prompt",
      onOpenFullComposer,
    });

    const transfer = host.querySelector<HTMLButtonElement>('[aria-label="Open full composer"]');
    expect(transfer?.disabled).toBe(true);
    transfer?.click();
    expect(onOpenFullComposer).not.toHaveBeenCalled();
  });
});

describe("problemTone", () => {
  it("reserves the alarm for what the composer cannot fix", () => {
    expect(problemTone("agent-unavailable", true)).toBe("alert");
    expect(problemTone("no-runnable-agent", true)).toBe("alert");
    // Not yet looked ≠ nothing found.
    expect(problemTone("no-runnable-agent", false)).toBe("silent");
    expect(problemTone("no-workspace", true)).toBe("hint");
    expect(problemTone("no-agent", true)).toBe("hint");
    expect(problemTone("empty-prompt", true)).toBe("silent");
    expect(problemTone(null, true)).toBe("silent");
  });
});
