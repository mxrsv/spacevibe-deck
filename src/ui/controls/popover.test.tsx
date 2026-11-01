// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
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
const { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } =
  ui;

const trigger = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-slot="popover-trigger"]') as HTMLElement;

const Sample = ({ open }: { open?: boolean }) => (
  <Popover open={open}>
    <PopoverTrigger>Branches</PopoverTrigger>
    <PopoverContent>
      <PopoverHeader>
        <PopoverTitle>Branch</PopoverTitle>
        <PopoverDescription>Switch the checkout.</PopoverDescription>
      </PopoverHeader>
    </PopoverContent>
  </Popover>
);

describe("Popover", () => {
  it("opens from its trigger and reflects that on the trigger", async () => {
    const view = await mount(<Sample />);
    expect(trigger(view.host).getAttribute("aria-expanded")).toBe("false");
    await click(trigger(view.host));
    expect(trigger(view.host).getAttribute("aria-expanded")).toBe("true");
    expect(document.body.querySelector('[data-slot="popover-title"]')?.textContent).toBe("Branch");
    await view.unmount();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const view = await mount(<Sample />);
    trigger(view.host).focus();
    await click(trigger(view.host));
    const popup = document.body.querySelector('[data-slot="popover-content"]') as HTMLElement;
    await press(popup, { key: "Escape" });
    await waitUntil(() => document.body.querySelector('[data-slot="popover-content"]') === null);
    expect(document.activeElement).toBe(trigger(view.host));
    await view.unmount();
  });

  it("follows a controlled `open`", async () => {
    const view = await mount(<Sample open={false} />);
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBeNull();
    await view.update(<Sample open />);
    expect(document.body.querySelector('[data-slot="popover-content"]')).not.toBeNull();
    await view.update(<Sample open={false} />);
    await waitUntil(() => document.body.querySelector('[data-slot="popover-content"]') === null);
    await view.unmount();
  });

  it("leaves no popup behind after an unmount, and mounts again", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Sample />);
      await click(trigger(view.host));
      expect(byRole("dialog")).not.toBeNull();
      await view.unmount();
      await waitUntil(() => byRole("dialog") === null);
    }
  });

  it("forwards refs to the DOM elements of its parts", async () => {
    const refs = {
      trigger: createRef<HTMLElement>(),
      content: createRef<HTMLElement>(),
      header: createRef<HTMLElement>(),
      title: createRef<HTMLElement>(),
      description: createRef<HTMLElement>(),
    };
    const view = await mount(
      <Popover open>
        <PopoverTrigger ref={refs.trigger}>Open</PopoverTrigger>
        <PopoverContent ref={refs.content}>
          <PopoverHeader ref={refs.header}>
            <PopoverTitle ref={refs.title}>T</PopoverTitle>
            <PopoverDescription ref={refs.description}>D</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );
    expectRefsToHoldElements(refs, {
      trigger: "popover-trigger",
      content: "popover-content",
      header: "popover-header",
      title: "popover-title",
      description: "popover-description",
    });
    await view.unmount();
  });
});
