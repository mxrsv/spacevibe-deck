// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUsageSummary, AgentUsageViewContext } from "../usage/agent-usage-summary";
import { ProjectRailUsageRings } from "./project-rail-usage-rings";

const NOW = 1_800_000_000_000;
const snapshot = [
  {
    agent: "claude" as const,
    state: "ready" as const,
    observedAtMs: NOW,
    windows: [
      { durationMinutes: 300, usedPercent: 32, resetsAtMs: NOW + 600_000 },
      { durationMinutes: 10080, usedPercent: 58, resetsAtMs: NOW + 900_000 },
    ],
  },
];
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("project rail usage rings", () => {
  it("draws one ring per agent from the window closest to its limit and opens Usage on press", () => {
    const onOpenUsage = vi.fn();
    act(() =>
      render(
        <ProjectRailUsageRings snapshot={snapshot} nowMs={NOW} onOpenUsage={onOpenUsage} />,
        host,
      ),
    );
    const buttons = host.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons).toHaveLength(2);
    // 7d is tighter (58% used), so 42% is left; both windows stay in the name.
    expect(buttons[0].getAttribute("aria-label")).toMatch(
      /^Claude Code: 5h: 68% remaining; resets .* · 7d: 42% remaining; resets .*\. Open usage details$/,
    );
    expect(
      buttons[0].querySelector("[data-slot=usage-ring-value]")?.getAttribute("stroke-dasharray"),
    ).toBe("42 100");
    // Codex has no reading: an empty track, never a made-up number.
    expect(buttons[1].getAttribute("aria-label")).toBe(
      "Codex: Limit unavailable. Open usage details",
    );
    expect(buttons[1].querySelector("[data-slot=usage-ring-value]")).toBeNull();
    expect(host.textContent).not.toContain("%");

    act(() => buttons[0].click());
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it("replaces the shipped text line only where a surface provides it", () => {
    const summary = <AgentUsageSummary snapshot={snapshot} nowMs={NOW} onOpenUsage={() => {}} />;
    act(() => render(summary, host));
    expect(host.textContent).toContain("Claude 42% · 7d");
    expect(host.querySelector("[data-slot=usage-ring-value]")).toBeNull();

    act(() =>
      render(
        <AgentUsageViewContext.Provider value={ProjectRailUsageRings}>
          {summary}
        </AgentUsageViewContext.Provider>,
        host,
      ),
    );
    expect(host.textContent).not.toContain("42%");
    expect(host.querySelectorAll("[data-slot=usage-ring-value]")).toHaveLength(1);
  });
});
