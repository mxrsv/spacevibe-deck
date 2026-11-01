// @vitest-environment jsdom
import { createRef } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { byRole, click, mount, press, settle, waitUntil } from "./preset-test-kit";

const ui = await loadPresetControls();
const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle } = ui;
const { DialogDescription, DialogClose, DialogOverlay } = ui;

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Pick a name.</DialogDescription>
        </DialogHeader>
        <input aria-label="Name" />
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("opens from its trigger, names itself from the title and closes on Escape", async () => {
    const changes: boolean[] = [];
    const view = await mount(<Harness onOpenChange={(open) => changes.push(open)} />);
    expect(byRole("dialog")).toBeNull();

    await click(view.host.querySelector("button") as HTMLElement);
    const dialog = byRole("dialog") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      document.body.querySelector('[data-slot="dialog-title"]')?.id,
    );

    await press(dialog, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    expect(changes).toEqual([true, false]);
    await view.unmount();
  });

  it("returns focus to the trigger that opened it", async () => {
    const view = await mount(<Harness />);
    const trigger = view.host.querySelector("button") as HTMLElement;
    trigger.focus();
    await click(trigger);
    expect(document.activeElement).not.toBe(trigger);
    expect(byRole("dialog")?.contains(document.activeElement)).toBe(true);

    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => document.activeElement === trigger);
    await view.unmount();
  });

  it("follows a controlled `open` and leaves no portal behind after unmount", async () => {
    const view = await mount(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(byRole("dialog")).toBeNull();
    await view.update(
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(byRole("dialog")).not.toBeNull();
    await view.unmount();
    await settle();
    expect(document.body.querySelector('[data-slot^="dialog-"]')).toBeNull();
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
      overlay: createRef<HTMLElement>(),
      trigger: createRef<HTMLElement>(),
    };
    const view = await mount(
      <Dialog open>
        <DialogTrigger ref={refs.trigger}>Open</DialogTrigger>
        <DialogOverlay ref={refs.overlay} />
        <DialogContent ref={refs.content} showCloseButton={false}>
          <DialogHeader ref={refs.header}>
            <DialogTitle ref={refs.title}>T</DialogTitle>
            <DialogDescription ref={refs.description}>D</DialogDescription>
          </DialogHeader>
          <DialogFooter ref={refs.footer}>
            <DialogClose ref={refs.close}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    for (const [name, ref] of Object.entries(refs)) {
      expect(ref.current, name).toBeInstanceOf(HTMLElement);
    }
    expect(refs.content.current?.getAttribute("data-slot")).toBe("dialog-content");
    expect(refs.title.current?.getAttribute("data-slot")).toBe("dialog-title");
    await view.unmount();
  });
});
