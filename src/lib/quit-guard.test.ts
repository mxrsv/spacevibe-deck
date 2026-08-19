import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.hoisted(() =>
  vi.fn(
    async (_event: string, _handler: (event: { payload: unknown }) => void): Promise<() => void> =>
      () => {},
  ),
);
const onCloseRequestedMock = vi.hoisted(() => vi.fn(async () => () => {}));
vi.mock("../host/bridge", () => ({ listen: listenMock }));
vi.mock("../host/window-host", () => ({
  getCurrentWindow: () => ({ onCloseRequested: onCloseRequestedMock }),
}));

import {
  closeRequestOrNull,
  createQuitFlow,
  installQuitGuard,
  type CloseRequest,
  type QuitFlowDeps,
} from "./quit-guard";

const busyRequest: CloseRequest = {
  requestId: 7,
  busyProcesses: ["claude"],
  busyPanes: 2,
  fullyNamed: true,
  dirtyFiles: [],
};

const idleRequest: CloseRequest = {
  requestId: 8,
  busyProcesses: [],
  busyPanes: 0,
  fullyNamed: true,
  dirtyFiles: [],
};

/** No busy pane at all — a window holding only file tabs (spec §6). */
const dirtyOnlyRequest: CloseRequest = {
  requestId: 11,
  busyProcesses: [],
  busyPanes: 0,
  fullyNamed: true,
  dirtyFiles: ["/r/src/index.ts"],
};

function makeDeps(overrides: Partial<QuitFlowDeps> = {}): QuitFlowDeps & {
  ask: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  return {
    ask: vi.fn().mockResolvedValue(true),
    flush: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

describe("closeRequestOrNull", () => {
  it("accepts a well-formed census payload", () => {
    expect(closeRequestOrNull(busyRequest)).toEqual(busyRequest);
  });

  it("rejects every malformed shape rather than guessing a request id", () => {
    expect(closeRequestOrNull({})).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, requestId: "7" })).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, busyProcesses: "claude" })).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, busyPanes: null })).toBeNull();
    expect(closeRequestOrNull(null)).toBeNull();
    expect(closeRequestOrNull(42)).toBeNull();
  });

  // The validator REBUILDS its object from known keys and discards the rest, so
  // a census field it does not know about is dropped on arrival — with the
  // sender and the typecheck both green. These three lock the widening in.
  it("carries dirtyFiles through instead of discarding it", () => {
    expect(closeRequestOrNull(dirtyOnlyRequest)?.dirtyFiles).toEqual(["/r/src/index.ts"]);
  });

  it("treats an absent dirtyFiles as none rather than refusing to answer", () => {
    // Refusing would leave the request unanswered, and Rust blocks the close on
    // an answer — an older payload shape must still be closable.
    const { dirtyFiles: _omitted, ...withoutField } = busyRequest;
    expect(closeRequestOrNull(withoutField)?.dirtyFiles).toEqual([]);
  });

  it("drops a malformed dirty entry rather than repairing it", () => {
    expect(
      closeRequestOrNull({ ...busyRequest, dirtyFiles: ["/r/a.ts", 7, null] })?.dirtyFiles,
    ).toEqual(["/r/a.ts"]);
  });
});

describe("createQuitFlow", () => {
  it("never prompts when Rust reports nothing busy, and confirms straight away", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)(idleRequest);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledWith(8);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("prompts for unsaved files even with no busy pane at all", async () => {
    // `busyPanes === 0` alone used to auto-confirm, so a window holding only
    // file tabs quit with unsaved edits and no dialog (spec §6).
    const deps = makeDeps();
    await createQuitFlow(deps)(dirtyOnlyRequest);
    expect(deps.ask).toHaveBeenCalledWith(expect.stringContaining("index.ts has unsaved changes"));
    expect(deps.confirm).toHaveBeenCalledWith(11);
  });

  it("names a busy agent AND unsaved files in ONE dialog", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)({
      ...busyRequest,
      dirtyFiles: ["/r/src/index.ts"],
    });
    expect(deps.ask).toHaveBeenCalledTimes(1);
    const message = deps.ask.mock.calls[0][0] as string;
    expect(message).toContain("2 panes are still running");
    expect(message).toContain("index.ts has unsaved changes");
  });

  it("names unsaved files in the unknown-inspection copy too", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)({
      ...busyRequest,
      fullyNamed: false,
      dirtyFiles: ["/r/src/index.ts"],
    });
    const message = deps.ask.mock.calls[0][0] as string;
    expect(message).toContain("could not verify");
    expect(message).toContain("index.ts has unsaved changes");
  });

  it("prompts when the census could not classify a pane", async () => {
    // `unknown` is not busy, so an unreadable process table reports zero busy
    // panes with `fullyNamed: false`. Auto-confirming there killed agents with
    // no prompt — `quit-flow.ts`'s `allIdle` states the rule and nothing on
    // this side enforced it.
    const deps = makeDeps();
    await createQuitFlow(deps)({
      requestId: 12,
      busyProcesses: [],
      busyPanes: 0,
      fullyNamed: false,
      dirtyFiles: [],
    });
    expect(deps.ask).toHaveBeenCalledWith(expect.stringContaining("could not verify"));
  });

  it("prompts with the Rust census and confirms on accept", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)(busyRequest);
    // Two panes, one name — the message must say "2 panes", not "claude".
    expect(deps.ask).toHaveBeenCalledWith(expect.stringContaining("2 panes are still running"));
    expect(deps.confirm).toHaveBeenCalledWith(7);
  });

  it("cancels the request when the user declines — never leaves it dangling", async () => {
    const deps = makeDeps({ ask: vi.fn().mockResolvedValue(false) });
    await createQuitFlow(deps)(busyRequest);
    expect(deps.cancel).toHaveBeenCalledWith(7);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.flush).not.toHaveBeenCalled();
  });

  it("cancels the request when the dialog itself fails", async () => {
    const deps = makeDeps({
      ask: vi.fn().mockRejectedValue(new Error("no dialog")),
    });
    await createQuitFlow(deps)(busyRequest);
    expect(deps.cancel).toHaveBeenCalledWith(7);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("uses the unknown-inspection copy when Rust could not name everything", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)({ ...busyRequest, fullyNamed: false });
    expect(deps.ask).toHaveBeenCalledWith(expect.stringContaining("could not verify"));
  });

  it("still confirms when the flush fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = makeDeps({
        flush: vi.fn().mockRejectedValue(new Error("disk full")),
      });
      await createQuitFlow(deps)(idleRequest);
      expect(deps.confirm).toHaveBeenCalledWith(8);
    } finally {
      warn.mockRestore();
    }
  });

  it("cancels a second request instead of dropping it while a prompt is open", async () => {
    let release!: (ok: boolean) => void;
    const deps = makeDeps({
      ask: vi.fn(() => new Promise<boolean>((r) => (release = r))),
    });
    const flow = createQuitFlow(deps);
    const first = flow(busyRequest);
    await flow({ ...busyRequest, requestId: 9 });

    // The old flow silently dropped the re-entrant call. Rust is now waiting
    // on an answer for every request it sends, so a drop hangs that close.
    expect(deps.cancel).toHaveBeenCalledWith(9);
    release(true);
    await first;
    expect(deps.confirm).toHaveBeenCalledWith(7);
  });
});

describe("installQuitGuard", () => {
  beforeEach(() => {
    listenMock.mockClear();
    onCloseRequestedMock.mockClear();
  });

  it("never registers a JS close listener — Tauri would auto-prevent the close", async () => {
    await installQuitGuard({ quit: makeDeps(), close: makeDeps() });
    expect(onCloseRequestedMock).not.toHaveBeenCalled();
  });

  it("listens for exactly the two Rust-driven events", async () => {
    await installQuitGuard({ quit: makeDeps(), close: makeDeps() });
    expect(listenMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      "quit-requested",
      "window:close-requested",
    ]);
  });

  it("asks about unsaved files that arrive on the wire, end to end", async () => {
    // The regression gate the plan asks for: validator + flow together. Revert
    // the validator's `dirtyFiles` widening and this goes red — the field is
    // dropped on arrival, `busyPanes === 0` auto-confirms, and the unsaved file
    // dies without a prompt.
    const quit = makeDeps();
    await installQuitGuard({ quit, close: makeDeps() });
    const handler = listenMock.mock.calls.find(
      (call) => call[0] === "quit-requested",
    )?.[1] as (event: { payload: unknown }) => void;

    handler({
      payload: {
        requestId: 3,
        busyProcesses: [],
        busyPanes: 0,
        fullyNamed: true,
        dirtyFiles: ["/r/src/index.ts"],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(quit.ask).toHaveBeenCalledWith(expect.stringContaining("index.ts has unsaved changes"));
  });

  it("drops a malformed payload without answering Rust with a guessed id", async () => {
    const quit = makeDeps();
    await installQuitGuard({ quit, close: makeDeps() });
    const handler = listenMock.mock.calls.find(
      (call) => call[0] === "quit-requested",
    )?.[1] as (event: { payload: unknown }) => void;

    handler({ payload: { requestId: "not-a-number" } });
    await Promise.resolve();

    expect(quit.confirm).not.toHaveBeenCalled();
    expect(quit.cancel).not.toHaveBeenCalled();
  });
});
