// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckToolbar, toolbarLabel } from "./deck-toolbar";

/**
 * The shipping projection: registry actions in, `ToolbarItem`s out, both
 * layouts mounting the same element. What matters here is the boundary work —
 * label re-casing (D6), the D7 group contents, unavailable-not-disabled for
 * Prompts, and the two presentation carriers (`iconbtn--gear`, the anchored
 * popover) surviving the move off `ChromeActions`.
 */
describe("DeckToolbar", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  // An open `More` menu is a document-level surface; leaving it mounted would
  // let the next test read this test's rows.
  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const handlers = () => ({
    onToggleBrowser: vi.fn(),
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onToggleExpand: vi.fn(),
    onClosePane: vi.fn(),
    onTogglePrompts: vi.fn(),
    onToggleSettings: vi.fn(),
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const on = handlers();
    act(() =>
      render(
        <DeckToolbar
          browserActive={false}
          // Defaults to the host every release still ships (no `sessions_list`),
          // which is also what keeps the D7 label list below exhaustive.
          settingsOpen={false}
          expandActive={false}
          promptsOpen={false}
          promptsUnavailable={null}
          {...on}
          {...overrides}
        />,
        host,
      ),
    );
    return on;
  }

  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === name,
    );
    if (found === undefined) {
      throw new Error(`no button named ${name}`);
    }
    return found;
  };

  it("re-cases registry labels to sentence case and drops menu ellipses", () => {
    expect(toolbarLabel("split-row")).toBe("Split vertically");
    expect(toolbarLabel("toggle-settings")).toBe("Settings");
    expect(toolbarLabel("toggle-prompts")).toBe("Prompts");
    expect(toolbarLabel("toggle-browser")).toBe("Browser");
    expect(toolbarLabel("toggle-usage")).toBe("Token usage");
    expect(toolbarLabel("toggle-explorer")).toBe("Explorer");
  });

  // Shrunk twice on 2026-08-16. First File explorer, Token usage and Session
  // history left the bar for the docked side panel, which carries its own tab
  // row. Then the pane group moved into `More` (DL-23.8), leaving the bar with
  // exactly one control. Browser, Prompts and Settings never rode here at all:
  // they became rows in the rail's footer (DL-28.3), and top-tab mode stands
  // the same rows up in `More`. Mounting them here too would put a second
  // Prompt Board popover on screen at the same time as the footer's.
  it("draws the More control and nothing else", () => {
    mount();
    const labels = Array.from(host.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["More actions"]);
  });

  it.each([false, true])(
    "shows one Mission Control entry in compact=%s, pressed while it is open",
    (compact) => {
      const onToggle = vi.fn();
      mount({ compact, missionControl: { open: false, onToggle } });
      const buttons = () =>
        Array.from(host.querySelectorAll<HTMLButtonElement>(".agent-view-switch button"));
      expect(buttons().map((button) => button.textContent)).toEqual(["Overview"]);
      expect(buttons()[0].getAttribute("aria-pressed")).toBe("false");
      act(() => buttons()[0].click());
      expect(onToggle).toHaveBeenCalledTimes(1);

      onToggle.mockClear();
      mount({ compact, missionControl: { open: true, onToggle } });
      expect(buttons()[0].getAttribute("aria-pressed")).toBe("true");
      // It fires WHILE pressed: the one button is the way out as well as in.
      act(() => buttons()[0].click());
      expect(onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it("omits the Mission Control entry entirely when none is handed in", () => {
    mount({ missionControl: undefined });
    expect(host.querySelector(".agent-view-switch")).toBeNull();
  });

  const menuLabels = (): (string | null | undefined)[] =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).map(
      (row) => row.querySelector(".toolbar-menu__label")?.textContent,
    );

  // DL-23.8 (amended 2026-10-07): with the rail's tools row on screen `More`
  // keeps the pane group only; the global group and the Prompt Board's anchor
  // moved to the rail.
  it("carries the pane group only while the rail's tools row is mounted", () => {
    mount({ railToolsMounted: true, promptsOpen: true, promptPopover: <div class="pp" /> });
    act(() => button("More actions").click());

    expect(menuLabels()).toEqual([
      "Split vertically",
      "Split horizontally",
      "Focus expand",
      "Close pane",
    ]);
    // One anchor at a time: the popover is the rail's, so `More` renders none.
    expect(document.querySelector(".pp")).toBeNull();
  });

  it.each([{ compact: true }, { railToolsMounted: false }])(
    "keeps all seven rows in More when nothing holds the global group (%o)",
    (overrides) => {
      mount(overrides);
      act(() => button("More actions").click());

      expect(menuLabels()).toHaveLength(7);
    },
  );

  it("never trusts the rail in compact mode, even when it is flagged mounted", () => {
    mount({ compact: true, railToolsMounted: true });
    act(() => button("More actions").click());

    expect(menuLabels()).toHaveLength(7);
  });

  it("carries the whole pane group as named rows inside More", () => {
    const on = mount();
    act(() => button("More actions").click());

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    );
    // The pane group leads, and the global group follows it wherever no rail
    // holds that group: top-tab mode, Tauri and a window with no live rail.
    expect(rows.map((row) => row.querySelector(".toolbar-menu__label")?.textContent)).toEqual([
      "Split vertically",
      "Split horizontally",
      "Focus expand",
      "Close pane",
      "Browser",
      "Prompts",
      "Settings",
    ]);

    // A row runs the same callback the icon used to, so the command path the
    // keyboard and the native menu take is untouched by the move.
    act(() => (rows[3] as HTMLButtonElement).click());
    expect(on.onClosePane).toHaveBeenCalledTimes(1);
  });

  it("renders no history control on a host without session history", () => {
    const labels = Array.from(host.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).not.toContain("Session history");
  });

  it("hands the window's free width back as a drag surface", () => {
    mount();
    expect(host.querySelector(".ftoolbar__drag")).not.toBeNull();
  });
  it("stands the global pair up in More when the layout is compact", () => {
    mount({ compact: true });
    const more = button("More actions");

    act(() => more.click());

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    ).map((row) => row.textContent);
    expect(rows?.some((row) => row?.includes("Browser"))).toBe(true);
    expect(rows?.some((row) => row?.includes("Prompts"))).toBe(true);
    expect(rows?.some((row) => row?.includes("Settings"))).toBe(true);
  });

  // The bar itself must never carry them, in either layout — that is what
  // keeps a second Prompt Board popover off the screen.
  it("never puts the rail's own rows on the bar", () => {
    for (const compact of [true, false]) {
      mount({ compact });
      const labels = Array.from(host.querySelectorAll(".ftoolbar > * button"))
        .map((b) => b.getAttribute("aria-label"))
        .filter((label) => label !== "More actions");
      expect(labels).not.toContain("Prompts");
      expect(labels).not.toContain("Settings");
      expect(labels).not.toContain("Browser");
    }
  });
  // DL-27.26 (amended 2026-10-06): the needs-you chip leads the strip's trailing
  // controls, so it sits next to the toolbar rather than inside the drag filler.
  it("seats the needs-you chip first among the trailing controls", () => {
    mount({
      attention: <button type="button" aria-label="2 need you" />,
      externalApp: <button type="button" aria-label="Open in editor" />,
    });

    const labels = Array.from(host.querySelectorAll(".ftoolbar button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["2 need you", "Open in editor", "More actions"]);
    expect(
      host.querySelector(".ftoolbar__drag")?.nextElementSibling?.getAttribute("aria-label"),
    ).toBe("2 need you");
  });

  it("draws no chip slot when nothing is handed in", () => {
    mount();

    expect(host.querySelector('[aria-label$="need you"]')).toBeNull();
  });
});
