import { describe, expect, it, vi } from "vitest";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import type { ControlForwarder, ForwardRequest, ForwardResult } from "../control/control-forward";
import { createPaneMirror } from "../control/pane-mirror";
import { PhoneError } from "./phone-error";
import { createPhonePanes } from "./phone-panes";

function reply(fields: Partial<ControlReplyPayload>): ForwardResult {
  return {
    ok: true,
    reply: {
      requestId: "r",
      ok: true,
      paneId: null,
      text: null,
      outcome: null,
      error: null,
      ...fields,
    },
  };
}

function setup(
  over: { windows?: Record<number, string>; known?: boolean; holding?: string | null } = {},
) {
  const requests: ForwardRequest[] = [];
  const opens: { label: string; fields: Record<string, unknown> }[] = [];
  const inputs: [number, string][] = [];
  let answer: ForwardResult = reply({ outcome: "sent" });
  const forwarder: ControlForwarder = {
    forward: async (request) => {
      requests.push(request);
      return answer;
    },
    settle: () => false,
    forgetCaller: () => {},
  };
  let clock = 1000;
  const mirror = createPaneMirror({ now: () => clock });
  const windows = over.windows ?? { 5: "w1", 6: "w1" };
  const panes = createPhonePanes({
    forwarder,
    forwardOpen: async (label, fields) => {
      opens.push({ label, fields });
      return answer;
    },
    mirror,
    windowOf: (id) => windows[id] ?? null,
    sendInput: (id, data) => {
      inputs.push([id, data]);
      return true;
    },
    tree: {
      windowHolding: () => (over.holding === undefined ? null : over.holding),
      isKnownRoot: async () => over.known ?? true,
    },
    focusedWindow: () => "wf",
    mainWindow: () => "wm",
    isDirectory: async () => true,
    log: vi.fn(),
  });
  const report = (id: number, phase: "idle" | "working", agent: string | null) =>
    mirror.report(id, {
      phase,
      attention: "none",
      source: null,
      confidence: "explicit",
      agent,
      pid: agent === null ? null : 9,
    });
  return {
    panes,
    requests,
    opens,
    inputs,
    mirror,
    report,
    setAnswer: (next: ForwardResult) => (answer = next),
    tick: (ms: number) => (clock += ms),
  };
}

describe("phone pane control", () => {
  it("reads through the control read command and returns ANSI-free text", async () => {
    const t = setup();
    t.setAnswer(reply({ text: "ok \u001b[31mred\u001b[0m" }));
    expect(await t.panes.read(5, 20)).toBe("ok red");
    expect(t.requests[0]!.fields).toMatchObject({ command: "read", paneId: 5, lines: 20 });
  });

  it("sends to an agent pane with the mirror's agent as expectedAgent", async () => {
    const t = setup();
    t.report(5, "idle", "claude");
    expect(await t.panes.send(5, "hello", true)).toEqual({ outcome: "sent" });
    expect(t.requests[0]!.fields).toMatchObject({
      command: "send",
      paneId: 5,
      text: "hello",
      submit: true,
      expectedAgent: "claude",
    });
    expect(t.inputs).toEqual([]);
  });

  it("types into a shell pane through the input path with a carriage return", async () => {
    const t = setup();
    t.report(6, "idle", null);
    await t.panes.send(6, "ls -la", true);
    expect(t.inputs).toEqual([[6, "ls -la\r"]]);
    expect(t.requests).toEqual([]);
  });

  it("maps a busy or stale refusal to the protocol's codes", async () => {
    const t = setup();
    t.report(5, "idle", "claude");
    t.setAnswer(reply({ ok: false, outcome: "busy" }));
    await expect(t.panes.send(5, "x", true)).rejects.toMatchObject({ code: "busy" });
    t.setAnswer(reply({ ok: false, error: "not-an-agent-pane" }));
    await expect(t.panes.send(5, "x", true)).rejects.toMatchObject({ code: "not-an-agent-pane" });
    t.setAnswer({ ok: false, error: "renderer-timeout" });
    await expect(t.panes.send(5, "x", true)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a pane that no window owns", async () => {
    const t = setup();
    await expect(t.panes.read(99, 5)).rejects.toBeInstanceOf(PhoneError);
    expect(() => t.panes.input(99, "x")).toThrowError(/gone/);
  });

  it("opens in the window that holds the project, else focused, else main, and returns the id", async () => {
    const held = setup({ holding: "w2" });
    held.setAnswer(reply({ paneId: 40 }));
    expect(
      await held.panes.open({
        projectPath: "/p",
        checkoutPath: "/p",
        agent: "claude",
        prompt: null,
      }),
    ).toEqual({ paneId: 40 });
    expect(held.opens[0]).toMatchObject({
      label: "w2",
      fields: { command: "open", cwd: "/p", agent: "claude" },
    });

    const none = setup();
    none.setAnswer(reply({ paneId: 41 }));
    await none.panes.open({ projectPath: "/p", checkoutPath: "/p", agent: "claude", prompt: null });
    expect(none.opens[0]!.label).toBe("wf");
  });

  it("refuses to open outside the known projects", async () => {
    const t = setup({ known: false });
    await expect(
      t.panes.open({ projectPath: "/etc", checkoutPath: "/etc", agent: "claude", prompt: null }),
    ).rejects.toMatchObject({ code: "outside-root" });
    expect(t.opens).toEqual([]);
  });

  it("delivers the first prompt only once the new agent reads idle, guarded by that agent", async () => {
    const t = setup();
    t.setAnswer(reply({ paneId: 50 }));
    const opened = await t.panes.open({
      projectPath: "/p",
      checkoutPath: "/p",
      agent: "claude",
      prompt: "build it",
    });
    expect(opened).toEqual({ paneId: 50 });
    expect(t.requests).toEqual([]);
    t.report(50, "working", "claude");
    await Promise.resolve();
    expect(t.requests).toEqual([]);
    t.setAnswer(reply({ outcome: "sent" }));
    t.report(50, "idle", "claude");
    await vi.waitFor(() => expect(t.requests).toHaveLength(1));
    expect(t.requests[0]!.fields).toMatchObject({
      command: "send",
      paneId: 50,
      text: "build it",
      submit: true,
      expectedAgent: "claude",
    });
  });
});
