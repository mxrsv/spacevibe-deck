// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { BreakdownSection } from "./breakdown-section";
import { EM_DASH } from "../usage-format";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: "ok", filesScanned: 1 },
  ],
  skippedLines: 0,
});

describe("BreakdownSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
  });

  const mount = (): void => {
    act(() => {
      render(<BreakdownSection />, host);
    });
  };

  it("keeps all six counter classes as separate columns (blocker B4)", () => {
    mount();
    expect([...host.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Agent",
      "Model",
      "Input uncached",
      "Cache read",
      "Cache create 5m",
      "Cache create 1h",
      "Cache write",
      "Output",
      "Est. USD",
    ]);
  });

  it("shows the raw model string verbatim so a missing price is diagnosable", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "codex",
        model: "some-unreleased-model-2026-08",
        counters: {
          inputUncached: 7,
          cacheRead: 6,
          cacheCreate5m: 5,
          cacheCreate1h: 4,
          cacheWrite: 3,
          output: 2,
        },
      },
    ]);
    mount();

    const row = host.querySelector("tbody tr") as HTMLTableRowElement;
    const cells = [...row.querySelectorAll("th, td")].map((cell) => cell.textContent);
    expect(cells[0]).toBe("Codex");
    expect(cells[1]).toBe("some-unreleased-model-2026-08");
    expect(cells.slice(2, 8)).toEqual(["7", "6", "5", "4", "3", "2"]);
    // Unknown model → tokens shown, USD dashed. No guessing (spec §Pricing).
    expect(cells[8]).toBe(EM_DASH);
  });
});
