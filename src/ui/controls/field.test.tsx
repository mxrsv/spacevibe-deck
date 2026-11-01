// @vitest-environment jsdom
import { createRef } from "preact";
import { describe, expect, it } from "vitest";
import { loadPresetControls } from "./load-preset-controls";
import { expectRefsToHoldElements, mount } from "./preset-test-kit";

const ui = await loadPresetControls();
const { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend } =
  ui;
const { FieldSeparator, FieldSet, FieldTitle, Input, Label, Switch } = ui;

describe("Field and Label", () => {
  it("names a control through its label", async () => {
    const view = await mount(
      <Field>
        <FieldLabel htmlFor="shell">Shell</FieldLabel>
        <Input id="shell" />
      </Field>,
    );
    const input = view.host.querySelector("input") as HTMLInputElement;
    expect(input.labels?.[0]?.textContent).toBe("Shell");
    expect(input.labels?.[0]?.getAttribute("data-slot")).toBe("field-label");
    await view.unmount();
  });

  it("lays a switch out on its own row and keeps the invalid state as data", async () => {
    const view = await mount(
      <Field orientation="horizontal" data-invalid>
        <FieldContent>
          <FieldLabel htmlFor="notify">Notify</FieldLabel>
          <FieldDescription>Tell me when an agent finishes.</FieldDescription>
        </FieldContent>
        <Switch id="notify" />
      </Field>,
    );
    const field = view.host.querySelector('[data-slot="field"]') as HTMLElement;
    expect(field.getAttribute("data-orientation")).toBe("horizontal");
    expect(field.hasAttribute("data-invalid")).toBe(true);
    await view.unmount();
  });

  it("renders FieldError as an alert only when it has something to say", async () => {
    const view = await mount(<FieldError>Port must be a number</FieldError>);
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe("Port must be a number");
    await view.update(<FieldError />);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    await view.unmount();
  });

  it("forwards refs to every part with a DOM root", async () => {
    const names = [
      "set",
      "legend",
      "group",
      "field",
      "content",
      "label",
      "title",
      "description",
      "separator",
      "error",
      "bareLabel",
    ] as const;
    const refs = Object.fromEntries(
      names.map((name) => [name, createRef<HTMLElement>()]),
    ) as Record<(typeof names)[number], ReturnType<typeof createRef<HTMLElement>>>;
    const view = await mount(
      <FieldSet ref={refs.set}>
        <FieldLegend ref={refs.legend}>Terminal</FieldLegend>
        <FieldGroup ref={refs.group}>
          <Field ref={refs.field}>
            <FieldContent ref={refs.content}>
              <FieldLabel ref={refs.label}>Font</FieldLabel>
              <FieldTitle ref={refs.title}>Title</FieldTitle>
              <FieldDescription ref={refs.description}>Description</FieldDescription>
            </FieldContent>
          </Field>
          <FieldSeparator ref={refs.separator} />
          <FieldError ref={refs.error}>Wrong</FieldError>
          <Label ref={refs.bareLabel}>Bare</Label>
        </FieldGroup>
      </FieldSet>,
    );
    expectRefsToHoldElements(refs, {
      set: "field-set",
      legend: "field-legend",
      group: "field-group",
      field: "field",
      content: "field-content",
      label: "field-label",
      title: "field-label",
      description: "field-description",
      separator: "field-separator",
      error: "field-error",
      bareLabel: "label",
    });
    await view.unmount();
  });
});
