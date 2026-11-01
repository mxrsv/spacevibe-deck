// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { expectRefsToHoldElements, mount, press, waitUntil } from "./preset-test-kit";

const { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } = await loadPresetControls();

const content = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

/**
 * jsdom has no layout and no real hover, so what is checked here is the mount lifecycle and
 * the ref contract. Hover and keyboard focus on a real Chromium and in Electron are the
 * W0-Tip check (`docs/plans/2026-10-19-tailwind-strangler-migration.md`).
 */
describe("Tooltip", () => {
  it("follows a controlled `open`", async () => {
    const view = await mount(
      <TooltipProvider>
        <Tooltip open={false}>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Copy the path</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(content()).toBeNull();

    await view.update(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Copy the path</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(content()?.textContent).toBe("Copy the path");
    await view.unmount();
  });

  it("opens on keyboard focus and closes on Escape", async () => {
    const view = await mount(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Copy the path</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = view.host.querySelector("button") as HTMLElement;
    expect(content()).toBeNull();
    // Keyboard modality first, so focus counts as focus-visible as it does after a Tab.
    await press(document.body, { key: "Tab" });
    trigger.focus();
    await waitUntil(() => content() !== null);
    await press(trigger, { key: "Escape" });
    await waitUntil(() => content() === null);
    await view.unmount();
  });

  it("leaves no popup behind after an unmount, and mounts again", async () => {
    for (let round = 0; round < 2; round += 1) {
      const view = await mount(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Info</TooltipTrigger>
            <TooltipContent>Tip</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      expect(content()).not.toBeNull();
      await view.unmount();
      await waitUntil(() => content() === null);
    }
  });

  it("forwards refs to the trigger and the popup", async () => {
    const refs = { trigger: createRef<HTMLElement>(), content: createRef<HTMLElement>() };
    const view = await mount(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger ref={refs.trigger}>Info</TooltipTrigger>
          <TooltipContent ref={refs.content}>Tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expectRefsToHoldElements(refs, { trigger: "tooltip-trigger", content: "tooltip-content" });
    await view.unmount();
  });
});
