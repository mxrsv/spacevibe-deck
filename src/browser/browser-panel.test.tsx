// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRules } from "../styles/css-weight-sites";
import { BrowserPanel } from "./browser-panel";
import type { BrowserClient } from "./browser-client";
import { BrowserSurface } from "./browser-surface";
import {
  browserNotice,
  browserState,
  browserSurfaceActive,
  resetBrowserStore,
  EMPTY_STATE,
} from "./browser-store";

// jsdom has no ResizeObserver, and the panel installs one to keep the host's
// native view aligned with this column.
class FakeResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

function fakeClient(overrides: Partial<BrowserClient> = {}): BrowserClient {
  return {
    open: vi.fn(async () => EMPTY_STATE),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async (url: string) => url),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    setBounds: vi.fn(async () => {}),
    setVisible: vi.fn(async () => {}),
    setInspect: vi.fn(async () => {}),
    onState: vi.fn(async () => () => {}),
    onGrab: vi.fn(async () => () => {}),
    onNavigated: vi.fn(async () => () => {}),
    ...overrides,
  };
}

describe("BrowserPanel", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetBrowserStore();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  function mount(client: BrowserClient, hidden = false) {
    act(() => {
      render(<BrowserPanel onClose={() => {}} hidden={hidden} client={client} />, host);
    });
  }

  it("reports the rectangle the native view must cover", () => {
    const client = fakeClient();
    mount(client);
    // The measured element is the empty placeholder, never the whole panel:
    // the address bar is Deck's chrome and the page must not paint over it.
    expect(client.setBounds).toHaveBeenCalledWith({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
    const view = host.querySelector(".browser-panel__view");
    expect(view?.childElementCount).toBe(0);
  });

  it("tells the host to hide while an overlay covers the stage", () => {
    const client = fakeClient();
    mount(client, true);
    expect(client.setVisible).toHaveBeenCalledWith(false);
  });

  it("navigates on submit and keeps the typed text when it is not an address", async () => {
    const client = fakeClient({ navigate: vi.fn(async () => null) });
    mount(client);
    const input = host.querySelector<HTMLInputElement>(".browser-panel__url")!;
    input.value = "not an address";
    act(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(client.navigate).toHaveBeenCalledWith("not an address");
    expect(browserNotice.value).toBe("That is not an address Deck can open.");
    expect(input.value).toBe("not an address");
  });

  it("shows the host's URL until the user edits the field", () => {
    const client = fakeClient();
    act(() => {
      browserState.value = { ...EMPTY_STATE, url: "http://localhost:3000/" };
    });
    mount(client);
    const input = host.querySelector<HTMLInputElement>(".browser-panel__url")!;
    expect(input.value).toBe("http://localhost:3000/");
  });

  it("disables back and forward until there is history", () => {
    const client = fakeClient();
    mount(client);
    const [back, forward] = [...host.querySelectorAll("button")];
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
  });

  it("toggles Inspect through the host and reflects its state", () => {
    const client = fakeClient();
    act(() => {
      browserState.value = { ...EMPTY_STATE, inspect: true };
    });
    mount(client);
    const inspect = host.querySelector<HTMLButtonElement>('button[aria-label="Inspect element"]')!;
    expect(inspect.getAttribute("aria-pressed")).toBe("true");
    act(() => inspect.click());
    // Pressed means armed, so pressing again disarms it.
    expect(client.setInspect).toHaveBeenCalledWith(false);
  });

  it("prefers a load error over the last grab notice", () => {
    const client = fakeClient();
    act(() => {
      browserNotice.value = "Element copied to the clipboard";
      browserState.value = { ...EMPTY_STATE, error: "Connection refused" };
    });
    mount(client);
    const note = host.querySelector(".browser-panel__note");
    expect(note?.textContent).toBe("Connection refused");
    expect(note?.className).toContain("browser-panel__note--error");
  });
});

/**
 * On Windows the OS paints its caption buttons over the top-right of the frame
 * row, and a native `WebContentsView` paints above every DOM layer, so a page
 * that reached that row would sit where the buttons are. It cannot, by
 * construction: the view's bounds are the rectangle of `.browser-panel__view`,
 * which lives inside `.stage__surface`, which starts below the strip. This
 * guards the construction. It proves DOM placement and the offset rules exist;
 * jsdom has no layout, so it does not measure the rectangle the host receives.
 */
describe("the native view stays below the frame row", () => {
  const stylesheet = parseRules(
    "06-stage-panes.css",
    readFileSync("src/styles/06-stage-panes.css", "utf8"),
  );
  const shell = parseRules("02-shell.css", readFileSync("src/styles/02-shell.css", "utf8"));
  const value = (rules: typeof stylesheet, selector: string, prop: string) =>
    rules
      .find((rule) => rule.selectors.includes(selector))
      ?.declarations.find((d) => d.prop === prop)?.value;

  it("measures a placeholder that follows the address bar, inside the stage surface", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    browserSurfaceActive.value = true;
    act(() => {
      render(<BrowserSurface hidden={false} onClose={() => {}} client={fakeClient()} />, host);
    });

    expect(host.querySelector(".stage__surface > .browser-panel")).not.toBeNull();
    expect(host.querySelector(".stage__strip")).toBeNull();
    const bar = host.querySelector(".browser-panel__bar")!;
    const view = host.querySelector(".browser-panel__view")!;
    expect(bar.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => render(null, host));
    host.remove();
    resetBrowserStore();
  });

  it("starts the surface below the strip in sidebar layout, with or without a notice", () => {
    expect(value(stylesheet, ".stage--strip .stage__surface", "top")).toBe("var(--frame-h)");
    expect(value(stylesheet, ".stage--strip.stage--notice .stage__surface", "top")).toBe(
      "calc(var(--frame-h) + var(--notice-h))",
    );
  });

  it("puts the stage under the tab bar in top-tab layout: only the sidebar shell spans row 1", () => {
    const placed = shell
      .filter((rule) => rule.selectors.some((selector) => /(^| )\.stage$/.test(selector)))
      .filter((rule) => rule.declarations.some((d) => d.prop === "grid-row"));
    expect(placed.map((rule) => rule.selectors)).toEqual([[".window--sidebar > .stage"]]);
  });

  it("gives neither the surface nor the panel a rule that lifts it into the frame row", () => {
    const rules = stylesheet.filter((rule) =>
      rule.selectors.some((s) => /\.stage__surface|\.browser-panel/.test(s)),
    );
    expect(rules.length).toBeGreaterThan(0);
    const lifting = rules.flatMap((rule) =>
      rule.declarations
        .filter(
          (d) =>
            (d.prop === "position" && d.value === "fixed") ||
            d.prop === "grid-row" ||
            (["top", "margin-top"].includes(d.prop) && /^(calc\()?-/.test(d.value)) ||
            (["transform", "translate"].includes(d.prop) && /translate(Y)?\(\s*-/.test(d.value)),
        )
        .map((d) => `${rule.selectors.join(", ")} { ${d.prop}: ${d.value} }`),
    );
    expect(lifting).toEqual([]);
  });
});
