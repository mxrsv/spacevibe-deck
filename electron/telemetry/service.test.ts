/**
 * Lifecycle, merge, cadence and retry tests for the analytics service
 * (spec §11). Every dependency is injected: no network, no clock, no disk.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_PAYLOAD_KEYS,
  CONSENT_VERSION,
  EMPTY_STATE,
  HEARTBEAT_INTERVAL_MS,
  MAX_PENDING_DAYS,
  SEND_CHECK_INTERVAL_MS,
  type PersistedTelemetry,
  type UsagePayloadLike,
} from "./model";
import {
  createTelemetryService,
  parsePersisted,
  shouldSend,
  type TelemetryDeps,
  type TelemetryService,
} from "./service";
import { AGENT_PAYLOAD_KEYS as RENDERER_AGENT_KEYS } from "../../src/telemetry/payload";

interface Harness {
  readonly service: TelemetryService;
  readonly posts: UsagePayloadLike[];
  readonly writes: PersistedTelemetry[];
  readonly flushes: PersistedTelemetry[];
  setNow(ms: number): void;
  advance(ms: number): void;
  tick(): void;
  timerRunning(): boolean;
  postStatus(status: number | Error): void;
  failFlush(fail: boolean): void;
  /** Hold the NEXT post open; the returned function completes it. */
  holdNextPost(): () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `mandatory` defaults to FALSE here, not to the shipped constant.
 *
 * The opt-out machinery is unreachable in shipped builds but is deliberately
 * kept (see `USAGE_ANALYTICS_MANDATORY`), so its tests have to keep running:
 * a default of `true` would silently turn every one of them into an assertion
 * about the refusal instead. The mandatory policy gets its own describe block,
 * which passes `mandatory: true` explicitly.
 */
function harness(
  initial?: unknown,
  options?: { unreadable?: boolean; mandatory?: boolean },
): Harness {
  let nowMs = Date.UTC(2026, 7, 22, 12, 0, 0);
  let uuidCounter = 0;
  let status: number | Error = 204;
  let flushFails = false;
  let timerHandler: (() => void) | null = null;
  let heldPost: { settle: () => void } | null = null;
  const posts: UsagePayloadLike[] = [];
  const writes: PersistedTelemetry[] = [];
  const flushes: PersistedTelemetry[] = [];
  let persisted: unknown = initial;
  const deps: TelemetryDeps = {
    mandatory: options?.mandatory ?? false,
    now: () => nowMs,
    localDay: (ms) => new Date(ms).toISOString().slice(0, 10),
    randomUUID: () => `uuid-${(uuidCounter += 1)}`,
    post: (payload) => {
      posts.push(payload);
      if (heldPost !== null) {
        const release = heldPost;
        heldPost = null;
        return new Promise<number>((resolve, reject) => {
          release.settle = () => (status instanceof Error ? reject(status) : resolve(status));
        });
      }
      return status instanceof Error ? Promise.reject(status) : Promise.resolve(status);
    },
    version: "1.0.1",
    platform: "darwin",
    arch: "arm64",
    store: {
      unreadable: () => options?.unreadable === true,
      read: () => persisted,
      write: (state) => {
        writes.push(state);
        persisted = state;
      },
      flush: (state) => {
        if (flushFails) {
          return Promise.reject(new Error("disk full"));
        }
        flushes.push(state);
        persisted = state;
        return Promise.resolve();
      },
    },
    report: () => {},
    startTimer: (handler) => {
      timerHandler = handler;
      return () => {
        timerHandler = null;
      };
    },
  };
  return {
    service: createTelemetryService(deps),
    posts,
    writes,
    flushes,
    setNow: (ms) => {
      nowMs = ms;
    },
    advance: (ms) => {
      nowMs += ms;
    },
    tick: () => timerHandler?.(),
    timerRunning: () => timerHandler !== null,
    postStatus: (next) => {
      status = next;
    },
    failFlush: (fail) => {
      flushFails = fail;
    },
    holdNextPost: () => {
      const holder = { settle: () => {} };
      heldPost = holder;
      return () => holder.settle();
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const ENABLED_STATE: PersistedTelemetry = {
  consent: "enabled",
  consentVersion: CONSENT_VERSION,
  days: {},
};

describe("telemetry lifecycle", () => {
  it("a fresh install counts and sends without being asked", () => {
    // Reversed 2026-08-23 (owner): analytics is on by default and is turned
    // off in Settings, so a state file that does not exist yet is `enabled`,
    // not a question waiting to be answered.
    const h = harness(undefined);
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    expect(h.service.state().consent).toBe("enabled");
    expect(h.writes.length).toBeGreaterThan(0);
    expect(h.posts.length).toBeGreaterThan(0);
    expect(h.timerRunning()).toBe(true);
  });

  it("declined is the one state that counts nothing and sends nothing", () => {
    const h = harness({ consent: "declined", consentVersion: 1, days: {} });
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    expect(h.writes).toEqual([]);
    expect(h.posts).toEqual([]);
    expect(h.service.state().consent).toBe("declined");
  });

  it("unreadable fails closed: off, no writes, setEnabled rejects", async () => {
    const h = harness(undefined, { unreadable: true });
    h.service.count("agent", "claude", 1);
    expect(h.service.state().consent).toBe("unreadable");
    await expect(h.service.setEnabled(true)).rejects.toThrow(/unreadable/);
    expect(h.writes).toEqual([]);
    expect(h.posts).toEqual([]);
  });

  it("enabling persists consent BEFORE any id exists", async () => {
    const h = harness(undefined);
    await h.service.setEnabled(true);
    expect(h.flushes[0]).toEqual({
      consent: "enabled",
      consentVersion: CONSENT_VERSION,
      days: {},
    });
    // The id arrives only in the follow-up buffer write.
    const withDay = h.writes.find((state) => Object.keys(state.days).length > 0);
    expect(withDay).toBeDefined();
    expect(h.timerRunning()).toBe(true);
  });

  it("a failed re-enable rolls back to the state on disk", async () => {
    // The rollback still matters after the default flip: it is what stops the
    // app claiming a state it could not persist. Only the value it rolls back
    // TO moved — a user who had turned analytics off must land back on
    // `declined`, never on the new default.
    const h = harness({ consent: "declined", consentVersion: 1, days: {} });
    h.failFlush(true);
    await expect(h.service.setEnabled(true)).rejects.toThrow("disk full");
    expect(h.service.state().consent).toBe("declined");
    expect(h.writes).toEqual([]);
    expect(h.timerRunning()).toBe(false);
  });

  it("off means off: buffers and ids are deleted and the timer stops", async () => {
    const h = harness(ENABLED_STATE);
    h.service.count("agent", "claude", 1);
    expect(h.timerRunning()).toBe(true);
    await h.service.setEnabled(false);
    expect(h.timerRunning()).toBe(false);
    const final = h.flushes[h.flushes.length - 1];
    expect(final.consent).toBe("declined");
    expect(final.days).toEqual({});
    h.service.count("agent", "claude", 1);
    expect(h.service.state().consent).toBe("declined");
  });

  it("a failed DECLINE still reads as declined, so the switch never lies", async () => {
    // The asymmetry with the failed re-enable above is deliberate. Turning
    // sharing ON rolls back, because claiming a state that did not reach disk
    // is the one thing this must never do. Turning it OFF does not: off is
    // already the safe answer, so the in-memory `declined` stands for this run
    // and is broadcast to every window — a user who switches analytics off on
    // a read-only disk gets what they asked for until the next launch, and the
    // throw still reaches the UI so it can say the choice will not survive
    // one.
    const h = harness(undefined);
    const writesBeforeDecline = h.writes.length;
    h.failFlush(true);
    await expect(h.service.setEnabled(false)).rejects.toThrow("disk full");
    expect(h.service.state().consent).toBe("declined");
    // Off is off for this run even though the write failed: no further count
    // lands and the send timer is down.
    h.service.count("agent", "claude", 1);
    expect(h.writes.length).toBe(writesBeforeDecline);
    expect(h.timerRunning()).toBe(false);
  });

  it("an older contract version keeps collecting — there is no one to re-ask", () => {
    // The downgrade-to-`unanswered` branch went with the consent question
    // (2026-08-23). Keeping it would have stopped collection silently and
    // permanently on the next `CONSENT_VERSION` bump, since nothing renders
    // `unanswered` any more. A contract change is a privacy-notice edit now.
    const h = harness({ consent: "enabled", consentVersion: 0, days: {} });
    expect(h.service.state().consent).toBe("enabled");
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    expect(h.posts.length).toBeGreaterThan(0);
    expect(h.timerRunning()).toBe(true);
  });
});

describe("mandatory analytics", () => {
  it("refuses to turn off, and says so rather than failing quietly", async () => {
    // Settings renders no switch, but `telemetry_set_enabled` is still a
    // registered channel and the renderer is not the trust boundary. The
    // refusal has to live here for "cannot be turned off" to be a property of
    // the app rather than of the current UI.
    const h = harness(ENABLED_STATE, { mandatory: true });
    h.service.count("agent", "claude", 1);
    await expect(h.service.setEnabled(false)).rejects.toThrow(/mandatory/);
    // The refusal changes nothing: consent stands, the timer stands, and the
    // day's buffer is NOT deleted the way a real decline would delete it.
    expect(h.service.state().consent).toBe("enabled");
    expect(h.timerRunning()).toBe(true);
    expect(h.flushes).toEqual([]);
  });

  it("counts and sends for a user who had turned analytics off", () => {
    // The sharpest edge of the decision, pinned: a `declined` file written by
    // an earlier build is overridden, not honoured.
    const h = harness({ consent: "declined", consentVersion: 1, days: {} }, { mandatory: true });
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    expect(h.service.state().consent).toBe("enabled");
    expect(h.posts.length).toBeGreaterThan(0);
    expect(h.timerRunning()).toBe(true);
  });

  it("still fails closed on an unreadable state file", () => {
    // Mandatory does not mean "send regardless". A disk Deck cannot read is
    // not a disk it may assume anything from, and this is the one state in
    // which a shipped build sends nothing.
    const h = harness(undefined, { unreadable: true, mandatory: true });
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    expect(h.service.state().consent).toBe("unreadable");
    expect(h.posts).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});

describe("counting and the cumulative merge", () => {
  it("folds counters, high-water marks and the restored flag", async () => {
    const h = harness(ENABLED_STATE);
    h.service.count("agent", "claude", 1);
    h.service.count("agent", "claude", 1);
    h.service.count("agent", "custom:acme", 1); // unknown key: rejected by main
    h.service.count("surface", "browser", 1);
    h.service.count("tabs", "", 4);
    h.service.count("tabs", "", 3); // below the high-water mark: ignored
    h.service.count("panes", "", 6);
    h.service.count("restored", "", 1);
    h.service.count("agent", "claude", -1); // invalid value: rejected
    h.service.noteWindowReady();
    await flushMicrotasks();
    const payload = h.posts[h.posts.length - 1];
    expect(payload.agents).toEqual({ claude: 2 });
    expect(payload.surfaces).toEqual({ browser: 1, explorer: 0, usage: 0 });
    expect(payload.maxTabs).toBe(4);
    expect(payload.maxPanes).toBe(6);
    expect(payload.restoredSessions).toBe(true);
  });

  it("one run is enough to reach participating DAU", async () => {
    const h = harness(ENABLED_STATE);
    h.service.noteWindowReady();
    await flushMicrotasks();
    expect(h.posts.length).toBe(1);
    expect(h.posts[0].agents).toEqual({});
    expect(h.posts[0].day).toBe("2026-08-22");
  });

  it("keeps a count folded while a send is in flight, and resends it", async () => {
    const h = harness(ENABLED_STATE);
    const release = h.holdNextPost();
    h.service.noteWindowReady();
    await flushMicrotasks();
    // The POST is airborne; this fold lands in a NEW day object the send's
    // captured buffer knows nothing about.
    h.service.count("agent", "claude", 1);
    release();
    await flushMicrotasks();
    // The 204 must not erase the mid-flight fold or clear its dirty flag:
    // the next cycle sends the fuller snapshot.
    h.advance(SEND_CHECK_INTERVAL_MS);
    h.tick();
    await flushMicrotasks();
    const last = h.posts[h.posts.length - 1];
    expect(last.agents).toEqual({ claude: 1 });
  });

  it("a retry carries the whole snapshot so it replaces, never adds", async () => {
    const h = harness(ENABLED_STATE);
    h.postStatus(new Error("offline"));
    h.service.count("agent", "codex", 1);
    h.service.noteWindowReady();
    await flushMicrotasks();
    h.postStatus(204);
    h.service.count("agent", "codex", 1);
    h.advance(SEND_CHECK_INTERVAL_MS);
    h.tick();
    await flushMicrotasks();
    const last = h.posts[h.posts.length - 1];
    expect(last.agents).toEqual({ codex: 2 });
    expect(last.dailyId).toBe(h.posts[0].dailyId);
  });
});

describe("days and ids", () => {
  it("two local days carry unrelated ids and no linking field", async () => {
    const h = harness(ENABLED_STATE);
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    await flushMicrotasks();
    h.advance(DAY_MS);
    h.service.count("agent", "claude", 1);
    h.tick();
    await flushMicrotasks();
    const days = new Map(h.posts.map((p) => [p.day, p.dailyId]));
    expect(days.size).toBe(2);
    const [a, b] = [...days.values()];
    expect(a).not.toBe(b);
    for (const post of h.posts) {
      expect(Object.keys(post).sort()).toEqual(
        [
          "schemaVersion",
          "dailyId",
          "day",
          "version",
          "platform",
          "arch",
          "agents",
          "surfaces",
          "maxTabs",
          "maxPanes",
          "restoredSessions",
        ].sort(),
      );
    }
  });

  it("returning to a prior local day reuses that buffer and its id", async () => {
    const h = harness(ENABLED_STATE);
    h.service.count("agent", "claude", 1);
    h.service.noteWindowReady();
    await flushMicrotasks();
    const firstId = h.posts[0].dailyId;
    // Timezone change: tomorrow, then back to the same local date.
    h.advance(DAY_MS);
    h.service.count("agent", "claude", 1);
    h.advance(-DAY_MS);
    h.service.count("agent", "codex", 1);
    h.advance(SEND_CHECK_INTERVAL_MS);
    h.tick();
    await flushMicrotasks();
    const back = h.posts.filter((p) => p.day === "2026-08-22");
    expect(back[back.length - 1].dailyId).toBe(firstId);
    expect(back[back.length - 1].agents).toEqual({ claude: 1, codex: 1 });
  });

  it("caps pending buffers at seven days, oldest first", async () => {
    const h = harness(ENABLED_STATE);
    h.postStatus(new Error("offline"));
    for (let i = 0; i < MAX_PENDING_DAYS + 3; i += 1) {
      h.service.count("agent", "claude", 1);
      h.advance(DAY_MS);
    }
    h.postStatus(204);
    h.tick();
    await flushMicrotasks();
    const days = new Set(h.posts.map((p) => p.day));
    expect(days.size).toBeLessThanOrEqual(MAX_PENDING_DAYS);
  });
});

describe("failure handling", () => {
  it("400 and 413 are terminal; that buffer never sends again", async () => {
    for (const code of [400, 413]) {
      const h = harness(ENABLED_STATE);
      h.postStatus(code);
      h.service.count("agent", "claude", 1);
      h.service.noteWindowReady();
      await flushMicrotasks();
      expect(h.posts.length).toBe(1);
      h.service.count("agent", "claude", 1);
      h.advance(HEARTBEAT_INTERVAL_MS);
      h.tick();
      await flushMicrotasks();
      expect(h.posts.length).toBe(1);
    }
  });

  it("429 and 5xx keep the buffer for the next scheduled check", async () => {
    for (const code of [408, 429, 500, 503]) {
      const h = harness(ENABLED_STATE);
      h.postStatus(code);
      h.service.noteWindowReady();
      await flushMicrotasks();
      expect(h.posts.length).toBe(1);
      h.postStatus(204);
      h.advance(SEND_CHECK_INTERVAL_MS);
      h.tick();
      await flushMicrotasks();
      expect(h.posts.length).toBe(2);
    }
  });
});

describe("shouldSend cadence", () => {
  const buffer = {
    dailyId: "id",
    agents: {},
    surfaces: {},
    maxTabs: 0,
    maxPanes: 0,
    restoredSessions: false,
    dirty: false,
    lastSentAt: 0,
    terminal: false,
  };

  it("never sends without enabled consent or on a terminal buffer", () => {
    expect(shouldSend(buffer, 0, "unanswered")).toBe(false);
    expect(shouldSend(buffer, 0, "declined")).toBe(false);
    expect(shouldSend(buffer, 0, "unreadable")).toBe(false);
    expect(shouldSend({ ...buffer, terminal: true }, HEARTBEAT_INTERVAL_MS, "enabled")).toBe(false);
  });

  it("sends a never-sent buffer immediately", () => {
    expect(shouldSend({ ...buffer, lastSentAt: null }, 0, "enabled")).toBe(true);
  });

  it("sends a dirty buffer at most every fifteen minutes", () => {
    const dirty = { ...buffer, dirty: true };
    expect(shouldSend(dirty, SEND_CHECK_INTERVAL_MS - 1, "enabled")).toBe(false);
    expect(shouldSend(dirty, SEND_CHECK_INTERVAL_MS, "enabled")).toBe(true);
  });

  it("heartbeats a clean buffer every six hours", () => {
    expect(shouldSend(buffer, HEARTBEAT_INTERVAL_MS - 1, "enabled")).toBe(false);
    expect(shouldSend(buffer, HEARTBEAT_INTERVAL_MS, "enabled")).toBe(true);
  });
});

describe("persisted-state parsing", () => {
  it("degrades malformed input to the default, but never away from `declined`", () => {
    expect(parsePersisted(null, false)).toEqual(EMPTY_STATE);
    expect(parsePersisted([], false)).toEqual(EMPTY_STATE);
    // A garbage string is a file Deck cannot read a preference out of, so it
    // takes the default…
    expect(parsePersisted({ consent: "yes" }, false).consent).toBe("enabled");
    expect(parsePersisted({}, false).consent).toBe("enabled");
    // …and `declined` is the one value that is never inferred away, because it
    // is the only one a user can only have put there on purpose.
    expect(parsePersisted({ consent: "declined" }, false).consent).toBe("declined");
    // The spelling an opt-in build left behind folds into the default.
    expect(parsePersisted({ consent: "unanswered" }, false).consent).toBe("enabled");
  });

  it("folds even `declined` into enabled once analytics is mandatory", () => {
    // The one value the opt-out policy protected is the one the mandatory
    // policy overrides, so it is pinned rather than left implied: a recorded
    // refusal does not survive this build.
    expect(parsePersisted({ consent: "declined" }, true).consent).toBe("enabled");
    expect(parsePersisted({ consent: "unanswered" }, true).consent).toBe("enabled");
    expect(parsePersisted({ consent: "yes" }, true).consent).toBe("enabled");
    // An unreadable FILE is still a different answer — that path never reaches
    // `parsePersisted` at all, and `consentNow` reports `unreadable`.
  });

  it("drops malformed days and unknown counter keys", () => {
    const parsed = parsePersisted({
      consent: "enabled",
      consentVersion: 1,
      days: {
        "2026-08-22": {
          dailyId: "id",
          agents: { claude: 2, "custom:acme": 9, gemini: -1 },
          surfaces: { browser: 1, unknown: 5 },
        },
        "not-a-day": { dailyId: "id2" },
        "2026-08-21": "garbage",
      },
    });
    expect(Object.keys(parsed.days)).toEqual(["2026-08-22"]);
    expect(parsed.days["2026-08-22"].agents).toEqual({ claude: 2 });
    expect(parsed.days["2026-08-22"].surfaces).toEqual({ browser: 1 });
  });
});

describe("renderer mirror parity", () => {
  it("main's closed agent key set equals the renderer contract's", () => {
    expect([...AGENT_PAYLOAD_KEYS].sort()).toEqual([...RENDERER_AGENT_KEYS].sort());
  });
});
