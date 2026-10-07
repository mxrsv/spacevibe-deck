// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAttentionList, type AttentionList } from "../attention-list-model";
import { MINUTE, NOW, list as buildList, pane, tab } from "../attention-list-fixtures";
import { railCardMenuOpen } from "../../chrome/events";
import { AttentionChip } from "./attention-chip";

function listOf(panes: Parameters<typeof pane>[1][]): AttentionList {
  return buildList([
    tab(1, "/w/deck", { panes: panes.map((over, index) => pane(index + 1, over)) }),
  ]);
}

const TWO_ASKS = [
  { attention: "requested" as const, changedAt: NOW - 20 * MINUTE },
  { attention: "completed" as const, confidence: "inferred" as const, changedAt: NOW - MINUTE },
];

describe("AttentionChip", () => {
  let host: HTMLDivElement;
  let onFocusPane: ReturnType<typeof vi.fn<(tabIndex: number, paneId: number) => void>>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    onFocusPane = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => render(null, host));
    host.remove();
  });

  const mount = (list: AttentionList): void => {
    act(() => render(<AttentionChip list={list} onFocusPane={onFocusPane} />, host));
  };
  const chip = (): HTMLButtonElement => host.querySelector(".attn-chip") as HTMLButtonElement;
  const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]');
  const rows = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".attn-row"));
  const press = (target: EventTarget, key: string): void => {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  };

  describe("the chip", () => {
    it("is absent at zero", () => {
      mount(buildAttentionList({ stream: [] }));
      expect(host.innerHTML).toBe("");
    });

    it("is absent when only quiet agents are running", () => {
      mount(listOf([{ phase: "working" }, { phase: "idle" }]));
      expect(host.innerHTML).toBe("");
    });

    it("prints the count, names it, and promises a dialog it says is open or not", () => {
      mount(listOf(TWO_ASKS));

      expect(chip().textContent).toBe("2");
      expect(chip().getAttribute("aria-label")).toBe("2 need you");
      expect(chip().getAttribute("aria-haspopup")).toBe("dialog");
      expect(chip().getAttribute("aria-expanded")).toBe("false");
      act(() => chip().click());
      expect(chip().getAttribute("aria-expanded")).toBe("true");
    });

    it("is yellow for a question and red once anything failed", () => {
      mount(listOf(TWO_ASKS));
      expect(chip().dataset.tone).toBe("asked");

      mount(listOf([...TWO_ASKS, { attention: "error" }]));
      expect(chip().dataset.tone).toBe("failed");
      expect(chip().getAttribute("aria-label")).toBe("3 need you");
    });

    it("paints each tone with its own colour token", () => {
      const css = readFileSync("src/styles/23-attention-popover.css", "utf8");

      // DL-3.2: yellow is `--status-unread` (DL-27.3), red is `--red`.
      expect(css).toMatch(/\.attn-chip__dot\s*{[^}]*background:\s*var\(--status-unread\)/);
      expect(css).toMatch(
        /\.attn-chip\[data-tone="failed"\]\s+\.attn-chip__dot\s*{[^}]*background:\s*var\(--red\)/,
      );
    });

    it("leaves with the last pane, and does not come back already open", () => {
      mount(listOf(TWO_ASKS));
      act(() => chip().click());
      expect(dialog()).not.toBeNull();

      mount(listOf([{ phase: "idle" }]));
      expect(host.innerHTML).toBe("");
      expect(dialog()).toBeNull();

      mount(listOf(TWO_ASKS));
      expect(dialog()).toBeNull();
      expect(chip().getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("the popover", () => {
    it("lists each entry as a row, loudest first, and focuses the first", () => {
      mount(listOf([...TWO_ASKS, { attention: "error", changedAt: NOW - 5 * MINUTE }]));
      act(() => chip().click());

      expect(dialog()?.getAttribute("aria-label")).toBe("Needs you");
      expect(rows().map((row) => row.querySelector(".attn-row__title")?.textContent)).toEqual([
        "Failed",
        "Needs you",
        "Needs you · inferred",
      ]);
      expect(document.activeElement).toBe(rows()[0]);
    });

    it("prints reason, place and age on two lines, and says inferred", () => {
      mount(listOf([TWO_ASKS[1]]));
      act(() => chip().click());

      const [row] = rows();
      expect(row.querySelector(".attn-row__title")?.textContent).toBe("Needs you · inferred");
      expect(row.querySelector(".attn-row__detail")?.textContent).toBe("deck · main");
      expect(row.querySelector(".attn-row__age")?.textContent).toBe("1m");
      expect(row.getAttribute("aria-label")).toBe(
        "Focus Claude, needs you (inferred) in deck · main",
      );
    });

    it("leaves the age out when the tracker has none", () => {
      mount(listOf([{ attention: "requested", changedAt: 0 }]));
      act(() => chip().click());

      expect(rows()[0].querySelector(".attn-row__age")).toBeNull();
    });

    it("counts what it does not list in a footer", () => {
      mount(listOf([{ attention: "requested" }, { phase: "working" }, { phase: "idle" }]));
      act(() => chip().click());

      expect(document.querySelector(".attn-pop__foot")?.textContent).toBe("1 working · 1 done");
    });

    it("offers no approve, deny or reply control", () => {
      mount(listOf(TWO_ASKS));
      act(() => chip().click());

      // The only buttons in the dialog are the rows themselves, each a choice
      // of pane. Nothing answers an agent (ATT-D4).
      const buttons = Array.from(dialog()?.querySelectorAll("button") ?? []);
      expect(buttons).toHaveLength(2);
      expect(buttons.every((button) => button.classList.contains("attn-row"))).toBe(true);
      expect(dialog()?.querySelector("input, textarea")).toBeNull();
    });

    it("hides the browser's native view while it is open, and only then", () => {
      vi.useFakeTimers();
      // An earlier test's release is still pending on a real timer.
      railCardMenuOpen.value = false;
      mount(listOf(TWO_ASKS));

      act(() => chip().click());
      expect(railCardMenuOpen.value).toBe(true);

      act(() => chip().click());
      // Released after a short delay, so one surface closing as another opens
      // does not tear the native view down twice.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(railCardMenuOpen.value).toBe(false);
    });
  });

  describe("choosing", () => {
    const entries = listOf([
      { attention: "requested", changedAt: NOW - 30 * MINUTE },
      { attention: "requested", changedAt: NOW - 20 * MINUTE },
      { attention: "error", changedAt: NOW - MINUTE },
    ]);

    it("focuses exactly the pane of the entry Enter lands on", () => {
      mount(entries);
      act(() => chip().click());
      // Failed first, then the two asks by wait: panes 3, 1, 2.
      press(rows()[0], "ArrowDown");
      expect(document.activeElement).toBe(rows()[1]);
      press(rows()[1], "Enter");

      expect(onFocusPane).toHaveBeenCalledTimes(1);
      expect(onFocusPane).toHaveBeenCalledWith(0, 1);
    });

    it("focuses exactly the pane of the row that is pressed", () => {
      mount(entries);
      act(() => chip().click());
      act(() => rows()[2].click());

      expect(onFocusPane).toHaveBeenCalledTimes(1);
      expect(onFocusPane).toHaveBeenCalledWith(0, 2);
    });

    it("closes once it has chosen, without taking the focus back", () => {
      mount(entries);
      act(() => chip().click());
      press(rows()[0], "Enter");

      expect(dialog()).toBeNull();
      expect(document.activeElement).not.toBe(chip());
      expect(chip().getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("the keyboard", () => {
    const three = listOf([
      { attention: "requested", changedAt: NOW - 30 * MINUTE },
      { attention: "requested", changedAt: NOW - 20 * MINUTE },
      { attention: "requested", changedAt: NOW - 10 * MINUTE },
    ]);

    it("moves with the arrows, wraps at both ends, and jumps with Home and End", () => {
      mount(three);
      act(() => chip().click());

      press(rows()[0], "ArrowDown");
      expect(document.activeElement).toBe(rows()[1]);
      press(rows()[1], "ArrowDown");
      press(rows()[2], "ArrowDown");
      expect(document.activeElement).toBe(rows()[0]);
      press(rows()[0], "ArrowUp");
      expect(document.activeElement).toBe(rows()[2]);
      press(rows()[2], "Home");
      expect(document.activeElement).toBe(rows()[0]);
      press(rows()[0], "End");
      expect(document.activeElement).toBe(rows()[2]);
    });

    it("closes on Escape and returns focus to the chip", () => {
      mount(three);
      act(() => chip().click());
      expect(dialog()).not.toBeNull();

      press(rows()[0], "Escape");

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(chip());
      expect(onFocusPane).not.toHaveBeenCalled();
    });

    it("keeps Escape from travelling on to a terminal", () => {
      mount(three);
      act(() => chip().click());
      const reached = vi.fn();
      document.body.addEventListener("keydown", reached);

      press(rows()[0], "Escape");

      expect(reached).not.toHaveBeenCalled();
      document.body.removeEventListener("keydown", reached);
    });

    it("closes on a press outside, and chooses nothing", () => {
      mount(three);
      act(() => chip().click());

      act(() => {
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });

      expect(dialog()).toBeNull();
      expect(onFocusPane).not.toHaveBeenCalled();
    });

    it("closes when focus leaves for a pane, as ⌘⇧A sends it", () => {
      mount(three);
      const terminal = document.createElement("textarea");
      document.body.appendChild(terminal);
      act(() => chip().click());

      act(() => terminal.focus());

      expect(dialog()).toBeNull();
      terminal.remove();
    });

    it("toggles from the chip's own press", () => {
      mount(three);
      act(() => chip().click());
      act(() => chip().click());

      expect(dialog()).toBeNull();
    });
  });
});
