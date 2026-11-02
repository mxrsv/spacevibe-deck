// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { mount } from "./preset-test-kit";
import { ringClasses, splitClass } from "./ring-classes";

const {
  Switch,
  Select,
  SelectTrigger,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  badgeVariants,
  toggleVariants,
} = await loadPresetControls();

/** The utility of the `<prefix>:bg-*` class on an element, with its variants kept in `prefix`. */
function fill(classes: string, prefix: string): string | undefined {
  return classes
    .split(/\s+/)
    .find((entry) => entry.startsWith(`${prefix}:bg-`) && splitClass(entry).variants === prefix);
}

describe("the ring detector", () => {
  it("matches a ring however the focus or invalid state is spelled", () => {
    for (const entry of [
      "focus-visible:ring-2",
      "focus:border-ring",
      "aria-invalid:ring-destructive/20",
      "dark:aria-invalid:ring-2",
      "group-has-[:focus-visible]/field-label:ring-2",
      "data-[focus]:ring-2",
      "focus-visible:outline-2",
    ]) {
      expect(ringClasses(`p-2 ${entry} text-sm`), entry).toEqual([entry]);
    }
  });

  it("lets the colour, a removal and a plain ring through", () => {
    const classes =
      "focus-visible:bg-muted aria-invalid:border-destructive focus-visible:outline-none focus-visible:ring-0 ring-0 [&_svg:not([class*='size-'])]:size-4";
    expect(ringClasses(classes)).toEqual([]);
  });
});

describe("controls other than inputs", () => {
  it("draw no focus ring, outline or focus border, and move colour only", async () => {
    const view = await mount(
      <div>
        <Switch aria-label="Notify" />
        <Select items={[{ value: "a", label: "A" }]}>
          <SelectTrigger aria-label="Pick" />
        </Select>
        <ScrollArea />
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
        </Tabs>
        <ToggleGroup aria-label="Pick" value={["a"]}>
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
        </ToggleGroup>
      </div>,
    );
    const slots = [
      "switch",
      "select-trigger",
      "scroll-area-viewport",
      "tabs-trigger",
      "toggle-group-item",
    ];
    for (const slot of slots) {
      const element = view.host.querySelector(`[data-slot="${slot}"]`);
      expect(element, slot).not.toBeNull();
      const classes = element?.className ?? "";
      expect(ringClasses(classes), slot).toEqual([]);
      expect(classes, slot).not.toContain("transition-all");
      expect(classes, slot).toContain("focus-visible:bg-");
    }
    const classes = [badgeVariants({ variant: "outline" }), toggleVariants({ variant: "outline" })];
    for (const entry of classes) {
      expect(ringClasses(entry)).toEqual([]);
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

describe("a selected segment", () => {
  it("shows keyboard focus as a fill other than its selected fill", async () => {
    const view = await mount(
      <ToggleGroup aria-label="Pick" value={["a"]}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const classes = (view.host.querySelector('[data-slot="toggle-group-item"]') as HTMLElement)
      .className;
    const focus = fill(classes, "focus-visible");
    const pressed = fill(classes, "aria-pressed");
    const pressedFocus = fill(classes, "aria-pressed:focus-visible");
    expect(focus, "idle focus").toBeDefined();
    expect(pressed, "selected").toBeDefined();
    expect(pressedFocus, "selected and focused").toBeDefined();
    expect(new Set([focus, pressed, pressedFocus]).size).toBe(3);
    await view.unmount();
  });

  it("does the same on a tab", async () => {
    const view = await mount(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const classes = (
      view.host.querySelector('[data-slot="tabs-trigger"]') as HTMLElement
    ).className.split(/\s+/);
    const selected = classes.filter((entry) => /(^|:)data-active:bg-/.test(entry));
    const focused = classes.filter((entry) => /data-active:focus-visible:bg-/.test(entry));
    expect(selected.length).toBeGreaterThan(0);
    expect(focused.length).toBeGreaterThan(0);
    const fills = (entries: string[]) => entries.map((entry) => splitClass(entry).utility);
    for (const utility of fills(focused)) {
      expect(fills(selected)).not.toContain(utility);
    }
    await view.unmount();
  });
});
