// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The screen pulls in Tauri-backed stores through its sections; stub them so
// the component tree mounts under jsdom.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      loadState: { state: "ready", fresh: false },
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { SettingsScreen } from "./settings-screen";
import { activeCategory } from "./active-category-store";
import { SETTINGS_CATEGORIES } from "./settings-categories";
import { settingsLoadState } from "../../settings/settings-store";

describe("SettingsScreen — Escape / focus (M2)", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeCategory.value = "appearance";
    settingsLoadState.value = { status: "ready" };
  });

  // Unmount so the screen's window keydown listener is removed between tests —
  // a leaked listener from a prior instance would fire on the next dispatch.
  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (open: boolean, onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<SettingsScreen open={open} onClose={onClose} />, host);
    });
    return onClose;
  };

  it("moves focus onto the Back button when it opens", () => {
    mount(true);
    expect(document.activeElement).toBe(host.querySelector(".settings-screen__back"));
  });

  it("Escape closes the screen when focus is not in a terminal", () => {
    const onClose = mount(true);
    act(() => {
      (document.activeElement ?? window).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close the screen when a terminal owns focus (vim/fzf)", () => {
    const onClose = mount(true);

    // Simulate a focused xterm sitting behind the surface.
    const term = document.createElement("div");
    term.className = "xterm";
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once closed", () => {
    const onClose = mount(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a settings load failure visible with a retry action", () => {
    settingsLoadState.value = {
      status: "error",
      message: "Couldn't load settings. Defaults are temporary and won't overwrite settings.json.",
    };
    mount(true);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load settings.");
    expect(alert?.querySelector("button")?.textContent).toMatch(/retry/i);
  });
});

/**
 * The interaction foundation the redesign rests on (plan Task 2A). All three
 * failures below are invisible to a screenshot and to a typecheck: the screen
 * looks identical whether or not Tab escapes it, whether or not Escape eats a
 * draft, and whether or not the arriving snapshot reverts an edit.
 */
describe("SettingsScreen — the interaction foundation", () => {
  let host: HTMLDivElement;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeCategory.value = "appearance";
    settingsLoadState.value = { status: "ready" };
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<SettingsScreen open onClose={onClose} />, host);
    });
    return onClose;
  };

  // Deliberately NOT the component's own helper: a trap verified against the
  // list it built itself agrees with any bug in that list. This is the
  // browser's rule spelled out independently — `tabIndex >= 0` included,
  // which the selector alone gets wrong for a roving `tabindex="-1"` button.
  const tabbables = (): HTMLElement[] => {
    const screen = host.querySelector<HTMLElement>(".settings-screen");
    return [...(screen?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (element) => element.tabIndex >= 0 && element.closest("fieldset[disabled]") === null,
    );
  };

  const pressTab = (from: EventTarget, shiftKey = false): void => {
    act(() => {
      from.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
    });
  };

  it("wraps Tab at the end of the screen instead of leaking into the app", () => {
    mount();
    const items = tabbables();
    const last = items[items.length - 1];
    last.focus();

    pressTab(last);

    expect(document.activeElement).toBe(items[0]);
  });

  it("wraps Shift+Tab backwards at the first control", () => {
    mount();
    const items = tabbables();
    items[0].focus();

    pressTab(items[0], true);

    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  /**
   * The trap's own list must match the browser's. A roving `tabindex="-1"`
   * button — every unselected rail tab, and the unselected appearance
   * segment — still matches `button:not([disabled])`, so treating one as the
   * last item would leave the REAL last tab stop unguarded and Tab would
   * leave the screen from it.
   */
  it("does not count a roving tabindex=-1 control as a tab stop", () => {
    mount();

    const roving = [
      ...host.querySelectorAll<HTMLElement>(
        '[role="tab"][tabindex="-1"], [role="radio"][tabindex="-1"]',
      ),
    ];
    expect(roving.length).toBeGreaterThan(0);

    const items = tabbables();
    for (const element of roving) {
      expect(items).not.toContain(element);
    }

    // …and the guard actually fires from the real last stop.
    const last = items[items.length - 1];
    last.focus();
    pressTab(last);
    expect(document.activeElement).toBe(items[0]);
  });

  it("pulls focus back in when a pane behind the screen still holds it", () => {
    mount();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    pressTab(outside);

    expect(document.activeElement).toBe(tabbables()[0]);
  });

  it("lets Escape revert an active draft before it can close the screen", () => {
    const onClose = mount();
    act(() => {
      host.querySelector<HTMLButtonElement>('[role="tab"]#settings-tab-browser')?.click();
    });
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Browser home address"]');
    expect(field).not.toBeNull();
    const saved = field?.value ?? "";
    act(() => {
      field!.value = "http://localhost:9999";
      field!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      field!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(field!.value).toBe(saved);

    // The draft is clean now, so the next Escape means what it always means.
    act(() => {
      field!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * jsdom applies no stylesheet, so the compact layout cannot be measured
   * here — what CAN be asserted is that the rule exists and says what
   * DL-11.7 promises. The half a rendered screenshot cannot prove is the
   * accessible name, and that is asserted against the DOM directly below.
   */
  it("keeps the compact rail readable at the 480px application minimum", () => {
    // Repo-relative from the runner's cwd, not `import.meta.url`: under the
    // jsdom environment that resolves to an `http:` URL Node cannot open.
    const css = readFileSync(resolve(process.cwd(), "src/styles/11-settings-screen.css"), "utf8");
    const compact = css.slice(css.indexOf("@media (max-width: 720px)"));

    expect(compact).not.toBe("");
    // A 132px rail beside the document — narrower, still text. It was a 54px
    // ICON rail for a few hours on 2026-08-19 until the owner took the
    // category icons off (DL-11.3 retired), which left an icon rail with no
    // icons to show. The label truncates now instead of disappearing.
    expect(compact).toMatch(/\.settings-screen__grid\s*\{[^}]*grid-template-columns:\s*132px/);
    expect(compact).toMatch(/\.settings-nav__label\s*\{[^}]*text-overflow:\s*ellipsis/);
    // Truncating is the point — hiding the label would leave a blank rail.
    expect(compact).not.toMatch(/\.settings-nav__label\s*\{[^}]*display:\s*none/);
    // The document gives up its centring gutters rather than its content.
    expect(compact).toMatch(/\.settings-screen__doc\s*\{[^}]*width:\s*auto/);
    expect(compact).not.toMatch(/\.settings-nav\s*\{[^}]*display:\s*none/);
  });

  /**
   * The rail is text now (2026-08-19, owner: DL-11.3 retired). Two things
   * follow, and both are easy to get wrong in the same edit:
   * the label text IS the accessible name, so no `aria-label` may shadow it
   * with a second string to keep in sync; and `title` stays, because at
   * compact width the label truncates and the tooltip is what still says the
   * whole name.
   */
  it("names every rail tab by its own text, with the full name in the tooltip", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.length).toBe(SETTINGS_CATEGORIES.length);
    for (const [index, tab] of tabs.entries()) {
      const label = SETTINGS_CATEGORIES[index].label;
      expect(tab.textContent?.trim()).toBe(label);
      expect(tab.getAttribute("title")).toBe(label);
      expect(tab.getAttribute("aria-label")).toBeNull();
      // No icon left in the row — the whole point of the change.
      expect(tab.querySelector("svg")).toBeNull();
    }
  });

  it("holds the section inert until the settings snapshot has landed", () => {
    settingsLoadState.value = { status: "loading" };
    mount();

    const fields = host.querySelector<HTMLFieldSetElement>(".settings-screen__fields");
    expect(fields?.disabled).toBe(true);

    act(() => {
      settingsLoadState.value = { status: "ready" };
    });
    expect(host.querySelector<HTMLFieldSetElement>(".settings-screen__fields")?.disabled).toBe(
      false,
    );
  });
});

/**
 * The guarantee the whole relocation rests on: moving rows from one scrolling
 * drawer into five separate panels must not quietly lose one. Eyeballing a
 * screenshot cannot prove this — a row can only be seen once its category is
 * selected, so the check has to walk every category.
 *
 * The expected list is written out by hand, not derived from the registry:
 * a list generated from the same source it verifies would agree with itself
 * even after a row is dropped.
 */
const EXPECTED_ROWS = [
  // appearance. The theme is one row again since 2026-08-19 — a Light/Dark
  // segmented pair. The gallery grid (DL-24), the two rows it brought with it
  // ("Import theme", "Themes folder") and the four colour override rows
  // ("Background", "Foreground", "Cursor", "Selection") are UNMOUNTED, not
  // deleted: `theme-gallery.test.tsx` and `color-overrides.tsx` still stand,
  // and their absence from this walk is the assertion that Settings no longer
  // reaches them.
  "Appearance",
  "Font",
  "Font size",
  "App logo",
  "Tab bar position",
  "Show pane bar",
  "Show status bar",
  "Sidebar banner",
  // browser
  "Home address",
  // terminal
  "Scrollback",
  // agents. The built-in agents themselves are deliberately absent: since
  // 2026-08-19 each one is a row printing a COMMAND, not a `.cfg-row__label`,
  // so the walk below cannot see them — and pinning them here would restate
  // `BUILTIN_AGENTS` inside a test that asks a different question. Their own
  // coverage is `launch-profile-editor.test.tsx`.
  "Add agent",
  // The built-in agent rows are deliberately absent from this list. Since
  // 2026-08-19 each one prints a COMMAND, not a `.cfg-row__label`, so the walk
  // below cannot see them — and pinning them here would restate
  // `BUILTIN_AGENTS` in a test that asks a different question. Their own
  // coverage is `launch-profile-editor.test.tsx`.
  "Token usage",
  // links & editor. One row, not two, since 2026-08-19: `editorId` +
  // `editorCommand` became the single `externalAppId`, so the custom-command
  // field that used to appear under the picker is gone with the setting it
  // wrote (design §5).
  "Open with",
  // notifications
  "Agent notifications",
  "Restore sessions on launch",
  // about
  "Check for updates",
  "Release notes",
  // privacy — one switch over MAIN-owned consent state (usage-analytics spec
  // §7), added 2026-08-22. The disclosure paragraphs under it are
  // `.settings-screen__note`, not `.cfg-row__label`, so the walk sees the
  // switch alone.
  "Share usage stats",
  // reset — its own rail category since 2026-08-19, a pinned foot before that
  // (so this row used to be reachable from every category, and is now reached
  // by selecting one).
  "Restore defaults",
] as const;

/**
 * The Shortcuts category is deliberately OUT of `EXPECTED_ROWS`.
 *
 * This test asks one question — did every setting survive the move out of the
 * old drawer — and its answer is a fixed list. Shortcut rows are generated
 * from `ACTION_REGISTRY`, so folding them in would mean re-listing ~50 action
 * names here and re-editing this test on every new action, turning a
 * regression check into a transcription chore. Their own coverage
 * (`shortcuts-section.test.tsx`, `shortcut-groups.test.ts`) asserts the far
 * stronger property: that every registry action gets a row.
 */
const isShortcutRow = (label: Element): boolean => label.closest(".cfg-row--shortcut") !== null;

describe("SettingsScreen — every setting survived the move", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeCategory.value = "appearance";
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  it("reaches all 19 rows by walking the rail", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const seen = new Set<string>();
    const collect = (): void => {
      for (const label of host.querySelectorAll(".cfg-row__label")) {
        if (isShortcutRow(label)) {
          continue;
        }
        const text = label.textContent?.trim();
        if (text !== undefined && text !== "") {
          seen.add(text);
        }
      }
    };

    collect();
    for (const tab of host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      act(() => {
        tab.click();
      });
      collect();
    }

    expect([...seen].sort()).toEqual([...EXPECTED_ROWS].sort());
  });

  it("visits every registered category on the walk", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(SETTINGS_CATEGORIES.length);

    const visited: string[] = [];
    for (const tab of tabs) {
      act(() => {
        tab.click();
      });
      visited.push(activeCategory.value);
    }
    expect(visited).toEqual(SETTINGS_CATEGORIES.map((c) => c.id));
  });

  /**
   * The other half of the two-mode decision, and the half a row walk cannot
   * see: the theme CARDS were never `cfg-row` labels, so dropping them from
   * `EXPECTED_ROWS` proves nothing on its own. Appearance has to be checked
   * for their absence directly.
   */
  it("reaches no theme card, import action or colour override from Appearance", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    expect(host.querySelector(".theme-gallery")).toBeNull();
    expect(host.querySelector(".theme-card")).toBeNull();
    expect(host.querySelector('input[type="color"], .cfg-btn__hex')).toBeNull();
    const labels = [...host.querySelectorAll(".cfg-row__label")].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).not.toContain("Import theme");
    expect(labels).not.toContain("Themes folder");
    // …and the one control that replaced all of it is present and complete.
    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Appearance mode");
    expect(
      [...(group?.querySelectorAll('[role="radio"]') ?? [])].map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(["Light", "Dark"]);
  });

  it("heads every section with its own title and description", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    for (const tab of host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      act(() => {
        tab.click();
      });
      const category = SETTINGS_CATEGORIES.find((item) => item.id === activeCategory.value);
      expect(host.querySelector(".settings-screen__title")?.textContent).toBe(category?.label);
      expect(host.querySelector(".settings-screen__lede")?.textContent).toBe(category?.description);
    }
  });

  it("wires the tab/panel ARIA pair so the panel is announced with its tab", () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const panel = host.querySelector('[role="tabpanel"]');
    const selectedTab = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(panel).not.toBeNull();
    expect(selectedTab).not.toBeNull();
    // Every tab must control a panel that exists, and the live panel must name
    // the tab that is actually selected.
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      expect(tab.getAttribute("aria-controls")).toBe(panel?.id);
    }
    expect(panel?.getAttribute("aria-labelledby")).toBe(selectedTab?.id);
  });
});
