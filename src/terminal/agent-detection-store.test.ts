import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedAgent } from "./pty-client";
import {
  detectedAgents,
  ensureAgentsDetected,
  resetAgentDetectionForTests,
  REVALIDATE_AFTER_MS,
} from "./agent-detection-store";

/**
 * The probe is the only thing this store talks to, and every test here is
 * about HOW OFTEN it runs — so it is a counted mock with an optional gate a
 * test can hold open past an `await`, the way the open board's own suite does.
 */
const host = vi.hoisted(() => ({
  detectAgents: vi.fn<(names: readonly string[]) => Promise<DetectedAgent[]>>(),
}));

vi.mock("./pty-client", () => ({
  defaultPtyClient: {
    detectAgents: (names: readonly string[]) => host.detectAgents(names),
  },
}));

const CLAUDE: DetectedAgent = { name: "claude", path: "/usr/bin/claude" };
const CODEX: DetectedAgent = { name: "codex", path: "/usr/bin/codex" };
/** A round clock, so a stamped cache reads as an absolute moment. */
const NOW = 1_700_000_000_000;

describe("agent detection store", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    host.detectAgents.mockReset();
    host.detectAgents.mockResolvedValue([CLAUDE]);
    resetAgentDetectionForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes once and publishes the result", async () => {
    const found = await ensureAgentsDetected(["claude", "codex"]);

    expect(found).toEqual([CLAUDE]);
    expect(detectedAgents.value).toEqual([CLAUDE]);
    expect(host.detectAgents).toHaveBeenCalledTimes(1);
    expect(host.detectAgents).toHaveBeenCalledWith(["claude", "codex"]);
  });

  it("serves the cached list without a second probe while it is fresh", async () => {
    await ensureAgentsDetected(["claude"]);
    host.detectAgents.mockResolvedValue([CLAUDE, CODEX]);

    vi.setSystemTime(NOW + REVALIDATE_AFTER_MS - 1);
    const again = await ensureAgentsDetected(["claude"]);

    expect(again).toEqual([CLAUDE]);
    expect(host.detectAgents).toHaveBeenCalledTimes(1);
  });

  it("answers from the cache and refreshes behind it once stale", async () => {
    await ensureAgentsDetected(["claude"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    host.detectAgents.mockImplementation(async () => {
      await gate;
      return [CLAUDE, CODEX];
    });

    vi.setSystemTime(NOW + REVALIDATE_AFTER_MS);
    // Resolves against the list already held, NOT the probe now in flight —
    // this is the ~1.1s the picker used to spend with nothing on screen.
    const served = await ensureAgentsDetected(["claude"]);
    expect(served).toEqual([CLAUDE]);
    expect(host.detectAgents).toHaveBeenCalledTimes(2);

    release();
    await vi.waitFor(() => {
      expect(detectedAgents.value).toEqual([CLAUDE, CODEX]);
    });
  });

  it("awaits a real probe when the declared set changes", async () => {
    await ensureAgentsDetected(["claude"]);
    host.detectAgents.mockResolvedValue([CLAUDE, CODEX]);

    // A custom agent added in Settings widens the list, and the caller must
    // see it now: an answer that predates the new name cannot describe it.
    const found = await ensureAgentsDetected(["claude", "mycli"]);

    expect(found).toEqual([CLAUDE, CODEX]);
    expect(host.detectAgents).toHaveBeenCalledTimes(2);
  });

  it("joins one probe when two callers ask at once", async () => {
    const [first, second] = await Promise.all([
      ensureAgentsDetected(["claude"]),
      ensureAgentsDetected(["claude"]),
    ]);

    expect(first).toEqual([CLAUDE]);
    expect(second).toEqual([CLAUDE]);
    expect(host.detectAgents).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list when a probe fails", async () => {
    await ensureAgentsDetected(["claude"]);
    host.detectAgents.mockRejectedValue(new Error("bridge is gone"));

    vi.setSystemTime(NOW + REVALIDATE_AFTER_MS);
    await ensureAgentsDetected(["claude"]);
    // The failure was a background refresh, so nothing about the agents the
    // user can already see changed.
    expect(detectedAgents.value).toEqual([CLAUDE]);
  });

  it("degrades to Shell only when the very first probe fails, then retries", async () => {
    host.detectAgents.mockRejectedValueOnce(new Error("bridge is gone"));

    // Cold, so this one waits for the probe and gets what it produced: an
    // empty list, which is the picker's "Shell only" — same as the uncached
    // path did.
    const found = await ensureAgentsDetected(["claude"]);
    expect(found).toEqual([]);
    expect(detectedAgents.value).toEqual([]);

    // A failure does not stamp the cache, so the next caller probes again
    // rather than inheriting it for the whole freshness window.
    const recovered = await ensureAgentsDetected(["claude"]);
    expect(recovered).toEqual([CLAUDE]);
    expect(host.detectAgents).toHaveBeenCalledTimes(2);
  });
});
