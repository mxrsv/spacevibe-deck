import { MAX_INPUT_CHARS } from "@protocol/limits";

/** The accessory row above the keyboard in Live mode (MOB18) and what each key sends to the pane. */
export const ACCESSORY_KEYS = [
  { id: "esc", label: "esc", sequence: "\x1b", description: "Escape" },
  { id: "tab", label: "tab", sequence: "\t", description: "Tab" },
  { id: "shift-tab", label: "⇧tab", sequence: "\x1b[Z", description: "Shift Tab" },
  { id: "ctrl-c", label: "^C", sequence: "\x03", description: "Control C" },
  { id: "left", label: "←", sequence: "\x1b[D", description: "Left arrow" },
  { id: "up", label: "↑", sequence: "\x1b[A", description: "Up arrow" },
  { id: "down", label: "↓", sequence: "\x1b[B", description: "Down arrow" },
  { id: "right", label: "→", sequence: "\x1b[C", description: "Right arrow" },
  { id: "enter", label: "return", sequence: "\r", description: "Enter" },
] as const;

export type AccessoryKeyId = (typeof ACCESSORY_KEYS)[number]["id"];

export function sequenceFor(id: AccessoryKeyId): string {
  const key = ACCESSORY_KEYS.find((candidate) => candidate.id === id);
  if (key === undefined) throw new Error(`unknown accessory key ${id}`);
  return key.sequence;
}

/** Characters a single `pane.input` may carry, cut so a surrogate pair is never split. */
export function splitInput(data: string, max = MAX_INPUT_CHARS): string[] {
  const parts: string[] = [];
  let rest = data;
  while (rest.length > max) {
    let cut = max;
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

export const INPUT_BATCH_MS = 16;

/**
 * Keystrokes arrive one `onData` at a time; one `pane.input` per keystroke would flood the relay
 * on a fast typist or a paste. Collect what arrives within one frame and send it in order,
 * split to the protocol's limit.
 */
export function createInputBatcher(options: {
  readonly send: (data: string) => void;
  readonly delayMs?: number;
  readonly max?: number;
}): { push(data: string): void; flush(): void; dispose(): void } {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const pending = buffer;
    buffer = "";
    for (const part of splitInput(pending, options.max)) options.send(part);
  };
  return {
    push(data) {
      if (data === "") return;
      buffer += data;
      if (timer === null) timer = setTimeout(flush, options.delayMs ?? INPUT_BATCH_MS);
    },
    flush,
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      buffer = "";
    },
  };
}
