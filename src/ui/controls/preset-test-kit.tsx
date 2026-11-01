/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect } from "vitest";

/** A control mounted in the jsdom document, with the `act` plumbing every control test repeats. */
export interface Mounted {
  readonly host: HTMLElement;
  /** Renders again into the same host: a controlled update. */
  readonly update: (ui: ComponentChild) => Promise<void>;
  /** Unmounts and removes the host, as a closing surface does. */
  readonly unmount: () => Promise<void>;
}

/** Lets timers, microtasks and Preact's render queue settle (Base UI defers focus and mounts). */
export async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Hosts still mounted: a test that fails before its `unmount()` must not leak into the next one. */
const mounted = new Set<HTMLElement>();

afterEach(async () => {
  for (const host of mounted) {
    await act(async () => {
      render(null, host);
    });
    host.remove();
  }
  mounted.clear();
  document.body.replaceChildren();
});

export async function mount(ui: ComponentChild): Promise<Mounted> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mounted.add(host);
  await act(async () => {
    render(ui, host);
  });
  await settle();
  return {
    host,
    update: async (next) => {
      await act(async () => {
        render(next, host);
      });
      await settle();
    },
    unmount: async () => {
      await act(async () => {
        render(null, host);
      });
      host.remove();
      mounted.delete(host);
      await settle();
    },
  };
}

export async function press(target: Element, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...init }));
  });
  await settle();
}

export async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click();
  });
  await settle();
}

export const byRole = (role: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[role="${role}"]`);

/** G1: each ref a wrapper was given must hold the DOM element it names (migration plan). */
export function expectRefsToHoldElements(
  refs: Readonly<Record<string, { readonly current: Element | null }>>,
  slots: Readonly<Record<string, string>> = {},
): void {
  for (const [name, ref] of Object.entries(refs)) {
    expect(ref.current, `ref of ${name}`).toBeInstanceOf(HTMLElement);
    const slot = slots[name];
    if (slot !== undefined) expect(ref.current?.getAttribute("data-slot"), name).toBe(slot);
  }
}

/** Waits for `done` to hold: Base UI unmounts a closed popup after a timer, not synchronously. */
export async function waitUntil(done: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await settle(20);
  expect(done()).toBe(true);
}

/** The element by role, when it is on screen: a closed Select keeps its popup `hidden`. */
export const visibleByRole = (role: string): HTMLElement | null => {
  const found = byRole(role);
  return found !== null && found.closest("[hidden]") === null ? found : null;
};
