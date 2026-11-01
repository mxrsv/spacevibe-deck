// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";

const controls = await loadPresetControls();

/**
 * Components whose root renders no DOM of its own (a provider, a context root or a portal),
 * so there is no element for a ref to name. Everything else the barrel exports must be
 * `withRef`-wrapped (migration plan gate G1); a new control lands here or in the wrapped set.
 */
const ROOTLESS = new Set([
  "Dialog",
  "DialogPortal",
  "DropdownMenu",
  "DropdownMenuPortal",
  "DropdownMenuSub",
  "Popover",
  "Select",
  "Sheet",
  "Tooltip",
  "TooltipProvider",
]);

const FORWARD_REF = Symbol.for("react.forward_ref");

const components = Object.entries(controls).filter(([name]) => /^[A-Z]/.test(name));

describe("ref forwarding across the shared controls (G1)", () => {
  it("covers every component the barrel exports", () => {
    expect(components.length).toBeGreaterThan(60);
  });

  it.each(components.filter(([name]) => !ROOTLESS.has(name)))(
    "%s forwards its ref",
    (_name, component) => {
      expect((component as { $$typeof?: symbol }).$$typeof).toBe(FORWARD_REF);
    },
  );

  it.each([...ROOTLESS])("%s is rootless by design and not wrapped", (name) => {
    expect(components.map(([exported]) => exported)).toContain(name);
    const component = controls[name as keyof typeof controls] as { $$typeof?: symbol };
    expect(component.$$typeof).not.toBe(FORWARD_REF);
  });
});
