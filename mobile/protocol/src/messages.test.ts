import { describe, expect, it } from "vitest";
import { MAX_INPUT_CHARS, MAX_READ_LINES, MAX_SEND_CHARS } from "./limits";
import {
  errorResponse,
  ERROR_CODES,
  METHODS,
  okResponse,
  parseAppMessage,
  parseEvent,
  parseRequest,
  parseResponse,
} from "./messages";
import { parseResult } from "./results";
import { parseTree } from "./tree";

const ESC = String.fromCharCode(0x1b);

/** One valid params object per method, to start negative cases from. */
const VALID: Record<string, object> = {
  "tree.subscribe": {},
  "tree.unsubscribe": {},
  "pane.subscribe": { paneId: 4 },
  "pane.unsubscribe": { sub: "s1" },
  "pane.input": { paneId: 4, data: "ls\r" },
  "pane.send": { paneId: 4, text: "hello", submit: true },
  "pane.read": { paneId: 4, lines: 50 },
  "pane.open": { projectPath: "/p", checkoutPath: "/p/wt", agent: "claude", prompt: null },
  "projects.list": {},
  "agents.list": {},
  "files.list": { root: "/p", path: "" },
  "files.read": { root: "/p", path: "src/a.ts" },
  "changes.list": { root: "/p" },
  "changes.diff": { root: "/p", path: "src/a.ts" },
  "usage.get": {},
};

const pane = {
  paneId: 1,
  title: "claude",
  agent: "claude",
  agentLabel: "Claude Code",
  phase: "working",
  attention: "requested",
  attentionSince: 1_800_000_000_000,
  lastLine: "Allow edit?",
  lastOutputAt: 1_800_000_000_500,
};
const tree = {
  projects: [
    {
      name: "deck",
      path: "/p/deck",
      checkouts: [{ name: "main", path: "/p/deck", branch: "main", panes: [pane] }],
    },
  ],
};

describe("parseRequest", () => {
  it("covers exactly the methods of the contract", () => {
    expect([...METHODS]).toEqual(Object.keys(VALID));
  });

  it.each(Object.entries(VALID))("accepts a valid %s", (m, p) => {
    expect(parseRequest({ id: 1, m, p })).toEqual({ id: 1, m, p });
  });

  it("drops unknown extra params instead of passing them along", () => {
    expect(parseRequest({ id: 1, m: "pane.read", p: { paneId: 4, lines: 5, evil: "x" } })).toEqual({
      id: 1,
      m: "pane.read",
      p: { paneId: 4, lines: 5 },
    });
  });

  it("rejects unknown methods, bad envelopes and non-objects", () => {
    for (const value of [
      null,
      "x",
      [],
      {},
      { id: 1, m: "pane.kill", p: {} },
      { id: "1", m: "usage.get", p: {} },
      { id: -1, m: "usage.get", p: {} },
      { id: 1.5, m: "usage.get", p: {} },
      { id: 1, m: "usage.get" },
      { id: 1, m: "usage.get", p: [] },
      { id: 1, m: 5, p: {} },
    ]) {
      expect(parseRequest(value)).toBeNull();
    }
  });

  it("enforces the limits of the contract", () => {
    const bad = (m: string, p: object) => parseRequest({ id: 1, m, p });
    expect(bad("pane.input", { paneId: 1, data: "x".repeat(MAX_INPUT_CHARS) })).not.toBeNull();
    expect(bad("pane.input", { paneId: 1, data: "x".repeat(MAX_INPUT_CHARS + 1) })).toBeNull();
    expect(bad("pane.input", { paneId: 1, data: "" })).toBeNull();
    expect(
      bad("pane.send", { paneId: 1, text: "x".repeat(MAX_SEND_CHARS), submit: false }),
    ).not.toBeNull();
    expect(
      bad("pane.send", { paneId: 1, text: "x".repeat(MAX_SEND_CHARS + 1), submit: false }),
    ).toBeNull();
    expect(bad("pane.send", { paneId: 1, text: "x", submit: "yes" })).toBeNull();
    expect(bad("pane.read", { paneId: 1, lines: MAX_READ_LINES })).not.toBeNull();
    expect(bad("pane.read", { paneId: 1, lines: MAX_READ_LINES + 1 })).toBeNull();
    expect(bad("pane.read", { paneId: 1, lines: 0 })).toBeNull();
    expect(bad("pane.read", { paneId: 1, lines: 2.5 })).toBeNull();
    expect(bad("pane.subscribe", { paneId: -1 })).toBeNull();
    expect(bad("pane.subscribe", { paneId: "1" })).toBeNull();
    expect(bad("pane.unsubscribe", { sub: "" })).toBeNull();
    expect(bad("pane.open", { ...VALID["pane.open"], agent: "claude; rm -rf" })).toBeNull();
    expect(bad("pane.open", { ...VALID["pane.open"], prompt: 5 })).toBeNull();
    expect(
      bad("pane.open", { ...VALID["pane.open"], prompt: "x".repeat(MAX_SEND_CHARS + 1) }),
    ).toBeNull();
    expect(bad("pane.open", { ...VALID["pane.open"], projectPath: "" })).toBeNull();
    expect(bad("files.read", { root: "/p\u0000", path: "a" })).toBeNull();
    expect(bad("files.list", { root: "/p" })).toBeNull();
    expect(bad("changes.list", { root: 5 })).toBeNull();
  });
});

describe("parseResponse", () => {
  it("accepts a success and an error", () => {
    expect(parseResponse({ id: 3, ok: true, r: { sub: "s", cols: 80, rows: 24 } })).toEqual({
      id: 3,
      ok: true,
      r: { sub: "s", cols: 80, rows: 24 },
    });
    expect(parseResponse({ id: 3, ok: false, e: { code: "busy", message: "Try later" } })).toEqual({
      id: 3,
      ok: false,
      e: { code: "busy", message: "Try later" },
    });
  });

  it("accepts every documented error code and no other", () => {
    for (const code of ERROR_CODES) {
      expect(parseResponse({ id: 1, ok: false, e: { code, message: "m" } })).not.toBeNull();
    }
    expect([...ERROR_CODES]).toEqual([
      "invalid",
      "unknown-method",
      "no-target",
      "not-an-agent-pane",
      "busy",
      "expired",
      "too-large",
      "outside-root",
      "not-found",
      "unavailable",
      "internal",
    ]);
    expect(parseResponse({ id: 1, ok: false, e: { code: "teapot", message: "m" } })).toBeNull();
  });

  it("rejects malformed envelopes", () => {
    for (const value of [
      null,
      { id: 1, ok: true },
      { id: 1, ok: true, r: [] },
      { id: 1, ok: "yes", r: {} },
      { id: 1, ok: false },
      { id: 1, ok: false, e: { code: "busy" } },
      { ok: true, r: {} },
    ]) {
      expect(parseResponse(value)).toBeNull();
    }
  });

  it("sanitises the error message the desktop supplied", () => {
    const parsed = parseResponse({
      id: 1,
      ok: false,
      e: { code: "internal", message: ESC + "[2Jboom" },
    });
    expect(parsed).toMatchObject({ ok: false, e: { message: "[2Jboom" } });
  });

  it("builds responses the parser accepts", () => {
    expect(parseResponse(okResponse(2, { x: 1 }))).toEqual(okResponse(2, { x: 1 }));
    expect(parseResponse(errorResponse(2, "not-found", "No such pane"))).toEqual(
      errorResponse(2, "not-found", "No such pane"),
    );
  });
});

describe("parseEvent", () => {
  it("accepts the desktop event and drops nothing valid", () => {
    const event = {
      ev: "desktop",
      p: {
        name: "Mac",
        os: "macos",
        appVersion: "1.0.0",
        protocol: 1,
        lan: [{ host: "192.168.1.5", port: 4000 }],
      },
    };
    expect(parseEvent(event)).toEqual(event);
  });

  it("rejects bad desktop events", () => {
    const good = { name: "Mac", os: "macos", appVersion: "1", protocol: 1, lan: [] };
    for (const p of [
      { ...good, os: "beos" },
      { ...good, protocol: "1" },
      { ...good, lan: [{ host: "evil.example.com", port: 80 }] },
      { ...good, lan: [{ host: "999.1.1.1", port: 80 }] },
      { ...good, lan: [{ host: "10.0.0.1", port: 0 }] },
      { ...good, lan: Array.from({ length: 9 }, () => ({ host: "10.0.0.1", port: 80 })) },
    ]) {
      expect(parseEvent({ ev: "desktop", p })).toBeNull();
    }
  });

  it("accepts terminal events and leaves terminal data untouched", () => {
    const data = ESC + "[31mred" + ESC + "[0m\r\n";
    expect(parseEvent({ ev: "term.data", p: { sub: "s", data } })).toEqual({
      ev: "term.data",
      p: { sub: "s", data },
    });
    const snapshot = { sub: "s", paneId: 2, cols: 80, rows: 24, data, seq: 0, last: true };
    expect(parseEvent({ ev: "term.snapshot", p: snapshot })).toEqual({
      ev: "term.snapshot",
      p: snapshot,
    });
    expect(parseEvent({ ev: "term.resize", p: { sub: "s", cols: 100, rows: 30 } })).not.toBeNull();
    expect(parseEvent({ ev: "term.end", p: { sub: "s", reason: "moved" } })).not.toBeNull();
    expect(parseEvent({ ev: "term.end", p: { sub: "s", reason: "bored" } })).toBeNull();
    expect(parseEvent({ ev: "term.resize", p: { sub: "s", cols: 0, rows: 30 } })).toBeNull();
    expect(parseEvent({ ev: "term.snapshot", p: { ...snapshot, seq: -1 } })).toBeNull();
  });

  it("accepts chunk and session.start, and rejects unknown events", () => {
    expect(
      parseEvent({ ev: "chunk", p: { id: "c", seq: 0, last: true, data: "x" } }),
    ).not.toBeNull();
    expect(parseEvent({ ev: "chunk", p: { id: "c", seq: 0, last: true } })).toBeNull();
    expect(
      parseEvent({ ev: "session.start", p: { device: "iPhone", appVersion: "1" } }),
    ).not.toBeNull();
    expect(parseEvent({ ev: "reboot", p: {} })).toBeNull();
    expect(parseEvent({ ev: "tree" })).toBeNull();
  });

  it("sanitises strings the desktop supplied for display", () => {
    const hostile = {
      ev: "desktop",
      p: {
        name: ESC + "[2JMac" + String.fromCharCode(0x202e),
        os: "linux",
        appVersion: "1",
        protocol: 1,
        lan: [],
      },
    };
    expect(parseEvent(hostile)).toMatchObject({ p: { name: "[2JMac" } });
  });
});

describe("tree", () => {
  it("parses a full tree", () => {
    expect(parseTree(tree)).toEqual(tree);
    expect(parseEvent({ ev: "tree", p: { tree } })).toEqual({ ev: "tree", p: { tree } });
  });

  it("strips control characters from every display string", () => {
    const dirty = {
      projects: [
        {
          name: "de" + ESC + "ck",
          path: "/p",
          checkouts: [
            {
              name: "main",
              path: "/p",
              branch: "fe" + ESC + "at",
              panes: [
                {
                  ...pane,
                  title: "ti" + ESC + "[2Jtle",
                  lastLine: "a\nb",
                  agentLabel: "Cl" + ESC + "aude",
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseTree(dirty);
    const checkout = parsed?.projects[0].checkouts[0];
    expect(parsed?.projects[0].name).toBe("deck");
    expect(checkout?.branch).toBe("feat");
    expect(checkout?.panes[0]).toMatchObject({
      title: "ti[2Jtle",
      lastLine: "a b",
      agentLabel: "Claude",
    });
  });

  it("caps long strings", () => {
    const parsed = parseTree({ projects: [{ name: "n".repeat(900), path: "/p", checkouts: [] }] });
    expect(parsed?.projects[0].name).toHaveLength(200);
    const withLine = parseTree({
      projects: [
        {
          name: "n",
          path: "/p",
          checkouts: [
            {
              name: "c",
              path: "/p",
              branch: null,
              panes: [{ ...pane, lastLine: "x".repeat(300) }],
            },
          ],
        },
      ],
    });
    expect(withLine?.projects[0].checkouts[0].panes[0].lastLine).toHaveLength(200);
  });

  it("rejects values outside the closed sets and malformed nodes", () => {
    const withPane = (override: object) => ({
      projects: [
        {
          name: "n",
          path: "/p",
          checkouts: [{ name: "c", path: "/p", branch: null, panes: [{ ...pane, ...override }] }],
        },
      ],
    });
    for (const override of [
      { phase: "sleeping" },
      { attention: "panic" },
      { paneId: -1 },
      { paneId: "1" },
      { agent: "a b" },
      { attentionSince: "now" },
      { lastOutputAt: -5 },
      { title: 5 },
    ]) {
      expect(parseTree(withPane(override))).toBeNull();
    }
    expect(parseTree({ projects: "none" })).toBeNull();
    expect(parseTree({ projects: [null] })).toBeNull();
    expect(parseTree(null)).toBeNull();
  });

  it("bounds how many nodes it accepts", () => {
    const projects = Array.from({ length: 201 }, () => ({ name: "n", path: "/p", checkouts: [] }));
    expect(parseTree({ projects })).toBeNull();
  });
});

describe("parseAppMessage", () => {
  it("routes by envelope", () => {
    expect(parseAppMessage({ id: 1, m: "usage.get", p: {} })).toMatchObject({ kind: "request" });
    expect(parseAppMessage({ id: 1, ok: true, r: {} })).toMatchObject({ kind: "response" });
    expect(parseAppMessage({ ev: "term.data", p: { sub: "s", data: "x" } })).toMatchObject({
      kind: "event",
    });
  });

  it("returns null for anything malformed or unknown", () => {
    for (const value of [
      null,
      3,
      "x",
      [],
      {},
      { foo: 1 },
      { m: "x" },
      { ev: "nope", p: {} },
      { ok: true },
    ]) {
      expect(parseAppMessage(value)).toBeNull();
    }
  });
});

describe("parseResult", () => {
  it("validates results per method", () => {
    expect(parseResult("tree.subscribe", { tree })).toEqual({ tree });
    expect(parseResult("tree.subscribe", { tree: 1 })).toBeNull();
    expect(parseResult("pane.subscribe", { sub: "s", cols: 80, rows: 24 })).toEqual({
      sub: "s",
      cols: 80,
      rows: 24,
    });
    expect(parseResult("pane.subscribe", { sub: "s", cols: 0, rows: 24 })).toBeNull();
    expect(parseResult("pane.open", { paneId: 9 })).toEqual({ paneId: 9 });
    expect(parseResult("pane.send", { outcome: "sent" })).toEqual({ outcome: "sent" });
    expect(parseResult("pane.input", {})).toEqual({});
    expect(parseResult("pane.read", "text")).toBeNull();
  });

  it("accepts either an inline body or a chunk reference where bodies can be large", () => {
    expect(parseResult("pane.read", { text: "hi" })).toEqual({ text: "hi" });
    expect(parseResult("pane.read", { chunked: "abc" })).toEqual({ chunked: "abc" });
    expect(parseResult("changes.diff", { chunked: "abc" })).toEqual({ chunked: "abc" });
    expect(parseResult("files.read", { text: "t", truncated: false, binary: false })).toEqual({
      text: "t",
      truncated: false,
      binary: false,
    });
    expect(parseResult("files.read", { chunked: "abc", truncated: true, binary: false })).toEqual({
      chunked: "abc",
      truncated: true,
      binary: false,
    });
    expect(parseResult("files.read", { text: "t" })).toBeNull();
  });

  it("parses lists and sanitises their names", () => {
    expect(
      parseResult("files.list", {
        entries: [
          { name: "a" + ESC + ".ts", kind: "file", size: 3 },
          { name: "src", kind: "dir", size: 0 },
        ],
      }),
    ).toEqual({
      entries: [
        { name: "a.ts", kind: "file", size: 3 },
        { name: "src", kind: "dir", size: 0 },
      ],
    });
    expect(
      parseResult("files.list", { entries: [{ name: "a", kind: "socket", size: 3 }] }),
    ).toBeNull();
    expect(
      parseResult("changes.list", {
        changes: [{ path: "a.ts", status: "M", added: 2, removed: 1 }],
      }),
    ).toEqual({
      changes: [{ path: "a.ts", status: "M", added: 2, removed: 1 }],
    });
    expect(
      parseResult("changes.list", {
        changes: [{ path: "a.ts", status: "M", added: -1, removed: 1 }],
      }),
    ).toBeNull();
    expect(
      parseResult("agents.list", { agents: [{ id: "claude", label: "Claude Code" }] }),
    ).toEqual({
      agents: [{ id: "claude", label: "Claude Code" }],
    });
    expect(
      parseResult("projects.list", {
        projects: [
          { name: "deck", path: "/p", checkouts: [{ name: "main", path: "/p", branch: null }] },
        ],
      }),
    ).not.toBeNull();
    expect(parseResult("usage.get", { usage: { today: 1 } })).toEqual({ usage: { today: 1 } });
    expect(parseResult("usage.get", { usage: 4 })).toBeNull();
  });
});
