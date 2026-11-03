import { describe, expect, it, vi } from "vitest";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import type { ControlForwarder, ForwardRequest, ForwardResult } from "./control-forward";
import {
  CLOSE_CONFIRM_TIMEOUT_MS,
  FIRST_IDLE_CAP_MS,
  OPEN_BUDGET_MS,
  REQUEST_TIMEOUT_MS,
  createPaneCommands,
} from "./control-pane-commands";
import { createOpenedBy, type OpenedBy } from "./opened-by";
import { createPaneMirror, type PaneMirror, type PaneSnapshot } from "./pane-mirror";

const CALLER = 7;
const WORKER = 12;
const OUTSIDER = 13;
const DIR = "/work/app-worker";
const WINDOWS: Readonly<Record<number, string>> = {
  7: "main",
  12: "main",
  13: "main",
  99: "other",
};

type Report = Omit<PaneSnapshot, "reportedAt">;
const CODEX_IDLE: Report = {
  phase: "idle",
  attention: "none",
  source: null,
  confidence: "explicit",
  agent: "codex",
  pid: 5000,
};
const CODEX_WORKING: Report = { ...CODEX_IDLE, phase: "working" };

const reply = (over: Partial<ControlReplyPayload> = {}): ControlReplyPayload => ({
  requestId: "req",
  ok: true,
  paneId: null,
  text: null,
  outcome: null,
  error: null,
  ...over,
});
const answered = (over: Partial<ControlReplyPayload> = {}): ForwardResult => ({
  ok: true,
  reply: reply(over),
});

type Script = (request: ForwardRequest) => ForwardResult | Promise<ForwardResult>;

function build(
  script: Script,
  options: { mirror?: PaneMirror; now?: () => number; openedBy?: OpenedBy } = {},
) {
  const mirror = options.mirror ?? createPaneMirror({ now: () => 1000 });
  const openedBy = options.openedBy ?? createOpenedBy();
  const forward = vi.fn((request: ForwardRequest) => Promise.resolve(script(request)));
  const forwarder: ControlForwarder = { forward, settle: () => false, forgetCaller: () => {} };
  const markSent = vi.fn<(paneId: number) => void>();
  const log = vi.fn<(message: string) => void>();
  /** Set `live.value` to false to close the caller's pane: its token is gone from then on. */
  const live = { value: true };
  const commands = createPaneCommands({
    forwarder,
    openedBy,
    mirror,
    tokenFor: (paneId) => (paneId === CALLER && !live.value ? null : "token"),
    windowOf: (paneId) => WINDOWS[paneId] ?? null,
    markSent,
    log,
    ...(options.now === undefined ? {} : { now: options.now }),
    isDirectory: async (target) => target === DIR,
  });
  const run = (route: string, fields: Record<string, string>, signal?: AbortSignal) =>
    commands[route]({
      paneId: CALLER,
      args: new URLSearchParams(fields),
      signal: signal ?? new AbortController().signal,
    });
  return { run, forward, markSent, log, mirror, openedBy, live };
}

/** The fields of the single command a test expects to have been pushed. */
function pushed(forward: ReturnType<typeof build>["forward"], index = 0) {
  return forward.mock.calls[index]?.[0];
}

describe("pane open (ORC11)", () => {
  it.each([
    ["no --cwd", { agent: "codex" }, "--cwd is required"],
    ["a relative --cwd", { cwd: "work/a", agent: "codex" }, "--cwd must be an absolute path"],
    ["a directory that does not exist", { cwd: "/nowhere", agent: "codex" }, "existing directory"],
    ["no --agent", { cwd: DIR }, "--agent is required"],
    ["an --agent with a control character", { cwd: DIR, agent: "co\u001bdex" }, "--agent must be"],
    ["a blank --prompt", { cwd: DIR, agent: "codex", prompt: "\u001b[2J  " }, "--prompt is empty"],
    ["an over-long --name", { cwd: DIR, agent: "codex", name: "x".repeat(101) }, "--name must be"],
  ])("answers 400 usage for %s and pushes nothing", async (_name, fields, message) => {
    const { run, forward } = build(() => answered());
    const result = await run("pane/open", fields);
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ ok: false, error: "usage" });
    expect(result.text).toContain(message);
    expect(forward).not.toHaveBeenCalled();
  });

  it("pushes open to the caller's own pane, returns the new pane id, and puts it in the caller's scope", async () => {
    const { run, forward, openedBy } = build(() => answered({ paneId: WORKER }));

    const result = await run("pane/open", { cwd: DIR, agent: "codex", name: " task-1 " });

    expect(result).toMatchObject({
      status: 200,
      json: { ok: true, paneId: WORKER },
      text: String(WORKER),
    });
    expect(pushed(forward)).toMatchObject({
      callerPaneId: CALLER,
      timeoutMs: OPEN_BUDGET_MS,
      fields: {
        command: "open",
        paneId: CALLER,
        cwd: DIR,
        agent: "codex",
        name: "task-1",
        text: null,
        submit: null,
        expectedAgent: null,
        lines: null,
        force: null,
      },
    });
    expect(openedBy.mayAct(CALLER, WORKER, "send")).toBe(true);
    expect(openedBy.mayAct(CALLER, OUTSIDER, "send")).toBe(false);
  });

  it("passes the window's refusal of an agent through as 422 and records nothing", async () => {
    const { run, openedBy } = build(() => answered({ ok: false, error: "unknown-agent" }));
    const result = await run("pane/open", { cwd: DIR, agent: "nope" });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "unknown-agent" });
    expect(openedBy.openedBy(CALLER, WORKER)).toBe(false);
  });

  it("never prints a word the window invented", async () => {
    const { run } = build(() => answered({ ok: false, error: "\u001b[31mboom" }));
    const result = await run("pane/open", { cwd: DIR, agent: "codex" });
    expect(result.json).toEqual({ ok: false, error: "renderer-error" });
    expect(result.text).not.toContain("\u001b");
  });

  it.each([
    ["renderer-timeout", 504],
    ["window-gone", 422],
  ] as const)("answers %s as %i", async (error, status) => {
    const { run } = build(() => ({ ok: false, error }));
    const result = await run("pane/open", { cwd: DIR, agent: "codex" });
    expect(result.status).toBe(status);
    expect(result.json).toEqual({ ok: false, error });
  });

  it("refuses to adopt a pane that is not in the caller's window (a window cannot claim another's pane)", async () => {
    const { run, openedBy, log } = build(() => answered({ paneId: 99 }));
    const result = await run("pane/open", { cwd: DIR, agent: "codex" });
    expect(result.status).toBe(422);
    expect(openedBy.openedBy(CALLER, 99)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not in pane 7's window"));
  });

  it("still puts the pane in scope when its reply came after the call gave up", async () => {
    let late: ((reply: ControlReplyPayload) => void) | undefined;
    const { run, openedBy } = build((request) => {
      late = request.onLate;
      return { ok: false, error: "aborted" };
    });
    await run("pane/open", { cwd: DIR, agent: "codex" });
    expect(openedBy.openedBy(CALLER, WORKER)).toBe(false);

    late?.(reply({ paneId: WORKER }));
    expect(openedBy.openedBy(CALLER, WORKER)).toBe(true);

    // The same check applies to a late reply: another window's pane is not adopted.
    late?.(reply({ paneId: 99 }));
    expect(openedBy.openedBy(CALLER, 99)).toBe(false);
  });

  describe("with --prompt", () => {
    /** Opens the worker, and lets the test decide what its mirror says afterwards. */
    function withPrompt(
      after: (mirror: PaneMirror) => void,
      sendReply: Partial<ControlReplyPayload>,
    ) {
      const mirror = createPaneMirror({ now: () => 1000 });
      const built = build(
        (request) => {
          if (request.fields.command === "open") {
            after(mirror);
            return answered({ paneId: WORKER });
          }
          return answered(sendReply);
        },
        { mirror },
      );
      return { ...built, mirror };
    }

    it("sends it, submitted, once the new agent first reads idle, and says what the send did", async () => {
      const { run, forward, markSent } = withPrompt((mirror) => mirror.report(WORKER, CODEX_IDLE), {
        outcome: "sent",
      });

      const result = await run("pane/open", {
        cwd: DIR,
        agent: "codex",
        prompt: "Task: T1\u001b[2J\nline two",
      });

      expect(result).toMatchObject({
        status: 200,
        json: { ok: true, paneId: WORKER, prompt: "sent" },
        text: `${WORKER}\nprompt: sent`,
      });
      expect(forward).toHaveBeenCalledTimes(2);
      expect(pushed(forward, 1)).toMatchObject({
        callerPaneId: CALLER,
        timeoutMs: REQUEST_TIMEOUT_MS,
        fields: {
          command: "send",
          paneId: WORKER,
          text: "Task: T1\nline two",
          submit: true,
          expectedAgent: "codex",
        },
      });
      expect(markSent).toHaveBeenCalledWith(WORKER);
    });

    it("waits for the idle that comes after the agent started working", async () => {
      const mirror = createPaneMirror({ now: () => 1000 });
      const { run, forward } = build(
        (request) =>
          request.fields.command === "open"
            ? answered({ paneId: WORKER })
            : answered({ outcome: "sent" }),
        { mirror },
      );
      mirror.report(WORKER, CODEX_WORKING);

      const opened = run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });
      await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(forward).toHaveBeenCalledTimes(1);

      mirror.report(WORKER, CODEX_IDLE);
      await expect(opened).resolves.toMatchObject({ json: { prompt: "sent" } });
      expect(forward).toHaveBeenCalledTimes(2);
    });

    it("reports pasted when the window withheld Enter, with the pane left open", async () => {
      const { run } = withPrompt((mirror) => mirror.report(WORKER, CODEX_IDLE), {
        outcome: "pasted",
      });
      const result = await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });
      expect(result.json).toEqual({ ok: true, paneId: WORKER, prompt: "pasted" });
    });

    it("reports the send's refusal as the prompt outcome, with the pane still opened", async () => {
      const { run } = withPrompt((mirror) => mirror.report(WORKER, CODEX_IDLE), {
        ok: false,
        outcome: "stale",
      });
      const result = await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });
      expect(result).toMatchObject({
        status: 200,
        json: { ok: true, paneId: WORKER, prompt: "stale" },
      });
    });

    it("says not-idle, sends nothing and leaves the pane open when the agent never reads idle", async () => {
      const mirror = createPaneMirror({ now: () => 1000 });
      const wait = vi.fn<PaneMirror["wait"]>(async () => ({ reached: false, reason: "cap" }));
      const { run, forward, markSent } = build(() => answered({ paneId: WORKER }), {
        mirror: { ...mirror, wait },
      });

      const result = await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });

      expect(result).toMatchObject({
        status: 200,
        json: { ok: true, paneId: WORKER, prompt: "not-idle" },
      });
      expect(wait).toHaveBeenCalledWith(
        WORKER,
        "idle",
        expect.objectContaining({ capMs: FIRST_IDLE_CAP_MS }),
      );
      expect(forward).toHaveBeenCalledTimes(1);
      expect(markSent).not.toHaveBeenCalled();
    });

    it("does not call an exited agent idle", async () => {
      const { run, forward } = withPrompt(
        (mirror) => mirror.report(WORKER, { ...CODEX_IDLE, phase: "exited" }),
        { outcome: "sent" },
      );
      const result = await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });
      expect(result.json).toMatchObject({ prompt: "not-idle" });
      expect(forward).toHaveBeenCalledTimes(1);
    });

    it("types nothing after the caller hung up", async () => {
      const mirror = createPaneMirror({ now: () => 1000 });
      const hangup = new AbortController();
      const { run, forward } = build(() => answered({ paneId: WORKER }), { mirror });

      const opened = run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" }, hangup.signal);
      await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(1));
      hangup.abort();
      mirror.report(WORKER, CODEX_IDLE);
      await opened;

      expect(forward).toHaveBeenCalledTimes(1);
    });

    it("keeps open, the idle wait and the send inside one budget the shim's curl outlasts", async () => {
      let clock = 0;
      const mirror = createPaneMirror({ now: () => 1000 });
      const wait = vi.fn<PaneMirror["wait"]>(async () => ({ reached: false, reason: "cap" }));
      const { run } = build(
        () => {
          clock += 50_000; // the open itself took 50 s
          return answered({ paneId: WORKER });
        },
        { mirror: { ...mirror, wait }, now: () => clock },
      );

      await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });

      // 90 s budget - 50 s spent - 15 s kept back for the send.
      expect(wait).toHaveBeenCalledWith(
        WORKER,
        "idle",
        expect.objectContaining({ capMs: OPEN_BUDGET_MS - 50_000 - REQUEST_TIMEOUT_MS }),
      );
    });

    it("gives the idle wait no time at all when the open used the budget up", async () => {
      let clock = 0;
      const mirror = createPaneMirror({ now: () => 1000 });
      const wait = vi.fn<PaneMirror["wait"]>(async () => ({ reached: false, reason: "cap" }));
      const { run } = build(
        () => {
          clock += 89_000;
          return answered({ paneId: WORKER });
        },
        { mirror: { ...mirror, wait }, now: () => clock },
      );
      const result = await run("pane/open", { cwd: DIR, agent: "codex", prompt: "go" });
      expect(wait).toHaveBeenCalledWith(WORKER, "idle", expect.objectContaining({ capMs: 0 }));
      expect(result.json).toMatchObject({ prompt: "not-idle" });
    });
  });
});

describe("pane send (ORC12, ORC23)", () => {
  const worker = (options: { mirror?: boolean } = {}) => {
    const built = build(() => answered({ outcome: "sent" }));
    built.openedBy.record(WORKER, CALLER);
    if (options.mirror !== false) built.mirror.report(WORKER, CODEX_IDLE);
    return built;
  };

  it.each([
    ["a missing id", { text: "go" }],
    ["a zero id", { id: "0", text: "go" }],
    ["an id that is not a number", { id: "12abc", text: "go" }],
    ["no text", { id: String(WORKER) }],
    ["text that is only controls", { id: String(WORKER), text: "\u001b[2J\u0007\u0000" }],
    ["text that is only whitespace", { id: String(WORKER), text: " \n\t " }],
  ])("answers 400 usage for %s", async (_name, fields) => {
    const { run, forward, markSent } = worker();
    const result = await run("pane/send", fields);
    expect(result.status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("refuses a pane the caller did not open with the answer a missing pane gets, forwarding nothing", async () => {
    const { run, forward, markSent, mirror } = worker();
    mirror.report(OUTSIDER, CODEX_IDLE);
    const outsider = await run("pane/send", { id: String(OUTSIDER), text: "go" });
    const missing = await run("pane/send", { id: "4040", text: "go" });
    expect(outsider.status).toBe(403);
    expect(outsider).toEqual(missing);
    expect(forward).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("never sends to the caller's own pane", async () => {
    const { run, forward, mirror } = worker();
    mirror.report(CALLER, { ...CODEX_IDLE, agent: "claude" });
    const result = await run("pane/send", { id: String(CALLER), text: "go" });
    expect(result.status).toBe(403);
    expect(result.json).toEqual({ ok: false, error: "forbidden" });
    expect(forward).not.toHaveBeenCalled();
  });

  it.each([
    ["has no mirror report", false],
    ["runs a shell", true],
  ])("answers 422 not-an-agent-pane when the pane %s, forwarding nothing", async (_name, shell) => {
    const { run, forward, markSent, mirror } = worker({ mirror: false });
    if (shell) mirror.report(WORKER, { ...CODEX_IDLE, agent: null, pid: null });
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "not-an-agent-pane" });
    expect(forward).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("marks the send, then forwards the cleaned text with the agent main saw and Enter on", async () => {
    const order: string[] = [];
    const { run, forward, markSent } = worker();
    markSent.mockImplementation(() => order.push("markSent"));
    forward.mockImplementation(async () => {
      order.push("forward");
      return answered({ outcome: "sent" });
    });

    const result = await run("pane/send", {
      id: String(WORKER),
      text: "\u001b[31mFirst\u001b[0m\u0007 line\r\nsecond\tline\u0000",
    });

    expect(order).toEqual(["markSent", "forward"]);
    expect(markSent).toHaveBeenCalledWith(WORKER);
    expect(result).toEqual({ status: 200, json: { ok: true, outcome: "sent" }, text: "sent" });
    expect(pushed(forward)).toMatchObject({
      callerPaneId: CALLER,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fields: {
        command: "send",
        paneId: WORKER,
        text: "First line\nsecond\tline",
        submit: true,
        expectedAgent: "codex",
        cwd: null,
        agent: null,
        name: null,
        lines: null,
        force: null,
      },
    });
  });

  describe("two sends to one pane", () => {
    /** Each forward waits for the test to release it, and the order of events is recorded. */
    function heldForwards() {
      const order: string[] = [];
      const release: Array<() => void> = [];
      const built = worker();
      let counter = 0;
      built.markSent.mockImplementation((pane) => order.push(`markSent ${pane}`));
      built.forward.mockImplementation(async () => {
        const index = (counter += 1);
        order.push(`forward ${index}`);
        await new Promise<void>((resolve) => release.push(resolve));
        order.push(`reply ${index}`);
        return answered({ outcome: "sent" });
      });
      return { ...built, order, release };
    }

    it("marks the second only when it starts, after the first has been answered", async () => {
      const { run, order, release } = heldForwards();

      const first = run("pane/send", { id: String(WORKER), text: "one" });
      const second = run("pane/send", { id: String(WORKER), text: "two" });
      await vi.waitFor(() => expect(order).toEqual([`markSent ${WORKER}`, "forward 1"]));
      // Both are in flight, yet only one has been marked: the second send has not begun.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order).toEqual([`markSent ${WORKER}`, "forward 1"]);

      release[0]();
      await vi.waitFor(() => expect(release).toHaveLength(2));
      expect(order).toEqual([
        `markSent ${WORKER}`,
        "forward 1",
        "reply 1",
        `markSent ${WORKER}`,
        "forward 2",
      ]);
      release[1]();
      await expect(Promise.all([first, second])).resolves.toEqual([
        { status: 200, json: { ok: true, outcome: "sent" }, text: "sent" },
        { status: 200, json: { ok: true, outcome: "sent" }, text: "sent" },
      ]);
    });

    it("does not make a send to another pane wait", async () => {
      const { run, order, release, openedBy, mirror } = heldForwards();
      openedBy.record(OUTSIDER, CALLER);
      mirror.report(OUTSIDER, CODEX_IDLE);

      void run("pane/send", { id: String(WORKER), text: "one" });
      void run("pane/send", { id: String(OUTSIDER), text: "two" });

      await vi.waitFor(() => expect(release).toHaveLength(2));
      expect(order).toEqual([
        `markSent ${WORKER}`,
        "forward 1",
        `markSent ${OUTSIDER}`,
        "forward 2",
      ]);
      release.forEach((resolve) => resolve());
    });

    it("lets the next send through after one failed", async () => {
      const { run, forward, markSent } = worker();
      forward.mockRejectedValueOnce(new Error("window exploded"));

      await expect(run("pane/send", { id: String(WORKER), text: "one" })).rejects.toThrow(
        "window exploded",
      );
      const next = await run("pane/send", { id: String(WORKER), text: "two" });

      expect(next.status).toBe(200);
      expect(markSent).toHaveBeenCalledTimes(2);
    });

    it.each([
      [
        "its pane closed",
        (built: ReturnType<typeof heldForwards>) => {
          built.live.value = false;
        },
      ],
      [
        "its claim on the target ended with the pane it opened",
        (built: ReturnType<typeof heldForwards>) => built.openedBy.forget(WORKER),
      ],
    ])(
      "answers a queued send as a missing pane and forwards nothing once the caller lost standing: %s",
      async (_name, strand) => {
        const built = heldForwards();
        const first = built.run("pane/send", { id: String(WORKER), text: "one" });
        const second = built.run("pane/send", { id: String(WORKER), text: "two" });
        await vi.waitFor(() => expect(built.release).toHaveLength(1));

        // `forgetPane` ran while the first send was in flight and the second was queued behind it.
        strand(built);
        built.release[0]();
        await first;

        const missing = await built.run("pane/send", { id: "4040", text: "go" });
        await expect(second).resolves.toEqual(missing);
        expect(missing.status).toBe(403);
        expect(built.markSent).toHaveBeenCalledTimes(1);
        expect(built.forward).toHaveBeenCalledTimes(1);
      },
    );

    it("types nothing for a queued send whose caller hung up while it waited", async () => {
      const { run, order, release, markSent } = heldForwards();
      const hangup = new AbortController();

      const first = run("pane/send", { id: String(WORKER), text: "one" });
      const second = run("pane/send", { id: String(WORKER), text: "two" }, hangup.signal);
      await vi.waitFor(() => expect(release).toHaveLength(1));
      hangup.abort();
      release[0]();

      await expect(second).resolves.toMatchObject({
        status: 422,
        json: { ok: false, error: "aborted" },
      });
      await first;
      expect(markSent).toHaveBeenCalledTimes(1);
      expect(order).not.toContain("forward 2");
    });
  });

  it("pastes without Enter for --no-submit", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ outcome: "pasted" }));
    const result = await run("pane/send", { id: String(WORKER), text: "draft", no_submit: "1" });
    expect(pushed(forward)?.fields.submit).toBe(false);
    expect(result).toMatchObject({
      status: 200,
      json: { ok: true, outcome: "pasted" },
      text: "pasted",
    });
  });

  it("says a stale send was not submitted and may have left the text in the pane, so no one assumes it was never typed", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ ok: false, outcome: "stale" }));
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.text).toContain("not submitted");
    expect(result.text).toContain("may already be in the pane");
    expect(result.text).not.toContain("nothing was typed");
  });

  it("says an expired send typed nothing", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ ok: false, error: "expired" }));
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "expired" });
    expect(result.text).toContain("nothing was typed");
  });

  it.each(["failed", "no-target", "stale", "busy"] as const)(
    "answers 422 %s when the window could not deliver",
    async (outcome) => {
      const { run, forward } = worker();
      forward.mockResolvedValue(answered({ ok: false, outcome }));
      const result = await run("pane/send", { id: String(WORKER), text: "go" });
      expect(result.status).toBe(422);
      expect(result.json).toEqual({ ok: false, error: outcome });
    },
  );

  it("passes the window's own refusal through when it gave no outcome", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ ok: false, error: "not-an-agent-pane" }));
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.json).toEqual({ ok: false, error: "not-an-agent-pane" });
  });

  it("does not count an outcome the window made up as a delivery", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ ok: true, outcome: "delivered" }));
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "renderer-error" });
  });

  it("does not count a failed reply that says sent", async () => {
    const { run, forward } = worker();
    forward.mockResolvedValue(answered({ ok: false, outcome: "sent" }));
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "renderer-error" });
  });

  it.each([
    ["renderer-timeout", 504],
    ["window-gone", 422],
  ] as const)("answers %s as %i", async (error, status) => {
    const { run, forward } = worker();
    forward.mockResolvedValue({ ok: false, error });
    const result = await run("pane/send", { id: String(WORKER), text: "go" });
    expect(result.status).toBe(status);
    expect(result.json).toEqual({ ok: false, error });
  });
});

describe("pane read (ORC13, ORC21)", () => {
  const DONE = [
    "some earlier output",
    "DECK_WORKER_DONE",
    "task: T1",
    "summary: added the parser",
    "files: src/a.ts",
    "checks: npm test passed",
    "handoff: none",
  ].join("\n");

  const reader = (text: string) => {
    const built = build(() => answered({ text }));
    built.openedBy.record(WORKER, CALLER);
    return built;
  };

  it.each([
    ["zero", "0"],
    ["too many", "2001"],
    ["not a number", "many"],
    ["negative", "-3"],
    ["fractional", "2.5"],
  ])("answers 400 usage for --lines that is %s", async (_name, lines) => {
    const { run, forward } = reader("x");
    const result = await run("pane/read", { id: String(WORKER), lines });
    expect(result.status).toBe(400);
    expect(result.text).toContain("--lines must be a number from 1 to 2000");
    expect(forward).not.toHaveBeenCalled();
  });

  it("reads 200 rows unless asked otherwise, and the given number when asked", async () => {
    const { run, forward } = reader("screen");
    await run("pane/read", { id: String(WORKER) });
    await run("pane/read", { id: String(WORKER), lines: "40" });
    await run("pane/read", { id: String(WORKER), lines: "2000" });
    expect(forward.mock.calls.map(([request]) => request.fields.lines)).toEqual([200, 40, 2000]);
    expect(pushed(forward)).toMatchObject({
      callerPaneId: CALLER,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fields: { command: "read", paneId: WORKER },
    });
  });

  it("reads the caller's own pane and a pane it opened, and nothing else", async () => {
    const { run, forward } = reader("screen");
    expect((await run("pane/read", { id: String(CALLER) })).status).toBe(200);
    expect((await run("pane/read", { id: String(WORKER) })).status).toBe(200);
    const outsider = await run("pane/read", { id: String(OUTSIDER) });
    expect(outsider.status).toBe(403);
    expect(outsider.json).toEqual({ ok: false, error: "forbidden" });
    expect(forward).toHaveBeenCalledTimes(2);
  });

  it("returns the text as plain text, and as JSON with ok", async () => {
    const { run } = reader("line one\nline two");
    const result = await run("pane/read", { id: String(WORKER) });
    expect(result).toEqual({
      status: 200,
      json: { ok: true, text: "line one\nline two" },
      text: "line one\nline two",
    });
  });

  it("strips what the window left in: escape sequences and control characters other than newline and tab", async () => {
    const { run } = reader("a\u001b[31mred\u001b[0m\u0008b\tc\u0000\nd");
    const result = await run("pane/read", { id: String(WORKER) });
    expect(result.text).toBe("aredb\tc\nd");
  });

  it("returns the last complete envelope as JSON with --envelope, from the most rows the pane can give", async () => {
    const { run, forward } = reader(`${DONE}\nand then a long answer`);
    const result = await run("pane/read", { id: String(WORKER), envelope: "1", lines: "5" });

    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      ok: true,
      envelope: {
        kind: "done",
        task: "T1",
        summary: "added the parser",
        files: "src/a.ts",
        checks: "npm test passed",
        handoff: "none",
      },
    });
    expect(JSON.parse(result.text)).toEqual(result.json.envelope);
    expect(pushed(forward)?.fields.lines).toBe(2000);
  });

  it("reads an envelope a TUI drew behind a gutter", async () => {
    const { run } = reader(
      DONE.split("\n")
        .map((line) => `│ ${line}`)
        .join("\n"),
    );
    const result = await run("pane/read", { id: String(WORKER), envelope: "1" });
    expect(result.json.envelope).toMatchObject({ kind: "done", task: "T1" });
  });

  it("says none when the pane holds no complete envelope", async () => {
    const { run } = reader("DECK_WORKER_DONE\ntask: T1\nsummary: half");
    const result = await run("pane/read", { id: String(WORKER), envelope: "1" });
    expect(result).toEqual({ status: 200, json: { ok: true, envelope: null }, text: "none" });
  });

  it("answers 422 when the window cannot read the pane", async () => {
    const { run, forward } = reader("x");
    forward.mockResolvedValue(answered({ ok: false, error: "no-target" }));
    const result = await run("pane/read", { id: String(WORKER) });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "no-target" });
  });

  it("answers 504 when the window does not answer", async () => {
    const { run, forward } = reader("x");
    forward.mockResolvedValue({ ok: false, error: "renderer-timeout" });
    const result = await run("pane/read", { id: String(WORKER) });
    expect(result.status).toBe(504);
  });
});

describe("pane close (ORC7, ORC16)", () => {
  const closer = (report?: Report) => {
    const built = build(() => answered());
    built.openedBy.record(WORKER, CALLER);
    if (report !== undefined) built.mirror.report(WORKER, report);
    return built;
  };

  it("never closes the caller's own pane, with or without --force", async () => {
    const { run, forward } = closer();
    const plain = await run("pane/close", { id: String(CALLER) });
    const forced = await run("pane/close", { id: String(CALLER), force: "1" });
    for (const result of [plain, forced]) {
      expect(result.status).toBe(403);
      expect(result.json).toEqual({ ok: false, error: "forbidden" });
    }
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a pane the caller did not open with the answer a missing pane gets", async () => {
    const { run, forward } = closer();
    const outsider = await run("pane/close", { id: String(OUTSIDER), force: "1" });
    const missing = await run("pane/close", { id: "4040", force: "1" });
    expect(outsider.status).toBe(403);
    expect(outsider).toEqual(missing);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a working pane without --force, and says so as 409 busy", async () => {
    const { run, forward } = closer(CODEX_WORKING);
    const result = await run("pane/close", { id: String(WORKER) });
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ ok: false, error: "busy", phase: "working" });
    expect(result.text).toContain("--force");
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses a pane that asked for the user without --force", async () => {
    const { run, forward } = closer({ ...CODEX_IDLE, attention: "requested", source: "hook" });
    const result = await run("pane/close", { id: String(WORKER) });
    expect(result.status).toBe(409);
    expect(result.json).toMatchObject({ error: "busy", attention: "requested" });
    expect(forward).not.toHaveBeenCalled();
  });

  it("closes a working pane with --force, telling the window to skip its confirmation", async () => {
    const { run, forward } = closer(CODEX_WORKING);
    const result = await run("pane/close", { id: String(WORKER), force: "1" });
    expect(result).toMatchObject({ status: 200, json: { ok: true } });
    expect(pushed(forward)).toMatchObject({
      callerPaneId: CALLER,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fields: { command: "close", paneId: WORKER, force: true, text: null, submit: null },
    });
  });

  it("closes an idle pane without --force, and gives the user time to answer the window's dialog", async () => {
    const { run, forward } = closer(CODEX_IDLE);
    const result = await run("pane/close", { id: String(WORKER) });
    expect(result.status).toBe(200);
    expect(pushed(forward)).toMatchObject({
      timeoutMs: CLOSE_CONFIRM_TIMEOUT_MS,
      fields: { command: "close", force: false },
    });
    expect(CLOSE_CONFIRM_TIMEOUT_MS).toBeLessThan(OPEN_BUDGET_MS);
  });

  it("closes a pane main has no report for (a shell tab) without --force", async () => {
    const { run, forward } = closer();
    expect((await run("pane/close", { id: String(WORKER) })).status).toBe(200);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("answers 422 not-closed when the user cancelled the window's dialog", async () => {
    const { run, forward } = closer(CODEX_IDLE);
    forward.mockResolvedValue(answered({ ok: false, error: "not-closed" }));
    const result = await run("pane/close", { id: String(WORKER) });
    expect(result.status).toBe(422);
    expect(result.json).toEqual({ ok: false, error: "not-closed" });
  });

  it("answers 504 when the window does not answer in time", async () => {
    const { run, forward } = closer(CODEX_IDLE);
    forward.mockResolvedValue({ ok: false, error: "renderer-timeout" });
    expect((await run("pane/close", { id: String(WORKER), force: "1" })).status).toBe(504);
  });
});
