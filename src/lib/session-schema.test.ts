import { describe, expect, it } from "vitest";
import {
  capTaskPrompt,
  pushArchiveEntry,
  validateArchive,
  validateWindowRecord,
  MAX_ARCHIVE_WORKSPACES,
  MAX_TASK_PROMPT_BYTES,
  TASK_PROMPT_CUT_MARK,
} from "./session-schema";

const LEAF = { type: "leaf" } as const;
// `launchOptions` is explicit here because the validator always answers with
// the field: a fixture without it round-trips to a record that has it, and
// every `toEqual(RECORD)` below would fail on the difference.
const PANE = { cwd: "/tmp/x", agent: "claude", launchCommand: null, taskPrompt: null };
const TAB = {
  workspacePath: "/tmp/x",
  layout: LEAF,
  panes: [PANE],
  name: null,
  dotColor: null,
};
const RECORD = {
  savedAt: 111,
  activeTabIndex: 0,
  tabs: [TAB],
  files: [],
  activeFileTab: null,
  agentBoardOpen: false,
  agentBoardSurfaceActive: false,
};

describe("validateWindowRecord", () => {
  it("accepts a well-formed record", () => {
    expect(validateWindowRecord(RECORD)).toEqual(RECORD);
  });
  it("rejects non-objects", () => {
    expect(validateWindowRecord(null)).toBeNull();
    expect(validateWindowRecord("x")).toBeNull();
  });
  it("drops a tab whose pane count does not match its layout leaves", () => {
    const bad = { ...TAB, panes: [PANE, PANE] }; // leaf layout = 1 leaf
    const result = validateWindowRecord({ ...RECORD, tabs: [bad, TAB] });
    expect(result?.tabs).toEqual([TAB]);
  });
  it("drops a tab with an invalid layout but keeps the rest", () => {
    const bad = { ...TAB, layout: { type: "nope" } };
    expect(validateWindowRecord({ ...RECORD, tabs: [bad, TAB] })?.tabs).toEqual([TAB]);
  });
  it("clamps activeTabIndex into the surviving tab range", () => {
    expect(validateWindowRecord({ ...RECORD, activeTabIndex: 99 })?.activeTabIndex).toBe(0);
  });
  it("coerces malformed file surfaces away without rejecting the record", () => {
    const result = validateWindowRecord({
      ...RECORD,
      files: [
        {
          workspacePath: "/w",
          tabs: [{ path: "/w/a.ts", preview: false }],
          activePath: null,
        },
        42,
      ],
    });
    expect(result?.files).toHaveLength(1);
  });
});

describe("archive", () => {
  it("validates entries individually", () => {
    const archive = validateArchive({
      "/w": { savedAt: 1, tabs: [TAB] },
      "/bad": "x",
    });
    expect(Object.keys(archive)).toEqual(["/w"]);
  });
  it("caps at MAX_ARCHIVE_WORKSPACES, dropping oldest savedAt", () => {
    let archive: Readonly<Record<string, never[]>> | Record<string, unknown> = {};
    let out = {} as ReturnType<typeof validateArchive>;
    for (let i = 0; i <= MAX_ARCHIVE_WORKSPACES; i += 1) {
      out = pushArchiveEntry(out, `/w${i}`, { savedAt: i, tabs: [TAB] });
    }
    expect(Object.keys(out)).toHaveLength(MAX_ARCHIVE_WORKSPACES);
    expect(out["/w0"]).toBeUndefined();
    void archive;
  });

  it("validateArchive over the cap keeps the newest savedAt entries, not a first-N key-order slice (L1)", () => {
    // Insertion/key order deliberately puts the newest entry FIRST and the
    // oldest LAST — the opposite of append order — so a first-N-in-key-order
    // slice would keep the wrong ones (it would drop the newest instead of
    // the oldest).
    const raw: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_ARCHIVE_WORKSPACES; i += 1) {
      const savedAt = MAX_ARCHIVE_WORKSPACES - i; // newest key first, oldest key last
      raw[`/w${i}`] = { savedAt, tabs: [TAB] };
    }
    const out = validateArchive(raw);
    expect(Object.keys(out)).toHaveLength(MAX_ARCHIVE_WORKSPACES);
    // The oldest entry (savedAt 0, key "/w{MAX}") must be the one dropped.
    expect(out[`/w${MAX_ARCHIVE_WORKSPACES}`]).toBeUndefined();
    // The newest entry (savedAt MAX, key "/w0") must survive.
    expect(out["/w0"]).toBeDefined();
  });
});

describe("SessionPane.launchCommand", () => {
  function paneOf(launchCommand: unknown) {
    const record = validateWindowRecord({
      savedAt: 1,
      activeTabIndex: 0,
      tabs: [
        {
          workspacePath: null,
          layout: { type: "leaf" },
          panes: [{ cwd: "/tmp", agent: "claude", launchCommand, taskPrompt: null }],
          name: null,
          dotColor: null,
        },
      ],
      files: [],
      activeFileTab: null,
    });
    return record?.tabs[0].panes[0];
  }

  it("keeps a pane's launch command", () => {
    expect(paneOf("claude --permission-mode plan")?.launchCommand).toBe(
      "claude --permission-mode plan",
    );
  });

  it("drops an unsafe command without dropping the pane", () => {
    const pane = paneOf("claude; rm -rf /");
    expect(pane?.launchCommand).toBeNull();
    expect(pane?.agent).toBe("claude");
    expect(pane?.cwd).toBe("/tmp");
  });

  it("reads a file written before the field existed", () => {
    expect(paneOf(undefined)?.launchCommand).toBeNull();
  });
});

describe("WindowRecord.agentBoardOpen", () => {
  // `savedAt` is mandatory: the envelope returns null without a finite number
  // (`validateTabEnvelope`), so a payload missing it asserts nothing.
  const base = { savedAt: 1, activeTabIndex: 0, tabs: [], files: [], activeFileTab: null };

  it("defaults to false for a record written before the field existed", () => {
    expect(validateWindowRecord(base)?.agentBoardOpen).toBe(false);
  });

  it("takes only a real boolean — never a truthy string", () => {
    expect(validateWindowRecord({ ...base, agentBoardOpen: true })?.agentBoardOpen).toBe(true);
    expect(validateWindowRecord({ ...base, agentBoardOpen: "yes" })?.agentBoardOpen).toBe(false);
    expect(validateWindowRecord({ ...base, agentBoardOpen: "false" })?.agentBoardOpen).toBe(false);
    expect(validateWindowRecord({ ...base, agentBoardOpen: 1 })?.agentBoardOpen).toBe(false);
  });
});

describe("WindowRecord.agentBoardSurfaceActive", () => {
  it.each([undefined, null, false, "true", "false", 1])("rejects non-true state %s", (value) => {
    expect(
      validateWindowRecord({ ...RECORD, agentBoardOpen: true, agentBoardSurfaceActive: value })
        ?.agentBoardSurfaceActive,
    ).toBe(false);
  });

  it("restores an active surface only with an open chip", () => {
    expect(
      validateWindowRecord({ ...RECORD, agentBoardOpen: true, agentBoardSurfaceActive: true })
        ?.agentBoardSurfaceActive,
    ).toBe(true);
    expect(
      validateWindowRecord({ ...RECORD, agentBoardSurfaceActive: true })?.agentBoardSurfaceActive,
    ).toBe(false);
  });
});

describe("SessionPane.taskPrompt", () => {
  /** The pane the record validator answers with, for a raw `taskPrompt`.
   *  `validateSessionPane` is not exported — this is the same round-trip
   *  through `validateWindowRecord` the launchCommand cases above use. */
  function paneWith(taskPrompt: unknown) {
    const record = validateWindowRecord({
      savedAt: 1,
      activeTabIndex: 0,
      tabs: [
        {
          workspacePath: null,
          layout: { type: "leaf" },
          panes: [{ cwd: "/tmp", agent: "claude", launchCommand: null, taskPrompt }],
          name: null,
          dotColor: null,
        },
      ],
      files: [],
      activeFileTab: null,
    });
    return record?.tabs[0].panes[0];
  }

  it("keeps a short task prompt and caps a long one with a mark", () => {
    expect(capTaskPrompt("short")).toBe("short");
    const long = "x".repeat(MAX_TASK_PROMPT_BYTES + 100);
    const capped = capTaskPrompt(long);
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(
      MAX_TASK_PROMPT_BYTES + new TextEncoder().encode(TASK_PROMPT_CUT_MARK).length,
    );
    expect(capped.endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
  });

  it("counts BYTES, not characters", () => {
    // Four bytes each, so a quarter of the cap in characters is the whole cap.
    const emoji = "🙂".repeat(MAX_TASK_PROMPT_BYTES / 4);
    expect(capTaskPrompt(emoji)).toBe(emoji);
    expect(capTaskPrompt(`${emoji}🙂`).endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
  });

  it("never leaves half a code point where the cut landed", () => {
    // 2 + 4096 bytes, so the byte cut lands two bytes into the LAST emoji —
    // the case a naive decode turns into a trailing U+FFFD, which would put
    // visible garbage in front of the mark and push the result past the bound.
    const split = `ab${"🙂".repeat(MAX_TASK_PROMPT_BYTES / 4)}`;
    const capped = capTaskPrompt(split);
    expect(capped).not.toContain("�");
    expect(capped.endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(
      MAX_TASK_PROMPT_BYTES + new TextEncoder().encode(TASK_PROMPT_CUT_MARK).length,
    );
  });

  it("reads a missing or non-string taskPrompt as null", () => {
    expect(paneWith(undefined)?.taskPrompt).toBeNull();
    expect(paneWith(42)?.taskPrompt).toBeNull();
  });

  it("caps on READ too — a session file is untrusted input", () => {
    const pane = paneWith("y".repeat(MAX_TASK_PROMPT_BYTES + 1));
    expect(pane?.taskPrompt?.endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
    expect(new TextEncoder().encode(pane?.taskPrompt ?? "").length).toBeLessThanOrEqual(
      MAX_TASK_PROMPT_BYTES + new TextEncoder().encode(TASK_PROMPT_CUT_MARK).length,
    );
  });
});

describe("SessionPane.sessionId (agent-signal contract layer, stage 1)", () => {
  function paneOf(sessionId: unknown) {
    const record = validateWindowRecord({
      savedAt: 1,
      activeTabIndex: 0,
      tabs: [
        {
          workspacePath: null,
          layout: { type: "leaf" },
          panes: [{ cwd: "/tmp", agent: "claude", launchCommand: null, sessionId }],
          name: null,
          dotColor: null,
        },
      ],
      files: [],
      activeFileTab: null,
    });
    return record?.tabs[0].panes[0];
  }

  it("keeps a registry-confirmed session id", () => {
    expect(paneOf("a79dbead-d71b-445b-b328-86f9952b1d84")?.sessionId).toBe(
      "a79dbead-d71b-445b-b328-86f9952b1d84",
    );
  });

  it("drops an unsafe id without dropping the pane, and omits the field when absent", () => {
    const unsafe = paneOf("../../etc/passwd");
    expect(unsafe?.sessionId).toBeUndefined();
    expect(unsafe?.agent).toBe("claude");
    expect(paneOf(null)?.sessionId).toBeUndefined();
    expect(paneOf(undefined)).not.toHaveProperty("sessionId");
  });
});
