// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

import { PromptPopover } from "./prompt-popover";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { EMPTY_PROMPT_ASSETS } from "./prompt-assets-client";
import type { PromptTarget } from "./inject";
import { tabViews } from "../terminal/tabs-store";
import { persistError } from "../chrome/events";

const target: PromptTarget = { paneId: 1, agent: "claude", cwd: "/repo" };

const templates = [
  { id: "tpl:fix-bug", label: "fix bug", body: "Fix it.", autoSend: false },
  { id: "tpl:review", label: "review PR", body: "Review it.", autoSend: true },
];

describe("PromptPopover", () => {
  let host: HTMLDivElement;
  let inject: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS, promptTemplates: templates };
    persistError.value = null;
    inject = vi.fn(async () => "sent" as const);
    onClose = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    settings.value = DEFAULT_SETTINGS;
    persistError.value = null;
  });

  /**
   * `useSignalEffect` schedules its re-runs through `options.requestAnimationFrame`
   * (@preact/signals 2.9), so a signal write is NOT observable on the next
   * microtask — one real frame has to pass. Every helper that expects an
   * effect to have re-run waits here rather than in the individual test.
   */
  const frame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 32));

  const mount = async (
    overrides: Partial<Parameters<typeof PromptPopover>[0]> = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <PromptPopover
          capture={async () => target}
          loadAssets={async () => EMPTY_PROMPT_ASSETS}
          inject={inject}
          isAlive={() => true}
          onClose={onClose}
          {...overrides}
        />,
        host,
      );
    });
    // The capture effect only STARTS when act flushes effects above, so its
    // `await capture()` → `await loadAssets()` hops land after this act ends.
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) {
        await Promise.resolve();
      }
    });
  };

  const click = (element: Element): void => {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("renders one row per template with the auto tag on autoSend", async () => {
    await mount();
    const rows = host.querySelectorAll(".cfg-row--item");
    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("fix bug");
    expect(host.querySelectorAll(".prompt-row__auto")).toHaveLength(1);
  });

  it("injects the body and closes when the pill is clicked", async () => {
    await mount();
    click(host.querySelector('[aria-label="Paste fix bug"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });
    expect(inject).toHaveBeenCalledWith(target, "Fix it.", false);
    expect(onClose).toHaveBeenCalled();
  });

  it("waits for injection to finish before closing and restoring pane focus", async () => {
    let finishInject: ((outcome: "sent") => void) | null = null;
    const pendingInject = new Promise<"sent">((resolve) => {
      finishInject = resolve;
    });
    await mount({ inject: vi.fn(() => pendingInject) });

    click(host.querySelector('[aria-label="Send review PR"]') as Element);

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      finishInject?.("sent");
      await pendingInject;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows only one injection while a previous one is in flight", async () => {
    let finishInject: ((outcome: "sent") => void) | null = null;
    const pendingInject = new Promise<"sent">((resolve) => {
      finishInject = resolve;
    });
    const pendingInjectFn = vi.fn(() => pendingInject);
    await mount({ inject: pendingInjectFn });
    const button = host.querySelector('[aria-label="Send review PR"]') as Element;

    click(button);
    click(button);

    expect(pendingInjectFn).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finishInject?.("sent");
      await pendingInject;
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not restore pane focus from a stale continuation after unmount", async () => {
    let finishInject: ((outcome: "sent") => void) | null = null;
    const pendingInject = new Promise<"sent">((resolve) => {
      finishInject = resolve;
    });
    await mount({ inject: vi.fn(() => pendingInject) });
    click(host.querySelector('[aria-label="Send review PR"]') as Element);

    act(() => render(null, host));
    await act(async () => {
      finishInject?.("sent");
      await pendingInject;
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("names and draws paste and send as two different actions", async () => {
    await mount();

    const paste = host.querySelector('[aria-label="Paste fix bug"]') as HTMLButtonElement;
    const send = host.querySelector('[aria-label="Send review PR"]') as HTMLButtonElement;

    expect(paste.title).toBe("Paste into the focused pane");
    expect(send.title).toBe("Send to the focused pane");
    expect(paste.querySelector("svg")?.classList.contains("deck-icon--clipboard-text")).toBe(true);
    expect(send.querySelector("svg")?.classList.contains("deck-icon--paper-plane-tilt")).toBe(true);
    // Neither is named by its glyph: the icon is decoration, the label is the
    // action, and a Send that fails its gate still only pasted.
    expect(paste.textContent).toBe("");
    expect(send.textContent).toBe("");
  });

  it("still reports a gated send as pasted, not sent", async () => {
    const gated = vi.fn(async () => "pasted" as const);
    await mount({ inject: gated });

    click(host.querySelector('[aria-label="Send review PR"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });

    // The Send icon promises Enter; the safety gate is what decides. When it
    // refuses, the copy must keep saying so.
    expect(gated).toHaveBeenCalledWith(target, "Review it.", true);
    expect(persistError.value).toBe("Pasted — not sent");
  });

  it("passes each template's own autoSend flag to inject", async () => {
    await mount();

    click(host.querySelector('[aria-label="Paste fix bug"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(inject).toHaveBeenCalledWith(target, "Fix it.", false);
  });

  it("draws the row remove, draft add and picker as icons", async () => {
    await mount();

    click(host.querySelector(".cfg-row__label--edit") as Element);

    expect(host.querySelector('[aria-label="Remove fix bug"] svg')).not.toBeNull();
    expect(
      host
        .querySelector('[aria-label="Remove fix bug"] svg')
        ?.classList.contains("deck-icon--trash"),
    ).toBe(true);
    expect(host.querySelector(".prompt-picker .deck-icon--caret-down")).not.toBeNull();
  });

  it("reports an injection rejection and stays open for retry", async () => {
    await mount({
      inject: vi.fn(async () => {
        throw new Error("ipc failed");
      }),
    });

    click(host.querySelector('[aria-label="Send review PR"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(persistError.value).toBe("Couldn't paste into the terminal.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a failed paste and stays open for retry", async () => {
    await mount({ inject: vi.fn(async () => "failed" as const) });

    click(host.querySelector('[aria-label="Send review PR"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(persistError.value).toBe("Couldn't paste into the terminal.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports an overlapping pane injection and stays open for retry", async () => {
    await mount({ inject: vi.fn(async () => "busy" as const) });

    click(host.querySelector('[aria-label="Send review PR"]') as Element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(persistError.value).toBe("A prompt is already being pasted into this pane.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("expands exactly one editor at a time (DL-13.4)", async () => {
    await mount();
    const labels = host.querySelectorAll(".cfg-row__label--edit");
    click(labels[0]);
    expect(host.querySelectorAll(".prompt-editor")).toHaveLength(1);
    click(labels[1]);
    expect(host.querySelectorAll(".prompt-editor")).toHaveLength(1);
    expect(labels[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the pickers when the captured pane runs no known agent", async () => {
    await mount({ capture: async () => ({ ...target, agent: null }) });
    expect(host.querySelector(".prompt-picker")).toBeNull();
    // Templates still inject — paste-only.
    expect(host.querySelectorAll(".cfg-row--item")).toHaveLength(2);
  });

  it("shows one faint line, not an error state, when detection fails", async () => {
    await mount({
      loadAssets: async () => {
        throw new Error("ipc");
      },
    });
    expect(host.textContent).toContain("Skills unavailable");
    expect(host.querySelectorAll(".cfg-row--item")).toHaveLength(2);
  });

  it("closes without injecting when there is no target", async () => {
    await mount({ capture: async () => null });
    expect(onClose).toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it("closes when the captured pane leaves the layout", async () => {
    let alive = true;
    await mount({ isAlive: () => alive });
    expect(onClose).not.toHaveBeenCalled();
    alive = false;
    // tabViews is what syncViews bumps on close/exit.
    await act(async () => {
      tabViews.value = [];
      await frame();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses an empty body with an inline error", async () => {
    await mount();
    click(host.querySelector(".cfg-row__label--edit") as Element);
    const body = host.querySelector("textarea") as HTMLTextAreaElement;
    // Two acts, not one: `CommitTextarea.commit` compares the draft held in
    // its render closure, so the input has to be rendered before the blur or
    // commit sees the old value and short-circuits.
    act(() => {
      body.value = "   ";
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      // Both events, as a real browser fires them: the phosphor icons load
      // preact/compat, which rewrites `onBlur` to `onfocusout` on every DOM
      // vnode, so the commit rides the bubbling event when an icon mounts.
      body.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      body.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(host.querySelector(".cfg-custom--error")?.textContent).toContain("a body is required");
    expect(settings.value.promptTemplates[0].body).toBe("Fix it.");
  });
});
