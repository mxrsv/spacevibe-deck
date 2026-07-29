import { describe, expect, it, vi } from "vitest";
import {
  busyProcesses,
  confirmClose,
  confirmMessage,
  isBusy,
  QUIT_COPY,
} from "./close-guard";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";

const askMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: askMock }));

function info(
  id: number,
  process: string | null,
  cwd: string | null = null,
): PaneProcessInfo {
  const agent =
    process === "claude" || process === "codex" || process === "gemini"
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

  it("treats a pane without a process (session-ended limbo) as not busy", () => {
    expect(isBusy(info(1, null))).toBe(false);
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

  it("is empty when every pane is idle", () => {
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
