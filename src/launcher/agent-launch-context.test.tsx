// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLaunchContext, type AgentLaunchContextProps } from "./agent-launch-context";
import type { LaunchContextView } from "./agent-launch-context-model";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

const repo: LaunchContextView = {
  workspaces: [
    { path: "/work/deck", label: "deck" },
    { path: "/work/api", label: "api" },
  ],
  workspacePath: "/work/deck",
  checkouts: [
    { path: "/work/deck", label: "main", linked: false },
    { path: "/work/deck-wt", label: "feat/rail", linked: true },
  ],
  checkoutPath: "/work/deck",
  chip: "Split beside Claude Code",
};

function mount(context: LaunchContextView = repo, onPickFolder = vi.fn(async () => {})) {
  const props: AgentLaunchContextProps = {
    context,
    homeDir: "/Users/dev",
    disabled: false,
    onSelectWorkspace: vi.fn(),
    onSelectCheckout: vi.fn(),
    onPickFolder,
  };
  act(() => render(<AgentLaunchContext {...props} />, host));
  return props;
}

const triggers = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>(".nt-workspace-picker__trigger"));
const row = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')).find((item) =>
    item.textContent?.includes(name),
  )!;

describe("launch page context row", () => {
  it("shows the workspace, the branch and the placement chip", () => {
    mount();
    expect(triggers().map((trigger) => trigger.textContent)).toEqual(["deck", "main"]);
    expect(host.querySelector(".agent-launch-page__chip")?.textContent).toBe(
      "Split beside Claude Code",
    );
  });

  it("has no checkout control for a folder git does not know", () => {
    mount({ ...repo, checkouts: [] });
    expect(triggers()).toHaveLength(1);
  });

  it("re-targets on a checkout choice and marks linked checkouts", () => {
    const props = mount();
    act(() => triggers()[1].click());
    expect(row("feat/rail").textContent).toContain("worktree");
    act(() => row("feat/rail").click());
    expect(props.onSelectCheckout).toHaveBeenCalledExactlyOnceWith("/work/deck-wt");
    expect(props.onSelectWorkspace).not.toHaveBeenCalled();
  });

  it("re-targets on a workspace choice", () => {
    const props = mount();
    act(() => triggers()[0].click());
    act(() => row("api").click());
    expect(props.onSelectWorkspace).toHaveBeenCalledExactlyOnceWith("/work/api");
  });

  it("opens the folder dialog from Open folder…", () => {
    const onPickFolder = vi.fn(async () => {});
    mount(repo, onPickFolder);
    act(() => triggers()[0].click());
    act(() => row("Open folder").click());
    expect(onPickFolder).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a failed folder dialog", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(
      repo,
      vi.fn(async () => {
        throw new Error("no dialog");
      }),
    );
    act(() => triggers()[0].click());
    await act(async () => row("Open folder").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("folder picker");
  });

  it("clears a failed folder dialog once the page is re-targeted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = mount(
      repo,
      vi.fn(async () => {
        throw new Error("no dialog");
      }),
    );
    act(() => triggers()[0].click());
    await act(async () => row("Open folder").click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    act(() =>
      render(
        <AgentLaunchContext {...props} context={{ ...repo, checkoutPath: "/work/deck-wt" }} />,
        host,
      ),
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes the checkout menu when the row becomes disabled", () => {
    const props = mount();
    act(() => triggers()[1].click());
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    act(() => render(<AgentLaunchContext {...props} disabled />, host));
    act(() => render(<AgentLaunchContext {...props} disabled={false} />, host));
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});
