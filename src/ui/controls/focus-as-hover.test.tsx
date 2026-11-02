// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { mount } from "./preset-test-kit";

const { Switch, Select, SelectTrigger, ScrollArea, badgeVariants, toggleVariants } =
  await loadPresetControls();

/** CMP-11, CMP-13: only an input has a ring; any other control paints focus as it paints hover. */
const NO_RING = /(?:^|\s)(?:focus-visible|focus|aria-invalid):(?:ring|border-ring|outline)/;

describe("controls other than inputs", () => {
  it("draw no focus ring, outline or focus border, and move colour only", async () => {
    const view = await mount(
      <div>
        <Switch aria-label="Notify" />
        <Select items={[{ value: "a", label: "A" }]}>
          <SelectTrigger aria-label="Pick" />
        </Select>
        <ScrollArea />
      </div>,
    );
    const slots = ["switch", "select-trigger", "scroll-area-viewport"];
    for (const slot of slots) {
      const element = view.host.querySelector(`[data-slot="${slot}"]`);
      const classes = element?.className ?? "";
      expect(classes, slot).not.toMatch(NO_RING);
      expect(classes, slot).not.toContain("transition-all");
      expect(classes, slot).toContain("focus-visible:bg-");
    }
    const classes = [badgeVariants({ variant: "outline" }), toggleVariants({ variant: "outline" })];
    for (const entry of classes) {
      expect(entry).not.toMatch(NO_RING);
      expect(entry).not.toContain("transition-all");
    }
    await view.unmount();
  });

  it("keep the switch reachable by Tab", async () => {
    const view = await mount(<Switch aria-label="Notify" />);
    const control = view.host.querySelector('[role="switch"]') as HTMLElement;
    expect(control.tabIndex).toBeGreaterThanOrEqual(0);
    await view.unmount();
  });
});
