// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { AgentBoardNav } from "./agent-board-nav";

const STATUS = [
  { filter: "all" as const, label: "All", count: 6, active: true },
  { filter: "asked" as const, label: "Asked", count: 1, active: false },
];
const PROJECTS = [
  { key: "deck", label: "deck · main", count: 4, active: false },
  { key: "fix", label: "deck · fix-rail · fix/rail", count: 2, active: false },
];

describe("AgentBoardNav", () => {
  it("renders STATUS then PROJECTS as two labelled listboxes with counts", () => {
    const host = document.createElement("div");
    act(() => {
      render(
        <AgentBoardNav
          status={STATUS}
          projects={PROJECTS}
          onStatusFilter={() => {}}
          onProjectFilter={() => {}}
        />,
        host,
      );
    });
    const labels = [...host.querySelectorAll(".board-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Status", "Projects"]);
    const rows = [...host.querySelectorAll(".board-nav__row")].map((el) => el.textContent);
    expect(rows).toEqual(["All6", "Asked1", "deck · main4", "deck · fix-rail · fix/rail2"]);
    expect(host.querySelector(".board-nav__row[aria-selected='true']")!.textContent).toBe("All6");
    expect(host.querySelectorAll("[role='listbox']").length).toBe(2);
  });
  it("reports a status pick and toggles a project pick off on a second press", () => {
    const onStatus = vi.fn();
    const onProject = vi.fn();
    const host = document.createElement("div");
    act(() => {
      render(
        <AgentBoardNav
          status={STATUS}
          projects={[{ ...PROJECTS[0], active: true }]}
          onStatusFilter={onStatus}
          onProjectFilter={onProject}
        />,
        host,
      );
    });
    act(() => {
      host.querySelectorAll<HTMLButtonElement>(".board-nav__row")[1].click();
    });
    expect(onStatus).toHaveBeenCalledWith("asked");
    act(() => {
      host.querySelectorAll<HTMLButtonElement>(".board-nav__row")[2].click();
    });
    expect(onProject).toHaveBeenCalledWith(null);
  });
  it("spends one Tab stop per group and moves inside it with the arrow keys", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      render(
        <AgentBoardNav
          status={STATUS}
          projects={PROJECTS}
          onStatusFilter={() => {}}
          onProjectFilter={() => {}}
        />,
        host,
      );
    });
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".board-nav__row")];
    // Roving tabindex: one 0 per listbox, four rows, two stops — not four.
    expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, 0, -1]);
    // Focus starts on the selected row of each group; PROJECTS has none
    // selected, so it starts on its first.
    expect(rows[0].getAttribute("aria-selected")).toBe("true");

    act(() => rows[0].focus());
    act(() => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[1]);
    act(() => {
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[0]);
    // End stays inside the group it was pressed in — the two listboxes are
    // independent, so it cannot walk into PROJECTS.
    act(() => {
      rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[1]);
    act(() => {
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[0]);
  });
  it("names each row with its label and count, so a hidden label still announces", () => {
    const host = document.createElement("div");
    act(() => {
      render(
        <AgentBoardNav
          status={STATUS}
          projects={[]}
          onStatusFilter={() => {}}
          onProjectFilter={() => {}}
        />,
        host,
      );
    });
    expect(
      [...host.querySelectorAll(".board-nav__row")].map((row) => row.getAttribute("aria-label")),
    ).toEqual(["All 6", "Asked 1"]);
  });
  it("leaves Escape to the Board", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onEscape = vi.fn();
    act(() => {
      render(
        <div onKeyDown={(event) => event.key === "Escape" && onEscape()}>
          <AgentBoardNav
            status={STATUS}
            projects={[]}
            onStatusFilter={() => {}}
            onProjectFilter={() => {}}
          />
        </div>,
        host,
      );
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>(".board-nav__row")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
