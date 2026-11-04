// @vitest-environment jsdom
import { createRef } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, mount, press, settle } from "../ui/controls/preset-test-kit";
import type { CommandBarProject } from "./command-bar-model";
import { CommandBarProjectMenu } from "./command-bar-project-menu";

const PROJECTS: readonly CommandBarProject[] = Array.from({ length: 23 }, (_, n) => ({
  path: `/work/project-${String(n).padStart(2, "0")}`,
  name: `project-${String(n).padStart(2, "0")}`,
  branch: "main",
  age: n >= 20 ? `${n - 18}w` : null,
}));

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  // jsdom has no layout, so a stub records which row the menu asked to bring into view.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this.id.split("/").at(-1) ?? "");
  };
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function setup(over: Partial<Parameters<typeof CommandBarProjectMenu>[0]> = {}) {
  const props = {
    projects: PROJECTS,
    currentPath: PROJECTS[2].path,
    anchorRef: createRef<HTMLElement>(),
    openFolderKeys: ["⌘", "O"],
    onPick: vi.fn(),
    onOpenFolder: vi.fn(),
    onNewWorktree: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return props;
}

const search = (): HTMLInputElement =>
  document.querySelector('input[aria-label="Find a project"]') as HTMLInputElement;
const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const name = (row: HTMLElement): string =>
  row.querySelector(".command-bar-menu__name")?.textContent ?? "";
const highlighted = (): string[] =>
  options()
    .filter((row) => row.hasAttribute("data-highlighted"))
    .map(name);

async function type(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("CommandBarProjectMenu", () => {
  it("takes focus on its search, which counts the projects", async () => {
    const view = await mount(<CommandBarProjectMenu {...setup()} />);
    expect(document.activeElement).toBe(search());
    expect(search().placeholder).toBe("Find in 23 projects");
    await view.unmount();
  });

  it("lists every project in order, then a separator, then the two fixed actions", async () => {
    const view = await mount(<CommandBarProjectMenu {...setup()} />);
    expect(options().map(name)).toEqual(PROJECTS.map((p) => p.name));
    const list = document.querySelector('[role="listbox"]') as HTMLElement;
    const rule = document.querySelector('[role="separator"]') as HTMLElement;
    const actions = [...document.querySelectorAll<HTMLElement>(".command-bar-menu__action")];
    expect(actions.map((action) => action.textContent)).toEqual([
      "Open folder…⌘O",
      "New worktree…",
    ]);
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(list, rule)).toBe(true);
    expect(follows(rule, actions[0])).toBe(true);
    // The actions sit beside the list, not inside the part that scrolls.
    expect(list.contains(actions[0])).toBe(false);
    await view.unmount();
  });

  it("marks the current project with a check and an older one with its age", async () => {
    const view = await mount(<CommandBarProjectMenu {...setup()} />);
    const rows = options();
    expect(rows[2].getAttribute("aria-current")).toBe("true");
    expect(rows[2].querySelector("svg, .deck-icon")).not.toBeNull();
    expect(rows[22].textContent).toContain("4w");
    await view.unmount();
  });

  it("moves the highlight with the arrows, keeps it in view, and wraps", async () => {
    const view = await mount(<CommandBarProjectMenu {...setup()} />);
    expect(highlighted()).toEqual(["project-00"]);
    for (let step = 0; step < 12; step += 1) await press(search(), { key: "ArrowDown" });
    expect(highlighted()).toEqual(["project-12"]);
    expect(scrolled.at(-1)).toBe("project-12");
    await press(search(), { key: "ArrowUp" });
    expect(highlighted()).toEqual(["project-11"]);
    for (let step = 0; step < 12; step += 1) await press(search(), { key: "ArrowUp" });
    expect(highlighted()).toEqual(["project-22"]);
    await view.unmount();
  });

  it("picks the highlighted row on Enter", async () => {
    const props = setup();
    const view = await mount(<CommandBarProjectMenu {...props} />);
    for (let step = 0; step < 12; step += 1) await press(search(), { key: "ArrowDown" });
    await press(search(), { key: "Enter" });
    expect(props.onPick).toHaveBeenCalledWith("/work/project-12");
    await view.unmount();
  });

  it("closes on Escape", async () => {
    const props = setup();
    const view = await mount(<CommandBarProjectMenu {...props} />);
    await press(search(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("filters all of history as you type and bolds the match", async () => {
    const view = await mount(<CommandBarProjectMenu {...setup()} />);
    await type(search(), "ject-2");
    expect(options().map(name)).toEqual(["project-20", "project-21", "project-22"]);
    expect(options()[0].querySelector("b")?.textContent).toBe("ject-2");
    expect(highlighted()).toEqual(["project-20"]);
    await view.unmount();
  });

  it("says so when nothing matches, and Enter picks nothing", async () => {
    const props = setup();
    const view = await mount(<CommandBarProjectMenu {...props} />);
    await type(search(), "zzz");
    expect(document.body.textContent).toContain("No project matches");
    expect(options()).toEqual([]);
    await press(search(), { key: "Enter" });
    expect(props.onPick).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("runs the fixed actions from their buttons without picking a row", async () => {
    const props = setup();
    const view = await mount(<CommandBarProjectMenu {...props} />);
    const [folder, worktree] = [
      ...document.querySelectorAll<HTMLElement>(".command-bar-menu__action"),
    ];
    // Enter on an action is that button's press, not the highlighted row's pick.
    await press(folder, { key: "Enter" });
    expect(props.onPick).not.toHaveBeenCalled();
    await click(folder);
    await click(worktree);
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(props.onNewWorktree).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("closes on a press outside the menu, but not on its anchor", async () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const props = setup({ anchorRef: { current: anchor } });
    const view = await mount(<CommandBarProjectMenu {...props} />);
    anchor.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    anchor.remove();
    await view.unmount();
  });
});
