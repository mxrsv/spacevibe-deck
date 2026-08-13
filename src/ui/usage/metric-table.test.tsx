// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MetricTable } from "./metric-table";
import type { MetricColumn, MetricRow } from "./metric-table";
import { EM_DASH } from "./usage-format";

const columns: readonly MetricColumn[] = [
  { key: "agent", label: "agent" },
  { key: "tokens", label: "tokens", numeric: true },
  { key: "usd", label: "est. usd", numeric: true },
];

const rows: readonly MetricRow[] = [
  { key: "claude", cells: ["Claude Code", "1,234", "$0.42"] },
  { key: "codex", cells: ["Codex", "9", null] },
];

describe("MetricTable", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (
    overrides: Partial<Parameters<typeof MetricTable>[0]> = {},
  ): void => {
    act(() => {
      render(
        <MetricTable
          title="per-agent totals"
          note="estimated at API prices"
          columns={columns}
          rows={rows}
          emptyLabel="no data yet"
          {...overrides}
        />,
        host,
      );
    });
  };

  it("uses real table semantics: thead, tbody, scoped headers (DL-15.7)", () => {
    mount();
    const table = host.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("thead")).not.toBeNull();
    expect(table?.querySelector("tbody")).not.toBeNull();

    const columnHeaders = host.querySelectorAll('thead th[scope="col"]');
    expect(columnHeaders).toHaveLength(columns.length);
    expect([...columnHeaders].map((cell) => cell.textContent)).toEqual([
      "agent",
      "tokens",
      "est. usd",
    ]);

    // The identifying cell of each row is a row header, not a plain cell.
    const rowHeaders = host.querySelectorAll('tbody th[scope="row"]');
    expect(rowHeaders).toHaveLength(rows.length);
    expect(rowHeaders[0].textContent).toBe("Claude Code");
  });

  it("names the table from the visible heading and describes it from the note", () => {
    mount();
    const table = host.querySelector("table") as HTMLTableElement;
    const heading = host.querySelector(".metric-table__title") as HTMLElement;
    const note = host.querySelector(".metric-table__note") as HTMLElement;

    // aria-labelledby, not <caption>: a caption would scroll away with the
    // columns inside the DL-15.3 container.
    expect(table.querySelector("caption")).toBeNull();
    expect(table.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(table.getAttribute("aria-describedby")).toBe(note.id);
    expect(heading.textContent).toBe("per-agent totals");
  });

  it("right-aligns numeric columns only (DL-15.4)", () => {
    mount();
    const firstRow = host.querySelectorAll("tbody tr")[0];
    const cells = firstRow.querySelectorAll("th, td");
    expect(cells[0].classList.contains("metric-table__cell--num")).toBe(false);
    expect(cells[1].classList.contains("metric-table__cell--num")).toBe(true);
    expect(cells[2].classList.contains("metric-table__cell--num")).toBe(true);

    // The header cell of a numeric column is aligned with its column.
    const headers = host.querySelectorAll("thead th");
    expect(headers[1].classList.contains("metric-table__cell--num")).toBe(true);
  });

  it("renders a single em dash for a null cell and for a short row (DL-15.6)", () => {
    mount({
      rows: [
        { key: "codex", cells: ["Codex", "9", null] },
        { key: "short", cells: ["Only one cell"] },
      ],
    });
    const bodyRows = host.querySelectorAll("tbody tr");
    expect(bodyRows[0].querySelectorAll("td")[1].textContent).toBe(EM_DASH);
    // A row shorter than the column list still fills the grid rather than
    // collapsing it — a missing cell is an unknown value, not a missing column.
    const shortCells = bodyRows[1].querySelectorAll("td");
    expect(shortCells).toHaveLength(columns.length - 1);
    expect(shortCells[0].textContent).toBe(EM_DASH);
    expect(shortCells[1].textContent).toBe(EM_DASH);
    // And never a zero.
    expect(host.textContent).not.toContain("0");
  });

  it("keeps the header and says what is absent when there are no rows (DL-15.8)", () => {
    mount({ rows: [] });
    expect(host.querySelectorAll("thead th")).toHaveLength(columns.length);
    const empty = host.querySelector(".metric-table__empty") as HTMLElement;
    expect(empty.textContent).toBe("no data yet");
    expect(empty.getAttribute("colspan")).toBe(String(columns.length));
  });

  it("contains nothing interactive and no sort affordance (DL-15.2)", () => {
    mount();
    const table = host.querySelector("table") as HTMLTableElement;
    expect(
      table.querySelectorAll(
        'button, a, input, select, [role="button"], [tabindex], [aria-sort], [onclick]',
      ),
    ).toHaveLength(0);
  });

  it("puts the scroll container around the table, not around the page (DL-15.3)", () => {
    mount();
    const scroller = host.querySelector(".metric-table__scroll");
    expect(scroller).not.toBeNull();
    expect(scroller?.querySelector("table")).not.toBeNull();
    // The heading and the note sit OUTSIDE the scroller so they stay put
    // while a wide table scrolls under them.
    expect(scroller?.querySelector(".metric-table__title")).toBeNull();
    expect(scroller?.querySelector(".metric-table__note")).toBeNull();
  });

  it("omits aria-describedby entirely when there is no note", () => {
    mount({ note: undefined });
    const table = host.querySelector("table") as HTMLTableElement;
    expect(table.hasAttribute("aria-describedby")).toBe(false);
    expect(host.querySelector(".metric-table__note")).toBeNull();
  });
});
