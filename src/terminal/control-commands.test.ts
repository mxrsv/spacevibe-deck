import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTROL_READ_DEFAULT_LINES,
  CONTROL_READ_MAX_LINES,
  CONTROL_SUBMIT_DELAY_MS,
  type ControlCommandPayload,
  type ControlReplyPayload,
} from "../lib/control-command";
import type { InjectOptions, InjectOutcome } from "../prompts/inject";
import { createControlCommandHandler, type ControlTabs } from "./control-commands";

const NONE: Omit<ControlCommandPayload, "requestId" | "command" | "paneId"> = {
  cwd: null,
  agent: null,
  name: null,
  text: null,
  submit: null,
  expectedAgent: null,
  lines: null,
  force: null,
  deadline: null,
};

function command(
  name: ControlCommandPayload["command"],
  paneId: number,
  used: Partial<ControlCommandPayload> = {},
  requestId = "req-1",
): ControlCommandPayload {
  return { requestId, command: name, paneId, ...NONE, ...used };
}

const REPLY_KEYS = ["error", "ok", "outcome", "paneId", "requestId", "text"];

function build(overrides: Partial<ControlTabs> = {}) {
  const replies: ControlReplyPayload[] = [];
  const tabs: ControlTabs = {
    openAgentTab: vi.fn(async () => ({ ok: true as const, paneId: 31 })),
    agentProcessOf: vi.fn(async () => ({ agent: "codex", processId: 4242 })),
    injectIntoPane: vi.fn(async (): Promise<InjectOutcome> => "sent"),
    serializePane: vi.fn((): string | null => "screen"),
    closePaneById: vi.fn(async () => "closed" as const),
    ...overrides,
  };
  const handler = createControlCommandHandler({ tabs, reply: (reply) => replies.push(reply) });
  return { handler, tabs, replies };
}

describe("control command handler — open", () => {
  it("opens a tab at the directory with the agent and the name, and replies the new pane id", async () => {
    const { handler, tabs, replies } = build();

    await handler.handle(command("open", 7, { cwd: "/work/app-t1", agent: "codex", name: "T1" }));

    expect(tabs.openAgentTab).toHaveBeenCalledWith({
      cwd: "/work/app-t1",
      agent: "codex",
      name: "T1",
    });
    expect(replies).toEqual([
      { requestId: "req-1", ok: true, paneId: 31, text: null, outcome: null, error: null },
    ]);
  });

  it("refuses an agent that is not enabled or discovered, with the reason", async () => {
    const { handler, replies } = build({
      openAgentTab: async () => ({ ok: false, error: "unknown-agent" }),
    });
    await handler.handle(command("open", 7, { cwd: "/work/a", agent: "nope" }));
    expect(replies).toEqual([
      {
        requestId: "req-1",
        ok: false,
        paneId: null,
        text: null,
        outcome: null,
        error: "unknown-agent",
      },
    ]);
  });

  it("refuses an open that names no directory or no agent without opening anything", async () => {
    const { handler, tabs, replies } = build();
    await handler.handle(command("open", 7, { agent: "codex" }));
    await handler.handle(command("open", 7, { cwd: "/work/a" }, "req-2"));
    expect(tabs.openAgentTab).not.toHaveBeenCalled();
    expect(replies.map((reply) => [reply.requestId, reply.error])).toEqual([
      ["req-1", "invalid"],
      ["req-2", "invalid"],
    ]);
  });
});

describe("control command handler — send", () => {
  const send = (over: Partial<ControlCommandPayload> = {}, requestId?: string) =>
    command(
      "send",
      12,
      { text: "do the thing", submit: true, expectedAgent: "codex", ...over },
      requestId,
    );

  it("pastes the cleaned text with Enter 500 ms later, gated on the agent and process read just before", async () => {
    const { handler, tabs, replies } = build();

    await handler.handle(send({ text: "\u001b[31mfirst\u001b[0m\u0007\r\nsecond\tline" }));

    expect(tabs.agentProcessOf).toHaveBeenCalledWith(12);
    expect(tabs.injectIntoPane).toHaveBeenCalledWith(12, "first\nsecond\tline", {
      autoSend: true,
      expectedAgent: "codex",
      submitDelayMs: CONTROL_SUBMIT_DELAY_MS,
      expectedProcessId: 4242,
    });
    expect(CONTROL_SUBMIT_DELAY_MS).toBe(500);
    expect(replies).toEqual([
      { requestId: "req-1", ok: true, paneId: null, text: null, outcome: "sent", error: null },
    ]);
  });

  it("pastes without Enter when the command says not to submit", async () => {
    const { handler, tabs, replies } = build({
      injectIntoPane: vi.fn(async (): Promise<InjectOutcome> => "pasted"),
    });
    await handler.handle(send({ submit: false }));
    expect(tabs.injectIntoPane).toHaveBeenCalledWith(
      12,
      "do the thing",
      expect.objectContaining({ autoSend: false }),
    );
    expect(replies[0]).toMatchObject({ ok: true, outcome: "pasted" });
  });

  it.each(["pasted", "sent"] as const)("answers ok for %s", async (outcome) => {
    const { handler, replies } = build({ injectIntoPane: async () => outcome });
    await handler.handle(send());
    expect(replies[0]).toMatchObject({ ok: true, outcome });
  });

  it.each(["failed", "busy", "no-target", "stale"] as const)(
    "answers not ok, with the outcome, for %s",
    async (outcome) => {
      const { handler, replies } = build({ injectIntoPane: async () => outcome });
      await handler.handle(send());
      expect(replies[0]).toMatchObject({ ok: false, outcome, error: null });
    },
  );

  it("types nothing into a pane that is not running the agent main gated on", async () => {
    const shell = build({ agentProcessOf: async () => ({ agent: null, processId: null }) });
    await shell.handler.handle(send());
    const other = build({ agentProcessOf: async () => ({ agent: "claude", processId: 99 }) });
    await other.handler.handle(send());
    const unreadable = build({ agentProcessOf: async () => ({ agent: "codex", processId: null }) });
    await unreadable.handler.handle(send());

    for (const { tabs, replies } of [shell, other, unreadable]) {
      expect(tabs.injectIntoPane).not.toHaveBeenCalled();
      expect(replies[0]).toMatchObject({ ok: false, error: "not-an-agent-pane" });
    }
  });

  it("answers no-target for a pane this window does not hold", async () => {
    const { handler, tabs, replies } = build({ agentProcessOf: async () => null });
    await handler.handle(send());
    expect(tabs.injectIntoPane).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({ ok: false, error: "no-target" });
  });

  it.each([
    ["only escape sequences", "\u001b[2J\u001b]0;title\u0007"],
    ["only whitespace", " \n\t"],
    ["no text at all", null],
  ])("refuses text that is %s without touching the pane", async (_name, text) => {
    const { handler, tabs, replies } = build();
    await handler.handle(send({ text }));
    expect(tabs.agentProcessOf).not.toHaveBeenCalled();
    expect(tabs.injectIntoPane).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({ ok: false, error: "empty-text" });
  });

  it("refuses a send that carries no expected agent", async () => {
    const { handler, tabs, replies } = build();
    await handler.handle(send({ expectedAgent: null }));
    expect(tabs.injectIntoPane).not.toHaveBeenCalled();
    expect(replies[0]).toMatchObject({ ok: false, error: "not-an-agent-pane" });
  });

  it("runs two sends to one pane in order, the second waiting for the first", async () => {
    const order: string[] = [];
    const release: Array<() => void> = [];
    const { handler, replies } = build({
      injectIntoPane: vi.fn(async (_pane: number, text: string): Promise<InjectOutcome> => {
        order.push(`start ${text}`);
        await new Promise<void>((resolve) => release.push(resolve));
        order.push(`end ${text}`);
        return "sent";
      }),
    });

    const first = handler.handle(send({ text: "one" }, "req-1"));
    const second = handler.handle(send({ text: "two" }, "req-2"));
    await vi.waitFor(() => expect(order).toEqual(["start one"]));
    // The second has not started, let alone been answered `busy`.
    await Promise.resolve();
    expect(order).toEqual(["start one"]);
    expect(replies).toEqual([]);

    release[0]();
    await vi.waitFor(() => expect(order).toEqual(["start one", "end one", "start two"]));
    release[1]();
    await Promise.all([first, second]);

    expect(order).toEqual(["start one", "end one", "start two", "end two"]);
    expect(replies.map((reply) => [reply.requestId, reply.outcome])).toEqual([
      ["req-1", "sent"],
      ["req-2", "sent"],
    ]);
  });

  it("does not make a send to another pane wait", async () => {
    const release: Array<() => void> = [];
    const started: number[] = [];
    const { handler } = build({
      injectIntoPane: vi.fn(async (pane: number): Promise<InjectOutcome> => {
        started.push(pane);
        await new Promise<void>((resolve) => release.push(resolve));
        return "sent";
      }),
    });

    const first = handler.handle(
      command("send", 12, { text: "a", submit: true, expectedAgent: "codex" }),
    );
    const other = handler.handle(
      command("send", 13, { text: "b", submit: true, expectedAgent: "codex" }, "req-2"),
    );
    await vi.waitFor(() => expect(started.sort()).toEqual([12, 13]));
    release.forEach((resolve) => resolve());
    await Promise.all([first, other]);
  });

  it("lets the next send through after one failed", async () => {
    let calls = 0;
    const { handler, replies } = build({
      injectIntoPane: vi.fn(async (): Promise<InjectOutcome> => {
        calls += 1;
        if (calls === 1) throw new Error("pty write blew up");
        return "sent";
      }),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await handler.handle(send({}, "req-1"));
    await handler.handle(send({}, "req-2"));

    expect(replies.map((reply) => [reply.requestId, reply.ok, reply.error])).toEqual([
      ["req-1", false, "renderer-error"],
      ["req-2", true, null],
    ]);
  });

  it("passes the injection options through unchanged for the process check", async () => {
    const seen: InjectOptions[] = [];
    const { handler } = build({
      injectIntoPane: async (_pane, _text, opts) => {
        seen.push(opts);
        return "sent";
      },
    });
    await handler.handle(send());
    expect(seen).toEqual([
      { autoSend: true, expectedAgent: "codex", submitDelayMs: 500, expectedProcessId: 4242 },
    ]);
  });

  describe("a deadline main set (ORC11)", () => {
    const NOW = 1_700_000_000_000;

    afterEach(() => {
      vi.useRealTimers();
    });

    it("drops a queued send whose deadline passed while it waited, typing nothing and replying expired", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const release: Array<() => void> = [];
      const typed: string[] = [];
      const { handler, replies } = build({
        injectIntoPane: vi.fn(async (_pane: number, text: string): Promise<InjectOutcome> => {
          typed.push(text);
          await new Promise<void>((resolve) => release.push(resolve));
          return "sent";
        }),
      });

      // Main waits 15 s for each reply; the first send holds the pane for longer than that.
      const first = handler.handle(send({ text: "one", deadline: NOW + 15_000 }, "req-1"));
      const second = handler.handle(send({ text: "two", deadline: NOW + 15_000 }, "req-2"));
      await vi.waitFor(() => expect(typed).toEqual(["one"]));
      vi.setSystemTime(NOW + 15_001);
      release[0]();
      await Promise.all([first, second]);

      expect(typed).toEqual(["one"]);
      expect(replies.map((reply) => [reply.requestId, reply.ok, reply.error])).toEqual([
        ["req-1", true, null],
        ["req-2", false, "expired"],
      ]);
    });

    it("still types a send that reaches the paste before its deadline", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const { handler, tabs, replies } = build();

      await handler.handle(send({ deadline: NOW + 1 }));

      expect(tabs.injectIntoPane).toHaveBeenCalledTimes(1);
      expect(replies[0]).toMatchObject({ ok: true, outcome: "sent" });
    });

    it("hands the same deadline to the injection as the bound on the paste and on Enter", async () => {
      const seen: InjectOptions[] = [];
      const { handler } = build({
        injectIntoPane: async (_pane, _text, opts) => {
          seen.push(opts);
          return "pasted";
        },
      });
      const deadline = Date.now() + 60_000;

      await handler.handle(send({ deadline }));

      expect(seen.map((opts) => [opts.pasteDeadline, opts.submitDeadline])).toEqual([
        [deadline, deadline],
      ]);
    });

    it("answers expired, not an outcome, when the injection dropped the paste for the deadline", async () => {
      const { handler, replies } = build({ injectIntoPane: async () => "expired" });

      await handler.handle(send({ deadline: Date.now() + 60_000 }));

      expect(replies).toEqual([
        {
          requestId: "req-1",
          ok: false,
          paneId: null,
          text: null,
          outcome: null,
          error: "expired",
        },
      ]);
    });
  });
});

describe("control command handler — read", () => {
  const SCREEN = [
    "\u001b[1mheader\u001b[0m",
    ...Array.from({ length: 300 }, (_, index) => `\u001b[32mrow ${index}\u001b[0m`),
    "",
    "",
  ].join("\n");

  it("replies the last n rows with no escape sequences", async () => {
    const { handler, tabs, replies } = build({ serializePane: vi.fn(() => SCREEN) });
    await handler.handle(command("read", 12, { lines: 3 }));
    expect(tabs.serializePane).toHaveBeenCalledWith(12, 3);
    expect(replies[0]).toEqual({
      requestId: "req-1",
      ok: true,
      paneId: null,
      text: "row 297\nrow 298\nrow 299",
      outcome: null,
      error: null,
    });
  });

  it("reads 200 rows when the command names none, and never more than 2000", async () => {
    const { handler, tabs } = build();
    await handler.handle(command("read", 12));
    await handler.handle(command("read", 12, { lines: 99_999 }, "req-2"));
    expect(tabs.serializePane).toHaveBeenNthCalledWith(1, 12, CONTROL_READ_DEFAULT_LINES);
    expect(tabs.serializePane).toHaveBeenNthCalledWith(2, 12, CONTROL_READ_MAX_LINES);
  });

  it("answers no-target for a pane the window does not hold", async () => {
    const { handler, replies } = build({ serializePane: () => null });
    await handler.handle(command("read", 12, { lines: 10 }));
    expect(replies[0]).toMatchObject({ ok: false, error: "no-target", text: null });
  });
});

describe("control command handler — close", () => {
  it("closes with force, which waives the busy confirmation for that pane", async () => {
    const { handler, tabs, replies } = build();
    await handler.handle(command("close", 12, { force: true }));
    expect(tabs.closePaneById).toHaveBeenCalledWith(12, { force: true });
    expect(replies[0]).toMatchObject({ ok: true, error: null });
  });

  it("closes without force through the normal confirmation", async () => {
    const { handler, tabs } = build();
    await handler.handle(command("close", 12, { force: false }));
    expect(tabs.closePaneById).toHaveBeenCalledWith(12, { force: false });
  });

  it.each([
    ["declined", "not-closed"],
    ["no-target", "no-target"],
  ] as const)("answers %s as %s", async (outcome, error) => {
    const { handler, replies } = build({ closePaneById: async () => outcome });
    await handler.handle(command("close", 12, { force: true }));
    expect(replies[0]).toMatchObject({ ok: false, error });
  });
});

describe("control command handler — every answer", () => {
  it("carries every key, whichever command it answers", async () => {
    const { handler, replies } = build();
    await handler.handle(command("open", 7, { cwd: "/work/a", agent: "codex" }, "r1"));
    await handler.handle(
      command("send", 12, { text: "go", submit: true, expectedAgent: "codex" }, "r2"),
    );
    await handler.handle(command("read", 12, { lines: 5 }, "r3"));
    await handler.handle(command("close", 12, { force: true }, "r4"));
    await handler.handle(command("open", 7, {}, "r5"));

    expect(replies).toHaveLength(5);
    for (const reply of replies) {
      expect(Object.keys(reply).sort()).toEqual(REPLY_KEYS);
    }
  });

  it("answers renderer-error, and does not throw, when a command fails inside", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handler, replies } = build({
      closePaneById: async () => {
        throw new Error("dispose failed");
      },
    });
    await expect(handler.handle(command("close", 12, { force: true }))).resolves.toBeUndefined();
    expect(replies[0]).toMatchObject({ ok: false, error: "renderer-error" });
    expect(warn).toHaveBeenCalled();
  });

  it("ignores a payload that is not a control command, answering nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handler, tabs, replies } = build();
    await handler.handle({ requestId: "r", command: "run", paneId: 7 });
    await handler.handle("send");
    await handler.handle(null);
    expect(replies).toEqual([]);
    expect(tabs.openAgentTab).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
