// @vitest-environment jsdom
import { createRef } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import {
  byRole,
  click,
  expectRefsToHoldElements,
  mount,
  press,
  waitUntil,
} from "./preset-test-kit";

const ui = await loadPresetControls();
const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } = ui;
const { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut } = ui;
const { DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } = ui;
const { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } = ui;

function Actions({ onRename }: { onRename: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const trigger = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-slot="dropdown-menu-trigger"]') as HTMLElement;

describe("DropdownMenu", () => {
  it("opens a menu, runs the chosen item and closes", async () => {
    const onRename = vi.fn();
    const view = await mount(<Actions onRename={onRename} />);
    await click(trigger(view.host));
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Rename", "Remove"]);

    await click(items[0]);
    expect(onRename).toHaveBeenCalledTimes(1);
    await waitUntil(() => byRole("menu") === null);
    await view.unmount();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const view = await mount(<Actions onRename={() => {}} />);
    trigger(view.host).focus();
    await click(trigger(view.host));
    expect(byRole("menu")).not.toBeNull();

    await press(byRole("menu") as HTMLElement, { key: "Escape" });
    await waitUntil(() => byRole("menu") === null);
    await waitUntil(() => document.activeElement === trigger(view.host));
    await view.unmount();
  });

  it("keeps checkbox and radio state in the caller's hands", async () => {
    function Prefs() {
      const [wrap, setWrap] = useState(false);
      const [font, setFont] = useState("mono");
      return (
        <DropdownMenu open>
          <DropdownMenuTrigger>View</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
              Wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value={font} onValueChange={(next) => setFont(String(next))}>
              <DropdownMenuRadioItem value="mono">Mono</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sans">Sans</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    const view = await mount(<Prefs />);
    const checkbox = (): HTMLElement =>
      document.body.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    const radios = (): HTMLElement[] => [
      ...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ];
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    await click(checkbox());
    expect(checkbox().getAttribute("aria-checked")).toBe("true");

    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    await click(radios()[1]);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    await view.unmount();
  });

  it("leaves no popup behind after an unmount, and mounts again", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Actions onRename={() => {}} />);
      await click(trigger(view.host));
      expect(byRole("menu")).not.toBeNull();
      await view.unmount();
      await waitUntil(() => byRole("menu") === null);
    }
  });

  it("forwards refs to the DOM elements of its parts", async () => {
    const names = [
      "trigger",
      "content",
      "group",
      "label",
      "item",
      "separator",
      "shortcut",
      "checkbox",
      "radioGroup",
      "radio",
      "subTrigger",
    ] as const;
    const refs = Object.fromEntries(
      names.map((name) => [name, createRef<HTMLElement>()]),
    ) as Record<(typeof names)[number], ReturnType<typeof createRef<HTMLElement>>>;
    const view = await mount(
      <DropdownMenu open>
        <DropdownMenuTrigger ref={refs.trigger}>Open</DropdownMenuTrigger>
        <DropdownMenuContent ref={refs.content}>
          <DropdownMenuGroup ref={refs.group}>
            <DropdownMenuLabel ref={refs.label}>Label</DropdownMenuLabel>
            <DropdownMenuItem ref={refs.item}>
              Item <DropdownMenuShortcut ref={refs.shortcut}>⌘K</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator ref={refs.separator} />
          <DropdownMenuCheckboxItem ref={refs.checkbox} checked>
            Check
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup ref={refs.radioGroup} value="a">
            <DropdownMenuRadioItem ref={refs.radio} value="a">
              A
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger ref={refs.subTrigger}>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>nested</DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expectRefsToHoldElements(refs, {
      trigger: "dropdown-menu-trigger",
      content: "dropdown-menu-content",
      group: "dropdown-menu-group",
      label: "dropdown-menu-label",
      item: "dropdown-menu-item",
      separator: "dropdown-menu-separator",
      shortcut: "dropdown-menu-shortcut",
      checkbox: "dropdown-menu-checkbox-item",
      radioGroup: "dropdown-menu-radio-group",
      radio: "dropdown-menu-radio-item",
      subTrigger: "dropdown-menu-sub-trigger",
    });
    await view.unmount();
  });
});
