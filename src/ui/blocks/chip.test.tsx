// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "../controls/load-preset-controls";
import { click, mount } from "../controls/preset-test-kit";

const { Chip } = await loadPresetControls();

describe("Chip", () => {
  it("is a button that runs its handler, and not while disabled", async () => {
    const onClick = vi.fn();
    const view = await mount(<Chip onClick={onClick}>Show</Chip>);
    const chip = view.host.querySelector("button") as HTMLButtonElement;
    await click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    await view.update(
      <Chip onClick={onClick} disabled>
        Show
      </Chip>,
    );
    await click(view.host.querySelector("button") as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("is 24 high by default and 20 on request, quiet or filled", async () => {
    const view = await mount(
      <>
        <Chip>Filled</Chip>
        <Chip size={20} quiet>
          Quiet
        </Chip>
      </>,
    );
    const [filled, quiet] = [...view.host.querySelectorAll("button")];
    // RCP-4: the heights are the chip tokens; a filled chip rests on the 3% wash.
    expect(filled.className).toContain("h-(--chip-h-24)");
    expect(filled.className).toContain("bg-(--tab-rest-bg)");
    expect(quiet.className).toContain("h-(--chip-h-20)");
    expect(quiet.className).toContain("bg-transparent");
    expect(quiet.className).not.toContain("bg-(--tab-rest-bg)");
    await view.unmount();
  });

  it("forwards its ref and lets a caller's class win", async () => {
    const ref = createRef<HTMLElement>();
    const view = await mount(
      <Chip ref={ref} className="h-7">
        Tall
      </Chip>,
    );
    expect(ref.current?.tagName).toBe("BUTTON");
    const classes = (view.host.querySelector("button") as HTMLElement).className.split(" ");
    expect(classes).toContain("h-7");
    expect(classes).not.toContain("h-(--chip-h-24)");
    await view.unmount();
  });
});
