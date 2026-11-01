// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { byRole, click, expectRefsToHoldElements, mount } from "./preset-test-kit";

const { Button, buttonVariants, Dialog, DialogTrigger, DialogContent, DialogTitle } =
  await loadPresetControls();

describe("Button", () => {
  it("runs its handler, and not while disabled", async () => {
    const onClick = vi.fn();
    const view = await mount(<Button onClick={onClick}>Save</Button>);
    const button = view.host.querySelector("button") as HTMLButtonElement;
    await click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    await view.update(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await click(view.host.querySelector("button") as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("takes variant and size from the preset's table, with defaults", async () => {
    const view = await mount(
      <>
        <Button>Plain</Button>
        <Button variant="destructive" size="icon-xs" aria-label="Remove" />
      </>,
    );
    const [plain, destructive] = [...view.host.querySelectorAll("button")];
    expect(plain.className).toContain("bg-primary");
    expect(plain.className).toContain("h-7");
    expect(destructive.className).toContain("text-destructive");
    expect(destructive.className).toContain("size-5");
    expect(destructive.className).not.toContain("bg-primary");
    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-muted");
    await view.unmount();
  });

  it("lets a caller's class override a variant utility instead of stacking beside it", async () => {
    const view = await mount(<Button className="h-9">Tall</Button>);
    const classes = (view.host.querySelector("button") as HTMLElement).className.split(" ");
    expect(classes).toContain("h-9");
    expect(classes).not.toContain("h-7");
    await view.unmount();
  });

  it("forwards its ref, and keeps working as a Base UI render target", async () => {
    const ref = createRef<HTMLElement>();
    const view = await mount(
      <Dialog open>
        <DialogTrigger render={<Button ref={ref} />}>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expectRefsToHoldElements({ button: ref });
    expect(ref.current?.tagName).toBe("BUTTON");
    expect(byRole("dialog")).not.toBeNull();
    await view.unmount();
  });

  it("mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Button>Again</Button>);
      expect(view.host.querySelector("button")?.textContent).toBe("Again");
      await view.unmount();
    }
  });
});
