// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import {
  byRole,
  click,
  expectRefsToHoldElements,
  mount,
  press,
  visibleByRole,
  waitUntil,
} from "./preset-test-kit";

const ui = await loadPresetControls();
const { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } =
  ui;
const { SelectSeparator } = ui;

const items = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function Menu({ value, onValueChange }: { value: string; onValueChange?: (v: string) => void }) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onValueChange?.(String(next))}>
      <SelectTrigger aria-label="Mode">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const trigger = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-slot="select-trigger"]') as HTMLElement;

describe("Select", () => {
  it("shows the chosen item's label and follows a controlled value", async () => {
    const view = await mount(<Menu value="dark" />);
    expect(trigger(view.host).textContent).toContain("Dark");
    await view.update(<Menu value="light" />);
    expect(trigger(view.host).textContent).toContain("Light");
    await view.unmount();
  });

  it("opens a listbox, picks an item with the pointer and reports it", async () => {
    const onValueChange = vi.fn();
    const view = await mount(<Menu value="system" onValueChange={onValueChange} />);
    await click(trigger(view.host));
    expect(byRole("listbox")).not.toBeNull();

    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["System", "Dark", "Light"]);
    await click(options[1]);
    expect(onValueChange).toHaveBeenCalledWith("dark");
    await waitUntil(() => visibleByRole("listbox") === null);
    await view.unmount();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const view = await mount(<Menu value="system" />);
    trigger(view.host).focus();
    await click(trigger(view.host));
    expect(byRole("listbox")).not.toBeNull();

    await press(byRole("listbox") as HTMLElement, { key: "Escape" });
    await waitUntil(() => visibleByRole("listbox") === null);
    await waitUntil(() => document.activeElement === trigger(view.host));
    await view.unmount();
  });

  it("leaves no popup behind after an unmount, and mounts again", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Menu value="system" />);
      await click(trigger(view.host));
      expect(byRole("listbox")).not.toBeNull();
      await view.unmount();
      await waitUntil(() => byRole("listbox") === null);
    }
  });

  it("forwards refs to the DOM elements of its parts", async () => {
    const refs = {
      trigger: createRef<HTMLElement>(),
      value: createRef<HTMLElement>(),
      content: createRef<HTMLElement>(),
      group: createRef<HTMLElement>(),
      label: createRef<HTMLElement>(),
      item: createRef<HTMLElement>(),
      separator: createRef<HTMLElement>(),
    };
    const view = await mount(
      <Select items={items} defaultValue="system" open>
        <SelectTrigger ref={refs.trigger}>
          <SelectValue ref={refs.value} />
        </SelectTrigger>
        <SelectContent ref={refs.content}>
          <SelectGroup ref={refs.group}>
            <SelectLabel ref={refs.label}>Mode</SelectLabel>
            <SelectItem ref={refs.item} value="system">
              System
            </SelectItem>
            <SelectSeparator ref={refs.separator} />
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expectRefsToHoldElements(refs, {
      trigger: "select-trigger",
      value: "select-value",
      content: "select-content",
      group: "select-group",
      label: "select-label",
      item: "select-item",
      separator: "select-separator",
    });
    await view.unmount();
  });
});
