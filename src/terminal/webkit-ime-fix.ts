import type { Terminal } from "@xterm/xterm";

/**
 * Workarounds for xterm.js IME bugs in WKWebView (Tauri on macOS).
 *
 * Upstream issues:
 * - xtermjs/xterm.js#5894 — dead-key cancellation duplicates the committed
 *   char (synthetic keypress carries the commit charCode) and drops the next
 *   key (its `insertText` input event is blocked by the `_keyDownSeen` guard).
 * - xtermjs/xterm.js#5887 — IMEs that report keyCode 229 for every keystroke
 *   fire `input` before `keydown`, so the same `_keyDownSeen` guard drops
 *   every character after the first during rapid typing.
 *
 * Vietnamese input (Telex tone marks, macOS dead-key accents) hits both
 * paths. Chromium hosts (VS Code, Electron) are unaffected, which is why the
 * fix is gated to WebKit-only webviews.
 *
 * Key-injecting Vietnamese IMEs (EVKey/OpenKey) also:
 * - inject multi-char replacement text via keypress/`insertText` (including
 *   ASCII tone-cancel strings like "os");
 * - emit Backspaces then a replacement whose span can over-delete a leading
 *   consonant cluster already committed via `_keyDown` (e.g. `vâ` + 2 BS +
 *   `ấn`, or `trâ` + 3 BS + `ấn`);
 * - deliver the trailing physical key (`n`) after the replacement, duplicating
 *   a character already present in the injected text.
 */

interface XtermCore {
  _compositionHelper?: {
    isComposing: boolean;
    _isSendingComposition: boolean;
  };
  _keyPressHandled: boolean;
  _unprocessedDeadKey: boolean;
  optionsService: { rawOptions: { screenReaderMode: boolean } };
  coreService: { triggerDataEvent(data: string, wasUserInput: boolean): void };
  cancel(ev: Event, force?: boolean): boolean | undefined;
  _inputEvent(ev: InputEvent): boolean;
}

/** Tracks PTY-bound emissions so IME Backspace/replace bursts can be reconciled. */
interface ImeEmitState {
  recent: string[];
  /** Chars removed by consecutive Backspaces, oldest→newest in reverse push order. */
  deletedBurst: string[];
  /** Trailing ASCII letter of a BS+replace inject; suppress one late keydown. */
  suppressTrailing: string | null;
  /** Identity for the armed suppress window; stale timeouts must not clear a newer arm. */
  suppressTrailingToken: object | null;
}

const VIET_VOWELS = new Set([
  ..."aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ",
]);

function isVietVowel(ch: string): boolean {
  return VIET_VOWELS.has(ch.toLowerCase());
}

function isVietConsonant(ch: string): boolean {
  return [...ch].length === 1 && /[a-zđ]/i.test(ch) && !isVietVowel(ch);
}

/**
 * When IME Backspaces deleted a leading consonant cluster that is not
 * represented in the replacement (PTY had `vâ`/`trâ`, IME replaced as if
 * deleting from the vowel), restore the full onset.
 */
function consonantPrefixToRestore(deletedOldestFirst: string, replacement: string): string {
  const deleted = [...deletedOldestFirst];
  const rep = [...replacement];
  if (deleted.length === 0 || rep.length === 0) {
    return "";
  }
  if (!isVietVowel(rep[0])) {
    return "";
  }
  let i = 0;
  while (i < deleted.length && isVietConsonant(deleted[i])) {
    i += 1;
  }
  if (i === 0) {
    return "";
  }
  return deleted.slice(0, i).join("");
}

function armSuppressTrailing(state: ImeEmitState, trailing: string): void {
  state.suppressTrailing = trailing;
  const token = {};
  state.suppressTrailingToken = token;
  // Expire after the current IME event burst so a later legitimate key that
  // happens to match the trailing letter is not swallowed.
  setTimeout(() => {
    if (state.suppressTrailingToken === token) {
      state.suppressTrailing = null;
      state.suppressTrailingToken = null;
    }
  }, 0);
}

function clearSuppressTrailing(state: ImeEmitState): void {
  state.suppressTrailing = null;
  state.suppressTrailingToken = null;
}

/** True inside a WebKit webview that is not Chromium-based (WKWebView). */
export function isWebKitWebView(userAgent: string = navigator.userAgent): boolean {
  return userAgent.includes("AppleWebKit") && !userAgent.includes("Chrome");
}

function getCore(term: Terminal): XtermCore | null {
  const core = (term as unknown as { _core?: XtermCore })._core;
  if (
    !core ||
    typeof core._inputEvent !== "function" ||
    typeof core.cancel !== "function" ||
    !core.coreService ||
    !core.optionsService
  ) {
    return null;
  }
  return core;
}

function noteEmit(state: ImeEmitState, data: string): void {
  const chars = [...data];
  if (chars.length === 1 && chars[0] !== "\x7f") {
    // Progressive single-char inject (â, ú, …) already paired with its BS.
    state.deletedBurst = [];
  }
  for (const ch of chars) {
    if (ch === "\x7f") {
      const popped = state.recent.pop();
      if (popped !== undefined) {
        state.deletedBurst.push(popped);
      }
    } else {
      state.recent.push(ch);
      if (state.recent.length > 32) {
        state.recent.splice(0, state.recent.length - 32);
      }
    }
  }
}

function wrapTriggerDataEvent(core: XtermCore, state: ImeEmitState): void {
  const original = core.coreService.triggerDataEvent.bind(core.coreService);
  core.coreService.triggerDataEvent = (data: string, wasUserInput: boolean): void => {
    noteEmit(state, data);
    original(data, wasUserInput);
  };
}

/**
 * Replace `_inputEvent` so `insertText` input events emit whenever no
 * composition is active, instead of being gated on `_keyDownSeen` — the
 * guard that drops characters in both upstream bugs. `_keyPressHandled`
 * still dedupes against the keypress path, and events during an active or
 * finalizing composition are still ignored (CompositionHelper owns those).
 */
function patchInputEvent(core: XtermCore, state: ImeEmitState): void {
  core._inputEvent = (ev: InputEvent): boolean => {
    const helper = core._compositionHelper;
    const composing = helper !== undefined && (helper.isComposing || helper._isSendingComposition);
    if (
      ev.data &&
      ev.inputType === "insertText" &&
      !composing &&
      !core.optionsService.rawOptions.screenReaderMode
    ) {
      if (core._keyPressHandled) {
        return false;
      }
      core._unprocessedDeadKey = false;
      let data = ev.data;
      if ([...ev.data].length > 1) {
        const deletedOldestFirst = state.deletedBurst.slice().reverse().join("");
        const hadDeleteBurst = deletedOldestFirst.length > 0;
        const prefix = consonantPrefixToRestore(deletedOldestFirst, ev.data);
        state.deletedBurst = [];
        data = prefix + ev.data;
        // Only arm trailing-key suppression for BS+replace bursts (the path
        // that over-delivers the physical final letter). Plain multi-char
        // injects must not leave a sticky suppress that can drop a later key.
        if (hadDeleteBurst) {
          const injectedChars = [...ev.data];
          const trailing = injectedChars[injectedChars.length - 1] ?? null;
          if (trailing !== null && /[a-zA-Z]/.test(trailing)) {
            armSuppressTrailing(state, trailing);
          }
        }
      }
      core.coreService.triggerDataEvent(data, true);
      core.cancel(ev);
      return true;
    }
    return false;
  };
}

/**
 * Suppress the synthetic keypress WebKit fires when a printable key cancels
 * a dead-key composition: its charCode is the *committed* dead-key char, so
 * xterm's `_keyPress` would re-emit it as a duplicate (#5894). Only
 * compositions that saw a `Dead`/`AltGraph` keydown are treated this way, so
 * layouts that type the same characters directly are unaffected.
 */
function installDeadKeyGuard(term: Terminal, state: ImeEmitState): void {
  const textarea = term.textarea;
  if (!textarea) {
    return;
  }

  let pendingDead = false;
  let deadKeyComposition = false;
  let commitPending = false;
  let lastCommit = "";

  textarea.addEventListener(
    "keydown",
    (ev: KeyboardEvent) => {
      if (ev.key === "Dead" || ev.key === "AltGraph") {
        pendingDead = true;
        if (ev.isComposing) {
          deadKeyComposition = true;
        }
      }
    },
    true,
  );
  textarea.addEventListener(
    "compositionstart",
    () => {
      deadKeyComposition = pendingDead;
      pendingDead = false;
      commitPending = false;
      lastCommit = "";
    },
    true,
  );
  textarea.addEventListener(
    "compositionend",
    (ev: CompositionEvent) => {
      if (deadKeyComposition) {
        commitPending = true;
        lastCommit = ev.data ?? "";
      }
      deadKeyComposition = false;
    },
    true,
  );

  term.attachCustomKeyEventHandler((ev: KeyboardEvent): boolean => {
    if (ev.type === "keydown" && state.suppressTrailing !== null) {
      // IME often fires insertText before the injection keydown (#5887). Do not
      // clear suppressTrailing on that multi-char keydown or the late physical
      // key will slip through.
      if (ev.key === state.suppressTrailing) {
        clearSuppressTrailing(state);
        return false;
      }
      if ([...ev.key].length === 1) {
        clearSuppressTrailing(state);
      }
    }

    if (
      ev.type === "keypress" &&
      commitPending &&
      lastCommit.length === 1 &&
      ev.charCode === lastCommit.charCodeAt(0)
    ) {
      commitPending = false;
      // Returning false skips xterm's _keyPress, so the committed char is
      // not re-emitted; the real key arrives via the patched _inputEvent.
      return false;
    }
    if (ev.type === "keypress" && isInjectedText(ev.key)) {
      // Key-injecting Vietnamese IMEs (EVKey/OpenKey) replace typed letters
      // by sending backspaces plus ONE key event whose `key` holds the whole
      // replacement (e.g. "ào"). xterm's _keyPress would emit only the first
      // char (charCode) and then block the `input` event that carries the
      // full text — skip the keypress so the patched _inputEvent emits it.
      return false;
    }
    return true;
  });
}

/**
 * True for keypress values that contain injected replacement text rather
 * than one real printable key. WebKit Vietnamese IMEs can inject either
 * accented text ("ối") or an ASCII fallback/tone-cancel result ("os").
 * Named keys like "Enter"/"Dead" are excluded (PascalCase / non-lowercase).
 * Only consulted for `keypress` events (see call site).
 */
function isInjectedText(key: string): boolean {
  const chars = [...key];
  if (chars.length <= 1) {
    return false;
  }
  // oxlint-disable-next-line no-control-regex -- non-ASCII detection is the point of this check
  if (/[^\x00-\x7f]/.test(key)) {
    return true;
  }
  return /^[a-z]+$/.test(key);
}

/**
 * Apply both WKWebView IME workarounds to a terminal. Must be called after
 * `term.open()` (the textarea has to exist). No-op when the internals this
 * patch relies on are missing (e.g. after an xterm.js upgrade).
 */
export function applyWebkitImeFix(term: Terminal): void {
  const core = getCore(term);
  if (core === null || !term.textarea) {
    console.warn("webkit-ime-fix: xterm internals not found, skipping IME workaround");
    return;
  }
  const state: ImeEmitState = {
    recent: [],
    deletedBurst: [],
    suppressTrailing: null,
    suppressTrailingToken: null,
  };
  wrapTriggerDataEvent(core, state);
  patchInputEvent(core, state);
  installDeadKeyGuard(term, state);
}
