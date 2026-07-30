import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { reportChromeMessage } from "../chrome/events";

interface TerminalClipboardTarget {
  getSelection(): string;
  hasSelection(): boolean;
  /**
   * xterm's own paste entry point — applies prepareTextForTerminal (\r?\n ->
   * \r) and bracketTextForPaste (DECSET 2004). Writing clipboard bytes to the
   * PTY directly skips both.
   */
  paste(text: string): void;
}

interface ClipboardDependencies {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  reportError(message: string): void;
}

const DEFAULT_DEPENDENCIES: ClipboardDependencies = Object.freeze({
  readText,
  writeText,
  reportError: reportChromeMessage,
});

export function copyTerminalSelection(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (!terminal.hasSelection()) {
    return;
  }
  const selection = terminal.getSelection();
  if (selection === "") {
    return;
  }
  void Promise.resolve()
    .then(() => dependencies.writeText(selection))
    .catch(() => {
      dependencies.reportError("Couldn't copy the terminal selection");
    });
}

export function pasteIntoTerminal(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  void Promise.resolve()
    .then(() => dependencies.readText())
    .then((text) => terminal.paste(text))
    .catch(() => {
      dependencies.reportError("Couldn't paste from the clipboard");
    });
}
