// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "./workspace-picker";

let host: HTMLDivElement;

interface MountOptions {
  readonly value?: string | null;
  readonly paths?: readonly string[];
  readonly disabled?: boolean;
}

function mount(options: MountOptions = {}) {
  const onSelect = vi.fn();
  const onPickFolder = vi.fn();
  const draw = (disabled: boolean) =>
    act(() =>
      render(
        <WorkspacePicker
          value={options.value === undefined ? "/repo/deck" : options.value}
          paths={options.paths ?? ["/repo/deck", "/repo/api"]}
          homeDir="/Users/dev"
          disabled={disabled}
          onSelect={onSelect}
          onPickFolder={onPickFolder}
        />,
        host,
      ),
    );
  draw(options.disabled ?? false);
  return { onSelect, onPickFolder, redraw: draw };
}

const trigger = () => host.querySelector<HTMLButtonElement>(".nt-workspace-picker__trigger")!;
const items = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
const menu = () => host.querySelector('[role="menu"]');

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? host).dispatchEvent(event);
  });
  return event;
}

function openMenu(): void {
  act(() => trigger().click());
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("WorkspacePicker", () => {
  it("opens on the selected folder with Open folder first", () => {
    mount();
    expect(menu()).toBeNull();
    expect(trigger().textContent).toContain("deck");
    openMenu();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(items().map((item) => item.textContent)).toEqual(["Open folder…", "deck", "api"]);
    expect(host.querySelector('[role="separator"]')).not.toBeNull();
    expect(document.activeElement).toBe(items()[1]);
    expect(items()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("selects a folder without picking, then closes onto the trigger", () => {
    const { onSelect, onPickFolder } = mount();
    openMenu();
    act(() => items()[2].click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("/repo/api");
    expect(onPickFolder).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps focus on the trigger while the selection turns the board busy", () => {
    const { redraw } = mount();
    openMenu();
    act(() => items()[2].click());
    redraw(true);
    expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute("aria-disabled")).toBe("true");
  });

  it("names the trigger with the chosen folder", () => {
    mount();
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: deck");
    act(() => render(null, host));
    mount({ value: null });
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: Choose a folder");
  });

  it("keeps a selected recent in its recents position", () => {
    mount({ value: "/repo/api" });
    openMenu();
    expect(items().map((item) => item.title)).toEqual(["", "/repo/deck", "/repo/api"]);
    expect(document.activeElement).toBe(items()[2]);
  });

  it("Open folder hands off to the native dialog and selects nothing", () => {
    const { onSelect, onPickFolder } = mount();
    openMenu();
    act(() => items()[0].click());
    expect(onPickFolder).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("lists a selected folder outside the recents once, ahead of them", () => {
    mount({ value: "/elsewhere/tool", paths: ["/repo/deck", "/repo/deck", "/repo/api"] });
    openMenu();
    expect(items().map((item) => item.title)).toEqual([
      "",
      "/elsewhere/tool",
      "/repo/deck",
      "/repo/api",
    ]);
    expect(document.activeElement).toBe(items()[1]);
  });

  it("prints where two same-named folders live", () => {
    mount({ value: null, paths: ["/Users/dev/a/app", "/Users/dev/b/app", "/repo/api"] });
    openMenu();
    const details = Array.from(host.querySelectorAll(".nt-workspace-picker__detail"));
    expect(details.map((detail) => detail.textContent)).toEqual(["~/a/app", "~/b/app"]);
    expect(trigger().textContent).toContain("Choose a folder");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("moves with arrows, wraps, and jumps with Home and End", () => {
    mount();
    openMenu();
    press("ArrowDown");
    expect(document.activeElement).toBe(items()[2]);
    press("ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    press("ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
    press("Home");
    expect(document.activeElement).toBe(items()[0]);
    press("End");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("opens from the trigger with ArrowDown", () => {
    mount();
    trigger().focus();
    const event = press("ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
  });

  it("answers Escape itself and returns focus to the trigger", () => {
    mount();
    const outside = vi.fn();
    document.body.addEventListener("keydown", outside);
    openMenu();
    const event = press("Escape");
    document.body.removeEventListener("keydown", outside);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(event.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
  });

  it("leaves Escape to the board while closed", () => {
    mount();
    trigger().focus();
    const outside = vi.fn();
    document.body.addEventListener("keydown", outside);
    press("Escape");
    document.body.removeEventListener("keydown", outside);
    expect(outside).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside press and when focus leaves", () => {
    mount();
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    openMenu();
    act(() => {
      elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
    openMenu();
    act(() => elsewhere.focus());
    expect(menu()).toBeNull();
  });

  it("closes when the board turns busy and cannot reopen until it settles", () => {
    const { redraw } = mount();
    openMenu();
    redraw(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(menu()).toBeNull();
    redraw(false);
    openMenu();
    expect(menu()).not.toBeNull();
  });

  it("drops its document listener on unmount", () => {
    const remove = vi.spyOn(document, "removeEventListener");
    mount();
    openMenu();
    act(() => render(null, host));
    expect(remove).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    remove.mockRestore();
  });
});
