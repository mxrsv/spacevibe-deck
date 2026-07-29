import {
  readText,
  writeText,
} from "@tauri-apps/plugin-clipboard-manager";
import { reportChromeMessage } from "../chrome/events";
import { getDesktopEnvironment } from "../lib/platform";

interface TerminalSelection {
  getSelection(): string;
  hasSelection(): boolean;
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

function copySelection(
  terminal: TerminalSelection,
  dependencies: ClipboardDependencies,
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

function pasteClipboard(
  send: (text: string) => void,
  dependencies: ClipboardDependencies,
): void {
  void Promise.resolve()
    .then(() => dependencies.readText())
    .then(send)
    .catch(() => {
      dependencies.reportError("Couldn't paste from the clipboard");
    });
}

/**
 * Own Windows Terminal-style clipboard chords while leaving macOS native
 * behavior and bare Ctrl control sequences to xterm/the PTY.
 */
export function createTerminalClipboardHandler(
  terminal: TerminalSelection,
  send: (text: string) => void,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (
      getDesktopEnvironment().platform !== "windows" ||
      event.type !== "keydown" ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey
    ) {
      return true;
    }

    const key = event.key.toLowerCase();
    if (key === "c") {
      copySelection(terminal, dependencies);
      return false;
    }
    if (key === "v") {
      pasteClipboard(send, dependencies);
      return false;
    }
    return true;
  };
}
