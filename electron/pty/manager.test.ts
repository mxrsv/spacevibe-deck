/**
 * Manager tests with a fake node-pty, so the exit ORDERING can be asserted.
 * That ordering is the part a mocked renderer suite can never see: flush, then
 * announce the exit, then drop the route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PtyManager } from "./manager";

interface Emitted {
  readonly paneId: number;
  readonly event: string;
  readonly payload: unknown;
}

const fakePty = {
  pid: 4242,
  ptsName: "/dev/ttys999",
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
};

vi.mock("./spawn", () => ({
  spawnShell: () => ({ pty: fakePty, ttyName: "ttys999" }),
}));
const terminateSpy = vi.hoisted(() => vi.fn());
interface Foreground {
  readonly pid: number;
  readonly group: number | null;
  readonly name: string | null;
}
/**
 * What the mocked `foregroundProcess` answers — a box, so a case can change it.
 *
 * Hoisted for the reason `terminateSpy` is: the mock factory runs while the
 * module graph is still being imported, before any ordinary module-scope
 * binding in this file has been initialised.
 *
 * The default is a leader whose pid IS its group id — the ordinary case, and
 * the one `kill` below asserts against.
 */
const foreground = vi.hoisted(() => ({
  value: { pid: 4242, group: 4242, name: "claude" } as Foreground | null,
}));
vi.mock("../platform/macos", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readProcessTable: async () => [],
  foregroundProcess: () => foreground.value,
  terminateProcessGroups: terminateSpy,
}));

let emitted: Emitted[];
let unregistered: number[];
let manager: PtyManager;

beforeEach(() => {
  vi.clearAllMocks();
  // A case that changed the foreground job must not decide the next one's.
  foreground.value = { pid: 4242, group: 4242, name: "claude" };
  emitted = [];
  unregistered = [];
  manager = new PtyManager({
    emitToOwner: (paneId, event, payload) => emitted.push({ paneId, event, payload }),
    register: () => {},
    unregister: (paneId) => unregistered.push(paneId),
    assertOwner: () => {},
  });
});

/** Feed bytes through the real batcher, as node-pty's onData would. */
function fireData(text: string): void {
  const handler = fakePty.onData.mock.calls[0]?.[0] as ((chunk: unknown) => void) | undefined;
  handler?.(Buffer.from(text, "utf8"));
}

/** Trigger the exit callback node-pty would have fired. */
function fireExit(): void {
  const handler = fakePty.onExit.mock.calls[0]?.[0] as
    ((event: { exitCode: number }) => void) | undefined;
  handler?.({ exitCode: 0 });
}

describe("PtyManager", () => {
  it("emits opt-in startup milestones without terminal content", () => {
    const previous = process.env.DECK_PTY_STARTUP_TRACE;
    process.env.DECK_PTY_STARTUP_TRACE = "1";
    const writeDiagnostic = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

      manager.write("main", id, "private input");
      fireData("private output\x1b]133;B\x07");
      fireExit();

      const diagnostics = JSON.stringify(writeDiagnostic.mock.calls);
      expect(diagnostics).toContain("spawn_start");
      expect(diagnostics).toContain("pty_created");
      expect(diagnostics).toContain("first_input");
      expect(diagnostics).toContain("first_output");
      expect(diagnostics).toContain("prompt_ready");
      expect(diagnostics).not.toContain("private input");
      expect(diagnostics).not.toContain("private output");
    } finally {
      writeDiagnostic.mockRestore();
      if (previous === undefined) {
        delete process.env.DECK_PTY_STARTUP_TRACE;
      } else {
        process.env.DECK_PTY_STARTUP_TRACE = previous;
      }
    }
  });

  it("announces the exit BEFORE dropping the route", () => {
    manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(["pty:exit"]);
    expect(unregistered).toEqual([1]);
  });

  it("flushes queued output BEFORE announcing the exit", () => {
    // The previous test could not see this: it never fed the batcher, so the
    // queue was empty and `flush()` was a no-op by construction — deleting the
    // flush call could not have failed it. Feed real bytes, then kill.
    manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    fireData("last line of the build log\n");

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(["pty:output", "pty:exit"]);
    expect(emitted[0].payload).toMatchObject({
      data: "last line of the build log\n",
    });
  });

  it("signals the foreground GROUP, never a member pid", () => {
    // `kill(-pid)` on a group member hits nothing, so the foreground job would
    // outlive the pane that owned it.
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    manager.kill("main", id);

    expect(terminateSpy).toHaveBeenCalledWith(4242, 4242);
  });

  it("keeps the route alive through kill so the exit still reaches the owner", () => {
    // The Tauri version unregistered inside kill_pty, so the exit event that
    // followed was dropped with "no route for pane". Here kill only
    // terminates; the exit path owns the teardown.
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    manager.kill("main", id);

    expect(unregistered).toEqual([]);

    fireExit();

    expect(emitted.map((e) => e.event)).toEqual(["pty:exit"]);
    expect(unregistered).toEqual([id]);
  });

  it("runs the exit path only once", () => {
    manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    fireExit();
    fireExit();

    expect(emitted).toHaveLength(1);
  });

  it("kills an unknown pane without throwing", () => {
    // TerminalManager.dispose() hits this on every window close.
    expect(() => manager.kill("main", 999)).not.toThrow();
  });

  it("refuses to write to a pane that no longer exists", () => {
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    fireExit();

    expect(() => manager.write("main", id, "x")).toThrow(/not found/);
  });
});

/**
 * The Agent Board's Stop (spec §5.6, §11.6): end the AGENT, keep the pane.
 *
 * `foregroundProcess` answers the SHELL's own row when nothing else holds the
 * tty, so "bare shell" is a group equal to the shell's pid — not a null answer.
 * Null means the tty was missing from the table. Both are covered below,
 * because only one of them is the case Stop exists to refuse.
 */
describe("killForeground", () => {
  /** A foreground group that is NOT the fake shell's own pid (4242). */
  const AGENT: Foreground = { pid: 5150, group: 5150, name: "claude" };

  it("signals the foreground GROUP and spares the shell's own", async () => {
    foreground.value = AGENT;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    await manager.killForeground("main", id);

    // The pgid is resolved in MAIN: a pgid does not cross IPC, and signalling a
    // group MEMBER's pid would hit nothing. `null` is the shell's own group,
    // deliberately spared — that is the whole difference from `kill`.
    expect(terminateSpy).toHaveBeenCalledWith(5150, null);
  });

  it("leaves the pane itself alive — Stop is not close", async () => {
    foreground.value = AGENT;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    await manager.killForeground("main", id);

    // `terminate` kills the PTY and the exit path then drops the route. Stop
    // must do neither, or it takes away the card it was pressed from.
    expect(fakePty.kill).not.toHaveBeenCalled();
    expect(unregistered).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("does nothing when the pane is already a bare shell", async () => {
    // A shell in the foreground IS its own process group, so the answer here is
    // the shell's row rather than null. Signalling it would close the pane.
    foreground.value = { pid: fakePty.pid, group: fakePty.pid, name: "zsh" };
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    await manager.killForeground("main", id);

    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("signals nothing when the leader was reaped and members still hold the tty", async () => {
    // `group: null` is `foregroundProcess` reporting that it could not
    // establish a group id. A member's pid is not one.
    foreground.value = { pid: 5151, group: null, name: "claude" };
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    await manager.killForeground("main", id);

    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("signals nothing when the tty is missing from the process table", async () => {
    foreground.value = null;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });

    await manager.killForeground("main", id);

    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("refuses a pane another window owns", async () => {
    // The shared manager's `assertOwner` is a no-op, so ownership is only
    // observable against a manager built with a real one.
    const guarded = new PtyManager({
      emitToOwner: () => {},
      register: () => {},
      unregister: () => {},
      assertOwner: (_paneId, windowLabel) => {
        if (windowLabel !== "main") {
          throw new Error("pane is owned by another window");
        }
      },
    });
    const id = guarded.spawn("main", { cols: 80, rows: 24, cwd: null });

    await expect(guarded.killForeground("other", id)).rejects.toThrow(/another window/);
    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("is a no-op for an id with no session", async () => {
    await expect(manager.killForeground("main", 9999)).resolves.toBeUndefined();
    expect(terminateSpy).not.toHaveBeenCalled();
  });
});
