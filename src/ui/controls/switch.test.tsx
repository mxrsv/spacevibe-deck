// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { click, expectRefsToHoldElements, mount } from "./preset-test-kit";

const { Switch } = await loadPresetControls();

const control = (host: HTMLElement): HTMLElement =>
  host.querySelector('[role="switch"]') as HTMLElement;

describe("Switch", () => {
  it("toggles on click and reports each change", async () => {
    const onCheckedChange = vi.fn();
    const view = await mount(<Switch aria-label="Notify" onCheckedChange={onCheckedChange} />);
    expect(control(view.host).getAttribute("aria-checked")).toBe("false");

    await click(control(view.host));
    expect(control(view.host).getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange.mock.calls.map((call) => call[0])).toEqual([true]);

    await click(control(view.host));
    expect(control(view.host).getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange.mock.calls.map((call) => call[0])).toEqual([true, false]);
    await view.unmount();
  });

  it("follows a controlled `checked` and does not flip by itself", async () => {
    const view = await mount(<Switch aria-label="Notify" checked={false} />);
    await click(control(view.host));
    expect(control(view.host).getAttribute("aria-checked")).toBe("false");

    await view.update(<Switch aria-label="Notify" checked />);
    expect(control(view.host).getAttribute("aria-checked")).toBe("true");
    expect(control(view.host).hasAttribute("data-checked")).toBe(true);
    await view.unmount();
  });

  it("ignores input while disabled and carries the size as data", async () => {
    const onCheckedChange = vi.fn();
    const view = await mount(
      <Switch aria-label="Notify" size="sm" disabled onCheckedChange={onCheckedChange} />,
    );
    await click(control(view.host));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(control(view.host).getAttribute("data-size")).toBe("sm");
    await view.unmount();
  });

  it("forwards its ref and mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const ref = createRef<HTMLElement>();
      const view = await mount(<Switch aria-label="Notify" ref={ref} />);
      expectRefsToHoldElements({ switch: ref }, { switch: "switch" });
      await view.unmount();
    }
  });
});
