import { describe, expect, it, vi } from "vitest";
import {
  busyProcesses,
  confirmClose,
  confirmMessage,
  isBusy,
  QUIT_COPY,
  UPDATE_COPY,
} from "./close-guard";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";
import { freshPaneInfo } from "./pane-info";

const askMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: askMock }));

function info(
  id: number,
  process: string | null,
  cwd: string | null = null,
): PaneProcessInfo {
  const agent =
    process === "claude" ||
    process === "codex" ||
    process === "gemini" ||
    process === "opencode"
      ? process
      : null;
  const kind =
    agent !== null
      ? "agent"
      : process === null
        ? "unknown"
        : ["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh"].includes(process)
          ? "idle-shell"
          : "busy";
  return { id, cwd, process, kind, agent };
}

describe("isBusy", () => {
  it("treats idle shells as not busy", () => {
    for (const shell of ["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh"]) {
      expect(isBusy(info(1, shell))).toBe(false);
    }
  });

  it("treats agents and other foreground processes as busy", () => {
    expect(isBusy(info(1, "claude"))).toBe(true);
    expect(isBusy(info(1, "vim"))).toBe(true);
    expect(isBusy(info(1, "npm"))).toBe(true);
  });

  it("does not treat unknown inspection as named busy state", () => {
    expect(isBusy(info(1, null))).toBe(false);
  });
});

describe("update confirmation copy", () => {
  it("names the install-and-restart action", () => {
    expect(UPDATE_COPY.title).toBe("Install Deck Update");
    expect(UPDATE_COPY.okLabel).toBe("Install & Restart");
    expect(UPDATE_COPY.action).toBe("Install update and restart");
  });

  it("warns that the install is not a normal restart", () => {
    // Deck hands the install to the platform and cannot watch it finish, so
    // the dialog is the only place the user learns the stakes.
    expect(UPDATE_COPY.detail).toMatch(/quit while it installs/);
    expect(UPDATE_COPY.detail).toMatch(/terminated/);
    expect(UPDATE_COPY.detail).toMatch(/downloaded again/);
  });

  it("leaves the close and quit dialogs without extra consequences copy", () => {
    expect(QUIT_COPY.detail).toBeUndefined();
  });
});

describe("confirmMessage — pane count", () => {
  it("counts panes, not deduplicated names", () => {
    // Three panes running claude used to read "claude is still running".
    expect(confirmMessage(["claude"], "Install update and restart", 3)).toBe(
      "3 panes are still running (claude). Install update and restart anyway?",
    );
  });

  it("keeps the singular wording when one pane is busy", () => {
    expect(confirmMessage(["claude"], "Close", 1)).toBe(
      "claude is still running. Close anyway?",
    );
  });

  it("defaults the count to the number of names", () => {
    expect(confirmMessage(["claude", "cargo"], "Quit")).toBe(
      "These processes are still running: claude, cargo. Quit anyway?",
    );
  });
});

describe("busyProcesses", () => {
  it("collects busy names, deduplicated, in order", () => {
    const infos = [
      info(1, "zsh"),
      info(2, "claude"),
      info(3, "vim"),
      info(4, "claude"),
      info(5, null),
    ];
    expect(busyProcesses(infos)).toEqual(["claude", "vim"]);
  });

  it("omits idle and unknown panes from the named process list", () => {
    expect(busyProcesses([info(1, "zsh"), info(2, null)])).toEqual([]);
  });
});

describe("confirmClose with injected PtyClient", () => {
  it("skips dialog when MemoryPtyClient reports idle shells", async () => {
    askMock.mockClear();
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "zsh")]]),
    });
    await expect(confirmClose([1], pty)).resolves.toBe(true);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("prompts when MemoryPtyClient reports a busy agent", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(true);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "claude")]]),
    });
    await expect(confirmClose([1], pty)).resolves.toBe(true);
    expect(askMock).toHaveBeenCalledTimes(1);
  });

  it("prompts with the process name for a non-agent busy pane", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "vim")]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      "vim is still running. Close anyway?",
      expect.objectContaining({ title: "Close Terminal" }),
    );
  });

  it("uses generic fail-safe copy when process inspection is unknown", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, null)]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      "Deck could not verify whether terminal processes are still running. Close anyway?",
      expect.objectContaining({ title: "Close Terminal" }),
    );
  });

  it("uses generic fail-safe copy when the IPC omits a requested pane", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const pty = createMemoryPtyClient();

    await expect(confirmClose([7], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      "Deck could not verify whether terminal processes are still running. Close anyway?",
      expect.objectContaining({ title: "Close Terminal" }),
    );
  });

  it("uses generic fail-safe copy when fresh IPC fails", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(false);
    const base = createMemoryPtyClient();
    const pty = {
      ...base,
      ptyInfo: vi.fn().mockRejectedValue(new Error("WMI unavailable")),
    };

    await expect(confirmClose([3], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledWith(
      "Deck could not verify whether terminal processes are still running. Close anyway?",
      expect.objectContaining({ title: "Close Terminal" }),
    );
  });

  it("fails closed when the native dialog rejects", async () => {
    askMock.mockClear();
    askMock.mockRejectedValue(new Error("dialog unavailable"));
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "claude")]]),
    });

    await expect(confirmClose([1], pty)).resolves.toBe(false);
  });

  it("rejects a second call while a prompt is open, then resets", async () => {
    askMock.mockClear();
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "claude")]]),
    });
    let resolveAsk!: (ok: boolean) => void;
    askMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveAsk = resolve;
      }),
    );

    const first = confirmClose([1], pty);
    await Promise.resolve();
    await Promise.resolve();

    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledTimes(1);

    resolveAsk(true);
    await expect(first).resolves.toBe(true);

    askMock.mockResolvedValue(false);
    await expect(confirmClose([1], pty)).resolves.toBe(false);
    expect(askMock).toHaveBeenCalledTimes(2);
  });
});

describe("confirmClose dialog copy", () => {
  it("uses the quit copy on the quit path", async () => {
    askMock.mockClear();
    askMock.mockResolvedValue(true);
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "claude")]]),
    });
    await confirmClose([1], pty, QUIT_COPY);
    expect(askMock).toHaveBeenCalledWith(
      "claude is still running. Quit anyway?",
      expect.objectContaining({ title: "Quit Deck", okLabel: "Quit" }),
    );
  });
});

describe("freshPaneInfo", () => {
  it("synthesizes unknown snapshots for omitted requested panes", async () => {
    const pty = createMemoryPtyClient({
      infos: new Map([[1, info(1, "zsh")]]),
    });

    await expect(freshPaneInfo([1, 2], pty)).resolves.toEqual([
      info(1, "zsh"),
      { id: 2, cwd: null, process: null, kind: "unknown", agent: null },
    ]);
  });

  it("synthesizes unknown snapshots for every requested pane on IPC failure", async () => {
    const base = createMemoryPtyClient();
    const pty = {
      ...base,
      ptyInfo: vi.fn().mockRejectedValue(new Error("WMI unavailable")),
    };

    await expect(freshPaneInfo([4, 9], pty)).resolves.toEqual([
      { id: 4, cwd: null, process: null, kind: "unknown", agent: null },
      { id: 9, cwd: null, process: null, kind: "unknown", agent: null },
    ]);
  });
});

describe("confirmMessage", () => {
  it("names the single busy process", () => {
    expect(confirmMessage(["claude"])).toBe(
      "claude is still running. Close anyway?",
    );
  });

  it("uses the provided action verb", () => {
    expect(confirmMessage(["claude"], "Quit")).toBe(
      "claude is still running. Quit anyway?",
    );
  });

  it("lists multiple busy processes", () => {
    expect(confirmMessage(["claude", "vim"])).toBe(
      "These processes are still running: claude, vim. Close anyway?",
    );
  });
});
