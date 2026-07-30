// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { copyTerminalSelection, pasteIntoTerminal } from "./terminal-clipboard";

interface PasteHarness {
  readonly terminal: {
    getSelection(): string;
    hasSelection(): boolean;
    paste: ReturnType<typeof vi.fn<(text: string) => void>>;
  };
  readonly readText: ReturnType<typeof vi.fn<() => Promise<string>>>;
  readonly writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  readonly reportError: ReturnType<typeof vi.fn<(message: string) => void>>;
}

function createPasteHarness(selection = ""): PasteHarness {
  return {
    terminal: {
      getSelection: () => selection,
      hasSelection: () => selection !== "",
      paste: vi.fn(),
    },
    readText: vi.fn(async () => "line one\r\nline two"),
    writeText: vi.fn(async () => {}),
    reportError: vi.fn(),
  };
}

describe("copyTerminalSelection / pasteIntoTerminal", () => {
  it("routes paste through Terminal.paste so xterm brackets it and normalizes CRLF", async () => {
    const h = createPasteHarness();

    pasteIntoTerminal(h.terminal, {
      readText: h.readText,
      writeText: h.writeText,
      reportError: h.reportError,
    });
    await vi.waitFor(() => expect(h.terminal.paste).toHaveBeenCalledTimes(1));

    // Terminal.paste applies prepareTextForTerminal (\r?\n -> \r) and
    // bracketTextForPaste (DECSET 2004). Writing to the PTY directly would skip
    // both: Windows clipboard text is CRLF, and CR into a ConPTY is Enter for
    // PSReadLine, so a multi-line paste would submit N times.
    expect(h.terminal.paste).toHaveBeenCalledWith("line one\r\nline two");
  });

  it("copies a non-empty selection and reports a clipboard failure", async () => {
    const h = createPasteHarness("selected");
    h.writeText.mockRejectedValueOnce(new Error("denied"));

    copyTerminalSelection(h.terminal, {
      readText: h.readText,
      writeText: h.writeText,
      reportError: h.reportError,
    });

    await vi.waitFor(() =>
      expect(h.reportError).toHaveBeenCalledWith(
        "Couldn't copy the terminal selection",
      ),
    );
  });

  it("does not write an empty selection", async () => {
    const h = createPasteHarness();

    copyTerminalSelection(h.terminal, {
      readText: h.readText,
      writeText: h.writeText,
      reportError: h.reportError,
    });
    await Promise.resolve();

    expect(h.writeText).not.toHaveBeenCalled();
  });
});
