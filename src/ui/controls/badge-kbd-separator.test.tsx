// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { expectRefsToHoldElements, mount } from "./preset-test-kit";

const { Badge, badgeVariants, Kbd, KbdGroup, Separator } = await loadPresetControls();

describe("Badge", () => {
  it("is a span by default and takes another element through `render`", async () => {
    const view = await mount(
      <>
        <Badge>New</Badge>
        <Badge render={<a href="#changes" />}>Changes</Badge>
      </>,
    );
    const [plain, link] = [...view.host.querySelectorAll("[data-slot=badge]")];
    expect(plain.tagName).toBe("SPAN");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("#changes");
    expect(badgeVariants({ variant: "outline" })).toContain("border-border");
    await view.unmount();
  });

  it("forwards its ref and mounts again after an unmount", async () => {
    for (let round = 0; round < 2; round += 1) {
      const ref = createRef<HTMLElement>();
      const view = await mount(<Badge ref={ref}>New</Badge>);
      expectRefsToHoldElements({ badge: ref }, { badge: "badge" });
      await view.unmount();
    }
  });
});

describe("Kbd", () => {
  it("renders a chord and forwards refs", async () => {
    const refs = { kbd: createRef<HTMLElement>(), group: createRef<HTMLElement>() };
    const view = await mount(
      <KbdGroup ref={refs.group}>
        <Kbd ref={refs.kbd}>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    );
    expect(view.host.querySelectorAll("kbd[data-slot=kbd]").length).toBe(2);
    expectRefsToHoldElements(refs, { kbd: "kbd", group: "kbd-group" });
    await view.unmount();
  });
});

describe("Separator", () => {
  it("carries its orientation and forwards its ref", async () => {
    const ref = createRef<HTMLElement>();
    const view = await mount(<Separator orientation="vertical" ref={ref} />);
    expect(ref.current?.getAttribute("data-orientation")).toBe("vertical");
    expectRefsToHoldElements({ separator: ref }, { separator: "separator" });
    await view.unmount();
  });
});
