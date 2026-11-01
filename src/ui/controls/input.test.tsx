// @vitest-environment jsdom
import { createRef } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { click, expectRefsToHoldElements, mount } from "./preset-test-kit";

const { Input, Popover, PopoverTrigger, PopoverContent } = await loadPresetControls();

const field = (host: HTMLElement): HTMLInputElement =>
  host.querySelector("input") as HTMLInputElement;

describe("Input", () => {
  it("follows a controlled value and reports typing", async () => {
    const onValueChange = vi.fn();
    const view = await mount(
      <Input aria-label="Name" value="Menlo" onValueChange={onValueChange} />,
    );
    expect(field(view.host).value).toBe("Menlo");

    await act(async () => {
      field(view.host).value = "Menlo Nerd";
      field(view.host).dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onValueChange.mock.calls.map((call) => call[0])).toEqual(["Menlo Nerd"]);

    await view.update(<Input aria-label="Name" value="Iosevka" onValueChange={onValueChange} />);
    expect(field(view.host).value).toBe("Iosevka");
    await view.unmount();
  });

  it("passes disabled, type and invalid state to the element", async () => {
    const view = await mount(<Input aria-label="Port" type="number" disabled aria-invalid />);
    expect(field(view.host).type).toBe("number");
    expect(field(view.host).disabled).toBe(true);
    expect(field(view.host).getAttribute("aria-invalid")).toBe("true");
    await view.unmount();
  });

  it("forwards its ref and mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const ref = createRef<HTMLElement>();
      const view = await mount(<Input aria-label="Name" ref={ref} />);
      expectRefsToHoldElements({ input: ref }, { input: "input" });
      expect(ref.current).toBe(field(view.host));
      await view.unmount();
    }
  });

  it("is a render target Base UI can anchor a popup to (G1)", async () => {
    // Without the forwarded ref the positioner has no anchor: it stays `position: fixed` at
    // `opacity: 0` and the popup is invisible. With it, the anchor's size is measured.
    const userRef = createRef<HTMLElement>();
    const view = await mount(
      <Popover>
        <PopoverTrigger render={<Input aria-label="Branch" ref={userRef} />} nativeButton={false} />
        <PopoverContent>Branches</PopoverContent>
      </Popover>,
    );
    await click(field(view.host));
    const positioner = document.body.querySelector('[data-slot="popover-content"]')
      ?.parentElement as HTMLElement;
    expect(positioner.style.getPropertyValue("--anchor-width")).not.toBe("");
    expect(positioner.style.opacity).not.toBe("0");
    expect(userRef.current).toBe(field(view.host));
    await view.unmount();
  });
});
