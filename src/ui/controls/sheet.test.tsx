// @vitest-environment jsdom
import { createRef } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import {
  byRole,
  click,
  expectRefsToHoldElements,
  mount,
  press,
  settle,
  waitUntil,
} from "./preset-test-kit";

const ui = await loadPresetControls();
const { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetFooter, SheetTitle } = ui;
const { SheetDescription, SheetClose } = ui;

const scrim = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');

/** A press on the scrim, as a pointer delivers it: down, up, then the click. */
async function pressScrim(target: HTMLElement): Promise<void> {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  });
  await settle();
}

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <SheetTrigger>Open</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Agent</SheetTitle>
          <SheetDescription>Everything about the focused agent.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <SheetClose>Done</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("opens from its trigger, names itself from the title and closes on Escape", async () => {
    const changes: boolean[] = [];
    const view = await mount(<Harness onOpenChange={(open) => changes.push(open)} />);
    expect(byRole("dialog")).toBeNull();

    await click(view.host.querySelector("button") as HTMLElement);
    const sheet = byRole("dialog") as HTMLElement;
    expect(sheet.getAttribute("data-slot")).toBe("sheet-content");
    expect(sheet.getAttribute("aria-labelledby")).toBe(
      document.body.querySelector('[data-slot="sheet-title"]')?.id,
    );

    await press(sheet, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    expect(changes).toEqual([true, false]);
    await view.unmount();
  });

  it("returns focus to the trigger that opened it", async () => {
    const view = await mount(<Harness />);
    const trigger = view.host.querySelector("button") as HTMLElement;
    trigger.focus();
    await click(trigger);
    expect(byRole("dialog")?.contains(document.activeElement)).toBe(true);

    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => document.activeElement === trigger);
    await view.unmount();
  });

  it("closes when the scrim is pressed", async () => {
    const changes: boolean[] = [];
    const view = await mount(<Harness onOpenChange={(open) => changes.push(open)} />);
    await click(view.host.querySelector("button") as HTMLElement);
    expect(scrim()).not.toBeNull();

    await pressScrim(scrim() as HTMLElement);
    await waitUntil(() => byRole("dialog") === null);
    expect(changes).toEqual([true, false]);
    await view.unmount();
  });

  it("stays open when its own content is pressed", async () => {
    const view = await mount(<Harness />);
    await click(view.host.querySelector("button") as HTMLElement);
    await pressScrim(document.body.querySelector('[data-slot="sheet-title"]') as HTMLElement);
    expect(byRole("dialog")).not.toBeNull();
    await view.unmount();
  });

  it("closes from the close button and from a SheetClose", async () => {
    const view = await mount(<Harness />);
    const trigger = view.host.querySelector("button") as HTMLElement;

    const closer = (name: string): HTMLElement =>
      [...document.body.querySelectorAll<HTMLElement>('[data-slot="sheet-close"]')].find(
        (button) => button.textContent === name,
      ) as HTMLElement;

    await click(trigger);
    await click(closer("Close"));
    await waitUntil(() => byRole("dialog") === null);

    await click(trigger);
    await click(closer("Done"));
    await waitUntil(() => byRole("dialog") === null);
    await view.unmount();
  });

  it("drops the corner close button on request", async () => {
    const view = await mount(
      <Sheet open>
        <SheetContent showCloseButton={false}>
          <SheetTitle>T</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(document.body.querySelector('[data-slot="sheet-close"]')).toBeNull();
    await view.unmount();
  });

  it("is anchored to the right edge", async () => {
    const view = await mount(
      <Sheet open>
        <SheetContent>
          <SheetTitle>T</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(byRole("dialog")?.getAttribute("data-side")).toBe("right");
    await view.unmount();
  });

  it("follows a controlled `open` and leaves no portal behind after unmount", async () => {
    const sample = (open: boolean) => (
      <Sheet open={open}>
        <SheetContent>
          <SheetTitle>T</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    const view = await mount(sample(false));
    expect(byRole("dialog")).toBeNull();
    await view.update(sample(true));
    expect(byRole("dialog")).not.toBeNull();
    await view.update(sample(false));
    await waitUntil(() => byRole("dialog") === null);
    await view.update(sample(true));
    await view.unmount();
    await settle();
    expect(document.body.querySelector('[data-slot^="sheet-"]')).toBeNull();
  });

  it("mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Harness />);
      await click(view.host.querySelector("button") as HTMLElement);
      expect(byRole("dialog")).not.toBeNull();
      await view.unmount();
      expect(byRole("dialog")).toBeNull();
    }
  });

  it("forwards refs to the DOM elements of its parts", async () => {
    const refs = {
      content: createRef<HTMLElement>(),
      title: createRef<HTMLElement>(),
      description: createRef<HTMLElement>(),
      header: createRef<HTMLElement>(),
      footer: createRef<HTMLElement>(),
      close: createRef<HTMLElement>(),
      trigger: createRef<HTMLElement>(),
    };
    const view = await mount(
      <Sheet open>
        <SheetTrigger ref={refs.trigger}>Open</SheetTrigger>
        <SheetContent ref={refs.content} showCloseButton={false}>
          <SheetHeader ref={refs.header}>
            <SheetTitle ref={refs.title}>T</SheetTitle>
            <SheetDescription ref={refs.description}>D</SheetDescription>
          </SheetHeader>
          <SheetFooter ref={refs.footer}>
            <SheetClose ref={refs.close}>Close</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expectRefsToHoldElements(refs, {
      content: "sheet-content",
      title: "sheet-title",
      description: "sheet-description",
      header: "sheet-header",
      footer: "sheet-footer",
      close: "sheet-close",
      trigger: "sheet-trigger",
    });
    await view.unmount();
  });
});
