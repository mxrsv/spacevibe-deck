import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_TURN_MS,
  STALE_WORKING_MS,
  createPaneMirror,
  type PaneMirror,
  type PaneSnapshot,
} from "./pane-mirror";

type Report = Omit<PaneSnapshot, "reportedAt">;

const IDLE: Report = {
  phase: "idle",
  attention: "none",
  source: null,
  confidence: "explicit",
  agent: "claude",
  pid: 4242,
};
const WORKING: Report = { ...IDLE, phase: "working" };
const COMPLETED: Report = { ...IDLE, attention: "completed", source: "hook" };
const REQUESTED: Report = { ...IDLE, attention: "requested", source: "hook" };
const EXITED: Report = { ...IDLE, phase: "exited", agent: null, pid: null };
const CAP = 60_000;

let mirror: PaneMirror;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  mirror = createPaneMirror({ now: () => Date.now() });
});

afterEach(() => {
  const leaked = vi.getTimerCount();
  vi.useRealTimers();
  // Not an `expect`: lint keeps assertions inside test bodies. A wait that settles must clear
  // its cap and no-turn timers, so none may remain once the test is done.
  if (leaked !== 0) throw new Error(`${leaked} timer(s) outlived their wait`);
});

describe("pane mirror — reports", () => {
  it("keeps the latest report, stamped with main's clock", () => {
    mirror.report(7, WORKING);
    vi.advanceTimersByTime(1500);
    mirror.report(7, COMPLETED);
    expect(mirror.get(7)).toEqual({ ...COMPLETED, reportedAt: 1_001_500 });
  });

  it("answers null for a pane nobody reported, and 0 as its revision", () => {
    expect(mirror.get(7)).toBeNull();
    expect(mirror.revisionOf(7)).toBe(0);
  });

  it("counts every report of a pane, identical ones too, and each pane apart", () => {
    mirror.report(7, IDLE);
    mirror.report(7, IDLE);
    mirror.report(8, IDLE);
    mirror.report(7, WORKING);
    expect(mirror.revisionOf(7)).toBe(3);
    expect(mirror.revisionOf(8)).toBe(1);
  });

  it("forgets a pane completely", () => {
    mirror.report(7, WORKING);
    mirror.forget(7);
    expect(mirror.get(7)).toBeNull();
    expect(mirror.revisionOf(7)).toBe(0);
  });

  it("hollows a working report older than 120 s to inferred, and only that", () => {
    mirror.report(7, WORKING);
    mirror.report(8, IDLE);
    vi.advanceTimersByTime(STALE_WORKING_MS);
    expect(mirror.get(7)?.confidence).toBe("explicit");
    vi.advanceTimersByTime(1);
    expect(mirror.get(7)).toMatchObject({ phase: "working", confidence: "inferred" });
    expect(mirror.get(8)?.confidence).toBe("explicit");
    mirror.report(7, WORKING);
    expect(mirror.get(7)?.confidence).toBe("explicit");
  });
});

describe("pane mirror — wait without a send", () => {
  it("resolves at once when the state already satisfies the target", async () => {
    mirror.report(7, IDLE);
    await expect(mirror.wait(7, "idle", { capMs: CAP })).resolves.toEqual({
      reached: true,
      state: expect.objectContaining({ phase: "idle" }),
    });
  });

  it.each([
    ["idle", IDLE, true],
    ["idle", EXITED, true],
    ["idle", COMPLETED, true],
    ["idle", WORKING, false],
    ["idle", REQUESTED, false],
    ["idle", { ...IDLE, attention: "warning" }, false],
    ["idle", { ...IDLE, attention: "error" }, false],
    ["needs-you", IDLE, false],
    ["needs-you", COMPLETED, false],
    ["needs-you", REQUESTED, true],
    ["needs-you", { ...WORKING, attention: "warning" }, true],
    ["needs-you", { ...IDLE, attention: "error" }, true],
    ["needs-you", EXITED, true],
    ["exited", EXITED, true],
    ["exited", IDLE, false],
    ["exited", REQUESTED, false],
    ["turn", IDLE, true],
    ["turn", COMPLETED, true],
    ["turn", REQUESTED, true],
    ["turn", EXITED, true],
    ["turn", WORKING, false],
  ] as const)("target %s on %j is reached: %s", async (target, report, reached) => {
    mirror.report(7, report);
    const outcome = mirror.wait(7, target, { capMs: 1000 });
    if (!reached) vi.advanceTimersByTime(1000);
    await expect(outcome).resolves.toMatchObject({ reached });
  });

  it("waits for the state that arrives later, whatever the pane did before", async () => {
    mirror.report(7, WORKING);
    const outcome = mirror.wait(7, "turn", { capMs: CAP });
    vi.advanceTimersByTime(20_000);
    mirror.report(7, COMPLETED);
    await expect(outcome).resolves.toEqual({
      reached: true,
      state: { ...COMPLETED, reportedAt: 1_020_000 },
    });
  });

  it("waits on a pane that has not reported yet", async () => {
    const outcome = mirror.wait(7, "idle", { capMs: CAP });
    mirror.report(7, IDLE);
    await expect(outcome).resolves.toMatchObject({ reached: true });
  });

  it("answers cap at the cap when nothing was reached", async () => {
    mirror.report(7, WORKING);
    const outcome = mirror.wait(7, "idle", { capMs: 30_000 });
    vi.advanceTimersByTime(29_999);
    mirror.report(7, WORKING);
    vi.advanceTimersByTime(1);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "cap" });
  });

  it("answers gone to every waiter of a forgotten pane, with or without a report", async () => {
    mirror.report(7, WORKING);
    const reported = mirror.wait(7, "idle", { capMs: CAP });
    const fresh = mirror.wait(8, "idle", { capMs: CAP });
    mirror.forget(7);
    mirror.forget(8);
    await expect(reported).resolves.toEqual({ reached: false, reason: "gone" });
    await expect(fresh).resolves.toEqual({ reached: false, reason: "gone" });
  });

  it("serves many concurrent waiters on one pane with different targets", async () => {
    mirror.report(7, WORKING);
    const idle = mirror.wait(7, "idle", { capMs: CAP });
    const turn = mirror.wait(7, "turn", { capMs: CAP });
    const needsYou = mirror.wait(7, "needs-you", { capMs: 1000 });
    const exited = mirror.wait(7, "exited", { capMs: CAP });
    mirror.report(7, COMPLETED);
    await expect(idle).resolves.toMatchObject({ reached: true });
    await expect(turn).resolves.toMatchObject({ reached: true });
    vi.advanceTimersByTime(1000);
    await expect(needsYou).resolves.toEqual({ reached: false, reason: "cap" });
    mirror.report(7, EXITED);
    await expect(exited).resolves.toMatchObject({ reached: true });
  });

  it("does not let one pane's report wake another pane's waiter", async () => {
    const outcome = mirror.wait(7, "idle", { capMs: 1000 });
    mirror.report(8, IDLE);
    vi.advanceTimersByTime(1000);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "cap" });
  });

  it("reads a stale working report as inferred in the state it resolves with", async () => {
    mirror.report(7, WORKING);
    vi.advanceTimersByTime(STALE_WORKING_MS + 1);
    const outcome = mirror.wait(7, "needs-you", { capMs: CAP });
    mirror.report(7, { ...WORKING, attention: "warning" });
    await expect(outcome).resolves.toMatchObject({
      state: { phase: "working", attention: "warning", confidence: "explicit" },
    });
  });

  it("stops waiting when the caller hangs up, and leaves no timer", async () => {
    const hangup = new AbortController();
    const outcome = mirror.wait(7, "idle", { capMs: CAP, signal: hangup.signal });
    hangup.abort();
    await expect(outcome).resolves.toEqual({ reached: false, reason: "cap" });
    expect(vi.getTimerCount()).toBe(0);
    mirror.report(7, IDLE);
  });

  it("does not start a wait for a caller that already hung up", async () => {
    const hangup = new AbortController();
    hangup.abort();
    await expect(mirror.wait(7, "idle", { capMs: CAP, signal: hangup.signal })).resolves.toEqual({
      reached: false,
      reason: "cap",
    });
  });
});

describe("pane mirror — wait after a send (ORC15)", () => {
  it("does not resolve on the idle that preceded the send", async () => {
    mirror.report(7, COMPLETED);
    const sentAt = mirror.revisionOf(7);
    const outcome = mirror.wait(7, "idle", { capMs: CAP, afterRevision: sentAt });
    mirror.report(7, WORKING);
    mirror.report(7, IDLE);
    await expect(outcome).resolves.toMatchObject({
      reached: true,
      state: { phase: "idle", attention: "none" },
    });
    expect(mirror.revisionOf(7)).toBe(sentAt + 2);
  });

  it("holds an idle that arrives with no working report before it", async () => {
    mirror.report(7, COMPLETED);
    const outcome = mirror.wait(7, "idle", {
      capMs: CAP,
      afterRevision: mirror.revisionOf(7),
    });
    mirror.report(7, IDLE);
    vi.advanceTimersByTime(NO_TURN_MS);
    // A report came, so the pane is not silent: no "no-turn", the wait runs to its cap.
    vi.advanceTimersByTime(CAP - NO_TURN_MS);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "cap" });
  });

  it("keeps waiting for a turn that starts just before 5 s", async () => {
    mirror.report(7, COMPLETED);
    const outcome = mirror.wait(7, "idle", { capMs: CAP, afterRevision: mirror.revisionOf(7) });
    vi.advanceTimersByTime(NO_TURN_MS - 1);
    mirror.report(7, WORKING);
    mirror.report(7, IDLE);
    await expect(outcome).resolves.toMatchObject({ reached: true });
  });

  it("answers no-turn exactly at 5 s", async () => {
    mirror.report(7, COMPLETED);
    const outcome = mirror.wait(7, "idle", { capMs: CAP, afterRevision: mirror.revisionOf(7) });
    vi.advanceTimersByTime(NO_TURN_MS);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "no-turn" });
  });

  it("does not call a pane silent once it reported anything, even a non-turn", async () => {
    mirror.report(7, COMPLETED);
    const outcome = mirror.wait(7, "idle", { capMs: CAP, afterRevision: mirror.revisionOf(7) });
    vi.advanceTimersByTime(NO_TURN_MS - 1);
    mirror.report(7, COMPLETED);
    vi.advanceTimersByTime(CAP);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "cap" });
  });

  it("answers no-turn for a pane that never reported, when the send came first", async () => {
    const outcome = mirror.wait(7, "turn", { capMs: CAP, afterRevision: 0 });
    vi.advanceTimersByTime(NO_TURN_MS);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "no-turn" });
  });

  it("resolves at once when the turn already ran and ended before the wait asked", async () => {
    mirror.report(7, IDLE);
    const sentAt = mirror.revisionOf(7);
    mirror.report(7, WORKING);
    mirror.report(7, COMPLETED);
    await expect(mirror.wait(7, "idle", { capMs: CAP, afterRevision: sentAt })).resolves.toEqual({
      reached: true,
      state: expect.objectContaining({ phase: "idle", attention: "completed" }),
    });
  });

  it("does not let the same turn satisfy a wait asked after a second send", async () => {
    mirror.report(7, WORKING);
    mirror.report(7, COMPLETED);
    const secondSend = mirror.revisionOf(7);
    const outcome = mirror.wait(7, "turn", { capMs: CAP, afterRevision: secondSend });
    vi.advanceTimersByTime(NO_TURN_MS);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "no-turn" });
  });

  it("treats a pane that is mid-turn when asked as started, and never calls it no-turn", async () => {
    mirror.report(7, WORKING);
    const outcome = mirror.wait(7, "idle", {
      capMs: CAP,
      afterRevision: mirror.revisionOf(7),
    });
    vi.advanceTimersByTime(NO_TURN_MS * 4);
    mirror.report(7, COMPLETED);
    await expect(outcome).resolves.toMatchObject({ reached: true });
  });

  it("ends the wait when the agent exits or asks for the user right after the send", async () => {
    mirror.report(7, COMPLETED);
    const exits = mirror.wait(7, "turn", { capMs: CAP, afterRevision: mirror.revisionOf(7) });
    mirror.report(7, EXITED);
    await expect(exits).resolves.toMatchObject({ reached: true, state: { phase: "exited" } });

    mirror.report(8, COMPLETED);
    const asks = mirror.wait(8, "needs-you", { capMs: CAP, afterRevision: mirror.revisionOf(8) });
    mirror.report(8, REQUESTED);
    await expect(asks).resolves.toMatchObject({
      reached: true,
      state: { attention: "requested" },
    });
  });

  it("does not take a needs-you state from before the send as the answer", async () => {
    mirror.report(7, REQUESTED);
    const outcome = mirror.wait(7, "needs-you", {
      capMs: CAP,
      afterRevision: mirror.revisionOf(7),
    });
    vi.advanceTimersByTime(NO_TURN_MS);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "no-turn" });
  });

  it("answers gone for a pane forgotten while the no-turn timer runs", async () => {
    mirror.report(7, COMPLETED);
    const outcome = mirror.wait(7, "idle", { capMs: CAP, afterRevision: mirror.revisionOf(7) });
    mirror.forget(7);
    await expect(outcome).resolves.toEqual({ reached: false, reason: "gone" });
  });
});
