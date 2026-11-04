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

  it("takes variant and size from its table, with defaults, on the recipe tokens", async () => {
    const view = await mount(
      <>
        <Button>Plain</Button>
        <Button variant="destructive" size="icon-xs" aria-label="Remove" />
      </>,
    );
    const [plain, destructive] = [...view.host.querySelectorAll("button")];
    expect(plain.className).toContain("bg-primary");
    expect(plain.className).toContain("h-8");
    expect(destructive.className).toContain("text-(--ink-fail)");
    expect(destructive.className).toContain("size-5");
    expect(destructive.className).not.toContain("bg-primary");
    // RCP-9: hover is the one hover wash; text is 600, never 500 (RCP-5).
    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-(--state-hover-bg)");
    expect(buttonVariants({})).toContain("font-semibold");
    await view.unmount();
  });

  it("measures 28, 32, 36 and 40 high, with the 6px radius only on the two large sizes", async () => {
    const heights = { sm: "h-7", default: "h-8", lg: "h-9", xl: "h-10" } as const;
    for (const [size, height] of Object.entries(heights)) {
      const classes = buttonVariants({ size: size as keyof typeof heights }).split(" ");
      expect(classes, size).toContain(height);
      expect(classes.includes("rounded-button-lg"), size).toBe(size === "lg" || size === "xl");
      expect(classes, size).not.toContain("text-xs");
    }
    expect(buttonVariants({ size: "xs" as never })).not.toContain("h-6");
  });

  it("draws no focus ring or border on any variant, and shows focus as hover does", () => {
    for (const variant of ["default", "outline", "secondary", "ghost", "destructive"] as const) {
      const classes = buttonVariants({ variant });
      expect(classes, variant).not.toMatch(/focus-visible:(ring|border-ring|border-destructive)/);
      expect(classes, variant).toContain("focus-visible:bg-");
    }
    expect(buttonVariants({})).not.toContain("transition-all");
  });

  it("gives the 20px icon box a 24px hit area without taking layout", () => {
    const classes = buttonVariants({ size: "icon-xs" }).split(" ");
    expect(classes).toContain("size-5");
    expect(classes).toContain("relative");
    expect(classes).toContain("after:-inset-0.5");
  });

  it("lets a caller's class override a variant utility instead of stacking beside it", async () => {
    const view = await mount(<Button className="h-9">Tall</Button>);
    const classes = (view.host.querySelector("button") as HTMLElement).className.split(" ");
    expect(classes).toContain("h-9");
    expect(classes).not.toContain("h-8");
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
