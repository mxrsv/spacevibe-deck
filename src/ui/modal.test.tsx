// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

let host: HTMLDivElement;

function scrim(): HTMLDivElement {
  return host.querySelector(".modal-scrim") as HTMLDivElement;
}

function panel(): HTMLDivElement {
  return host.querySelector(".demo-modal") as HTMLDivElement;
}

/** jsdom has no PointerEvent, and the component only reads `target`. */
function press(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

function click(target: EventTarget): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function key(target: EventTarget, name: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  });
}

function mount(
  overrides: {
    dismissOnScrim?: boolean;
    initialFocus?: string;
    onKeyDown?: (event: KeyboardEvent) => void;
  } = {},
): { onDismiss: ReturnType<typeof vi.fn> } {
  const onDismiss = vi.fn();
  act(() => {
    render(
      <Modal
        panelClass="demo-modal"
        label="Demo"
        onDismiss={onDismiss}
        dismissOnScrim={overrides.dismissOnScrim}
        initialFocus={overrides.initialFocus}
        onKeyDown={overrides.onKeyDown}
      >
        <input class="demo-modal__field" />
        <button type="button" class="demo-modal__action">
          Act
        </button>
      </Modal>,
      host,
    );
  });
  return { onDismiss };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe("Modal", () => {
  it("wraps its panel in the scrim and labels it as a dialog", () => {
    mount();

    expect(scrim().firstElementChild).toBe(panel());
    expect(panel().getAttribute("role")).toBe("dialog");
    expect(panel().getAttribute("aria-modal")).toBe("true");
    expect(panel().getAttribute("aria-label")).toBe("Demo");
  });

  it("focuses the panel on mount so its keys work immediately", () => {
    mount();

    expect(document.activeElement).toBe(panel());
  });

  it("focuses initialFocus instead when one is given", () => {
    mount({ initialFocus: "input" });

    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("a press and release on the scrim dismisses", () => {
    const { onDismiss } = mount();

    press(scrim());
    click(scrim());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // The reason dismissal tracks pointerdown rather than click alone: a drag
  // that starts inside the panel (a divider, a text selection) and ends
  // outside it fires `click` on the common ancestor, which IS the scrim.
  it("a press inside the panel released on the scrim does NOT dismiss", () => {
    const { onDismiss } = mount();

    press(panel());
    click(scrim());

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("clicking inside the panel does not dismiss", () => {
    const { onDismiss } = mount();

    press(panel());
    click(host.querySelector(".demo-modal__action") as HTMLButtonElement);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("a second scrim press after an ignored drag still dismisses", () => {
    const { onDismiss } = mount();

    press(panel());
    click(scrim());
    press(scrim());
    click(scrim());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismissOnScrim=false keeps the scrim inert", () => {
    const { onDismiss } = mount({ dismissOnScrim: false });

    press(scrim());
    click(scrim());

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Escape dismisses even when the scrim is inert", () => {
    const { onDismiss } = mount({ dismissOnScrim: false });

    key(panel(), "Escape");

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Escape is not passed on to the host's key handling", () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    mount();

    key(panel(), "Escape");

    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("keys other than Escape reach the panel's own handler", () => {
    const onKeyDown = vi.fn();
    mount({ onKeyDown });

    key(panel(), "2");

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].key).toBe("2");
  });

  it("does not swallow Escape raised inside a field of its own panel", () => {
    const { onDismiss } = mount({ initialFocus: "input" });

    key(host.querySelector("input") as HTMLInputElement, "Escape");

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
