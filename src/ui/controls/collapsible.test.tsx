// @vitest-environment jsdom
import { createRef } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { click, expectRefsToHoldElements, mount, waitUntil } from "./preset-test-kit";

const ui = await loadPresetControls();
const { Collapsible, CollapsibleTrigger, CollapsibleContent } = ui;

const trigger = (): HTMLElement =>
  document.body.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement;

/** The panel as the user sees it: present in the document and not `hidden`. */
const panelShown = (): boolean => {
  const panel = document.body.querySelector('[data-slot="collapsible-content"]');
  return panel !== null && panel.closest("[hidden]") === null;
};

function Sample(props: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  return (
    <Collapsible {...props}>
      <CollapsibleTrigger>Branches</CollapsibleTrigger>
      <CollapsibleContent>main, dev</CollapsibleContent>
    </Collapsible>
  );
}

describe("Collapsible", () => {
  it("starts folded, unfolds from its trigger and folds again", async () => {
    const changes: boolean[] = [];
    const view = await mount(<Sample onOpenChange={(open) => changes.push(open)} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panelShown()).toBe(false);

    await click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panelShown()).toBe(true);
    expect(document.body.querySelector('[data-slot="collapsible-content"]')?.textContent).toBe(
      "main, dev",
    );

    await click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await waitUntil(() => !panelShown());
    expect(changes).toEqual([true, false]);
    await view.unmount();
  });

  it("keeps focus on the trigger while it unfolds and folds", async () => {
    const view = await mount(<Sample />);
    trigger().focus();
    await click(trigger());
    expect(panelShown()).toBe(true);
    expect(document.activeElement).toBe(trigger());
    await click(trigger());
    await waitUntil(() => !panelShown());
    expect(document.activeElement).toBe(trigger());
    await view.unmount();
  });

  it("starts unfolded with `defaultOpen`", async () => {
    const view = await mount(<Sample defaultOpen />);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panelShown()).toBe(true);
    await view.unmount();
  });

  it("follows a controlled `open` and reports a request without changing it", async () => {
    const requests: boolean[] = [];
    const view = await mount(<Sample open={false} onOpenChange={(open) => requests.push(open)} />);
    expect(panelShown()).toBe(false);

    await click(trigger());
    expect(requests).toEqual([true]);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panelShown()).toBe(false);

    await view.update(<Sample open onOpenChange={(open) => requests.push(open)} />);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panelShown()).toBe(true);

    await view.update(<Sample open={false} />);
    await waitUntil(() => !panelShown());
    await view.unmount();
  });

  it("works as a controlled section driven by state", async () => {
    function Stateful() {
      const [open, setOpen] = useState(false);
      return (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger>Changes</CollapsibleTrigger>
          <CollapsibleContent>3 files</CollapsibleContent>
        </Collapsible>
      );
    }
    const view = await mount(<Stateful />);
    await click(trigger());
    expect(panelShown()).toBe(true);
    await click(trigger());
    await waitUntil(() => !panelShown());
    await view.unmount();
  });

  it("does not open when disabled", async () => {
    const view = await mount(
      <Collapsible disabled>
        <CollapsibleTrigger>Branches</CollapsibleTrigger>
        <CollapsibleContent>main</CollapsibleContent>
      </Collapsible>,
    );
    await click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(panelShown()).toBe(false);
    await view.unmount();
  });

  it("leaves nothing behind after an unmount, and mounts again", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(<Sample />);
      await click(trigger());
      expect(panelShown()).toBe(true);
      await view.unmount();
      expect(document.body.querySelector('[data-slot^="collapsible"]')).toBeNull();
    }
  });

  it("forwards refs to the DOM elements of its parts", async () => {
    const refs = {
      root: createRef<HTMLElement>(),
      trigger: createRef<HTMLElement>(),
      content: createRef<HTMLElement>(),
    };
    const view = await mount(
      <Collapsible ref={refs.root} defaultOpen>
        <CollapsibleTrigger ref={refs.trigger}>Branches</CollapsibleTrigger>
        <CollapsibleContent ref={refs.content}>main</CollapsibleContent>
      </Collapsible>,
    );
    expectRefsToHoldElements(refs, {
      root: "collapsible",
      trigger: "collapsible-trigger",
      content: "collapsible-content",
    });
    await view.unmount();
  });
});
