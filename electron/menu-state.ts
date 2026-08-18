/**
 * Menu keymap and chord-recording state, and the rebuild that applies both to
 * the native menu.
 *
 * One instance is created in `main.ts` and shared with everything that
 * touches the menu: `createWindow`'s focus/render-process-gone/closed
 * handlers, the `suspend_menu_accelerators` IPC handler and the
 * `apply_settings_patch` handler, each reached through its own deps object
 * rather than a module-level singleton — `main.ts` still owns `registry` and
 * `emitTo`, so this module takes them once at construction instead of
 * duplicating them.
 */
import { buildMenu } from './menu';
import { MACOS_KEYMAP, type KeyBinding } from '../src/terminal/action-registry';
import { resolveKeymap, validateKeybindings } from '../src/lib/keybindings';
import type { WindowRegistry } from './window-lifecycle';

export interface MenuStateDeps {
  readonly registry: WindowRegistry;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
  readonly focused: () => string | null;
}

export interface MenuState {
  acceleratorsSuspended(): boolean;
  /** Add or remove a recorder, rebuilding the menu only when the state flips. */
  setRecording(senderId: number, recording: boolean): void;
  /** Re-resolve the menu keymap from a settings object and rebuild if it moved. */
  adoptMenuKeymap(settings: unknown): void;
  /** Rebuild the application menu. Call on boot, and on every window open,
   * focus change and close — the move-pane submenu lists peer windows, so its
   * contents change with all three. */
  rebuildMenu(): void;
}

export function createMenuState(deps: MenuStateDeps): MenuState {
  /**
   * The macOS keymap the menu advertises: shipped defaults plus whatever the
   * user rebound. Held here rather than resolved per rebuild because
   * `rebuildMenu` runs on every focus change, and re-reading the store on each
   * one would put a disk read on the focus path.
   */
  let menuKeymap: readonly KeyBinding[] = MACOS_KEYMAP;

  /**
   * Web contents currently recording a chord — see `MenuDeps.suspendAccelerators`.
   *
   * A SET keyed by sender, not a boolean, and both halves of that matter. As a
   * boolean with no owner it could be left stuck: a window that died between
   * `true` and `false` stripped every accelerator app-wide for the rest of the
   * session, with no way back except guessing "open Settings, click a pill,
   * press Escape". And with two windows recording, whichever finished FIRST
   * un-suspended the other — so ⌘W in the still-recording window closed the
   * pane, which is the exact failure this mechanism exists to prevent.
   */
  const recordingSenders = new Set<number>();

  function acceleratorsSuspended(): boolean {
    return recordingSenders.size > 0;
  }

  function setRecording(senderId: number, recording: boolean): void {
    const before = acceleratorsSuspended();
    if (recording) {
      recordingSenders.add(senderId);
    } else {
      recordingSenders.delete(senderId);
    }
    if (acceleratorsSuspended() !== before) {
      rebuildMenu();
    }
  }

  function adoptMenuKeymap(settings: unknown): void {
    const overrides = validateKeybindings(
      (settings as { keybindings?: unknown } | null)?.keybindings,
    );
    const next = resolveKeymap('macos', overrides);
    menuKeymap = next;
    rebuildMenu();
  }

  function rebuildMenu(): void {
    buildMenu({
      registry: deps.registry,
      emitTo: deps.emitTo,
      focused: () => deps.focused(),
      keymap: menuKeymap,
      suspendAccelerators: acceleratorsSuspended(),
    });
  }

  return { acceleratorsSuspended, setRecording, adoptMenuKeymap, rebuildMenu };
}
