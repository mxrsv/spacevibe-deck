import { beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.hoisted(() =>
  vi.fn(
    async (
      _event: string,
      _handler: (event: { payload: unknown }) => void,
    ): Promise<() => void> =>
      () => {},
  ),
);
const onCloseRequestedMock = vi.hoisted(() => vi.fn(async () => () => {}));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/api/window", () => ({
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
};

const idleRequest: CloseRequest = {
  requestId: 8,
  busyProcesses: [],
  busyPanes: 0,
  fullyNamed: true,
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
    expect(
      closeRequestOrNull({ ...busyRequest, busyProcesses: "claude" }),
    ).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, busyPanes: null })).toBeNull();
    expect(closeRequestOrNull(null)).toBeNull();
    expect(closeRequestOrNull(42)).toBeNull();
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

  it("prompts with the Rust census and confirms on accept", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)(busyRequest);
    // Two panes, one name — the message must say "2 panes", not "claude".
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("2 panes are still running"),
    );
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
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("could not verify"),
    );
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
