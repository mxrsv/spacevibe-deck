// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMIT_MAX_AGE_MS } from "../../lib/agent-limits";

vi.mock("../../usage/agent-limits-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    agentLimits: signal([]),
    agentLimitsAvailable: true,
    agentLimitsLoading: signal(false),
    agentLimitsError: signal(false),
    observeAgentLimits: vi.fn(() => vi.fn()),
  };
});
const { RailAgentLimits } = await import("./agent-usage-summary");
const { agentLimits, observeAgentLimits } = await import("../../usage/agent-limits-store");
const NOW = 1_800_000_000_000;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  agentLimits.value = [];
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("live sidebar limits", () => {
  it.each(["reset", "stale"] as const)(
    "removes a displayed percentage at %s even without another IPC reply",
    async (reason) => {
      agentLimits.value = [
        {
          agent: "codex",
          state: "ready",
          observedAtMs: NOW,
          windows: [
            {
              durationMinutes: 10080,
              usedPercent: 82,
              resetsAtMs: NOW + (reason === "reset" ? 2000 : 600_000),
            },
          ],
        },
      ];
      act(() => render(<RailAgentLimits onOpenUsage={() => undefined} />, host));
      expect(host.textContent).toContain("Codex 18% · 7d");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(reason === "reset" ? 2000 : LIMIT_MAX_AGE_MS + 1);
      });
      expect(host.textContent).not.toContain("18%");
      expect(host.querySelector('[aria-label^="Codex:"]')?.textContent?.trim()).toBe("Codex —");
      const cleanup = vi.mocked(observeAgentLimits).mock.results[0].value;
      act(() => render(null, host));
      expect(cleanup).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
