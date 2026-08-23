// @vitest-environment jsdom
import { render } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOption } from "../lib/agent-catalog";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { LauncherFields, type LauncherFieldsProps } from "./launcher-fields";
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
    notice: null,
    onDraftChange,
    onPickFolder,
    onCreateWorkspace: vi.fn(),
    onCreateWorktree: vi.fn(),
    onManageAgents,
    onStartTask,
    onOpenAgent: vi.fn(),
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

  it("disables the fields while an operation is pending", () => {
    mount({ draft: ready(), pending: "opening-agent" });
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".nt-primary-action")?.disabled).toBe(true);
  });
});
