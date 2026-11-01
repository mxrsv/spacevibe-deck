// @vitest-environment jsdom
import { createRef } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { click, expectRefsToHoldElements, mount } from "./preset-test-kit";

const { Toggle, ToggleGroup, ToggleGroupItem } = await loadPresetControls();

const pressed = (host: HTMLElement): string[] =>
  [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed") ?? "");

function Period() {
  const [value, setValue] = useState<string[]>(["day"]);
  return (
    <ToggleGroup value={value} onValueChange={setValue} aria-label="Usage period">
      <ToggleGroupItem value="day">Day</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
    </ToggleGroup>
  );
}

describe("Toggle", () => {
  it("follows a controlled `pressed` and reports presses", async () => {
    const onPressedChange = vi.fn();
    const view = await mount(
      <Toggle pressed={false} onPressedChange={onPressedChange}>
        Bold
      </Toggle>,
    );
    await click(view.host.querySelector("button") as HTMLElement);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    expect(pressed(view.host)).toEqual(["false"]);

    await view.update(<Toggle pressed>Bold</Toggle>);
    expect(pressed(view.host)).toEqual(["true"]);
    await view.unmount();
  });

  it("forwards its ref and mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const ref = createRef<HTMLElement>();
      const view = await mount(<Toggle ref={ref}>Bold</Toggle>);
      expectRefsToHoldElements({ toggle: ref }, { toggle: "toggle" });
      await view.unmount();
    }
  });
});

describe("ToggleGroup", () => {
  it("moves the pressed state with the caller's value", async () => {
    const view = await mount(<Period />);
    expect(pressed(view.host)).toEqual(["true", "false"]);
    await click(view.host.querySelectorAll("button")[1] as HTMLElement);
    expect(pressed(view.host)).toEqual(["false", "true"]);
    await view.unmount();
  });

  it("shares variant and size with its items through context", async () => {
    const view = await mount(
      <ToggleGroup variant="outline" size="sm" aria-label="Mode">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const item = view.host.querySelector("button") as HTMLElement;
    expect(item.getAttribute("data-variant")).toBe("outline");
    expect(item.getAttribute("data-size")).toBe("sm");
    await view.unmount();
  });

  it("forwards refs to the group and its items", async () => {
    const refs = { group: createRef<HTMLElement>(), item: createRef<HTMLElement>() };
    const view = await mount(
      <ToggleGroup ref={refs.group} aria-label="Mode">
        <ToggleGroupItem ref={refs.item} value="a">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    expectRefsToHoldElements(refs, { group: "toggle-group", item: "toggle-group-item" });
    await view.unmount();
  });
});
