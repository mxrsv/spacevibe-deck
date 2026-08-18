import type { ILinkDecorations, ILinkHandler } from '@xterm/xterm';
import { reportPersistError } from '../chrome/events';
import { hasPrimaryModifier } from '../lib/platform';
import { isBrowsableUrl } from '../lib/terminal-links';
import { defaultLinkClient, type LinkClient } from './link-client';
import {
  isPrimaryModifierHeld,
  onPrimaryModifierChange,
  syncPrimaryModifierHeld,
} from './primary-modifier';

/**
 * OSC 8 hyperlink handler — routes through Tauri instead of the xterm
 * fallback (`window.confirm` + `window.open`), which WKWebView blocks.
 *
 * Same convention as the custom link provider: only Cmd+click activates;
 * a plain click belongs to the terminal (selection, TUI mouse). Hover
 * underline/pointer are also ⌘-gated — OscLinkProvider defaults them on.
 *
 * Unlike a detected link, the URI here is whatever the output wrote, so it
 * goes through the same http/https gate the detector applies.
 */
export function createOscLinkHandler(client?: LinkClient): ILinkHandler {
  const linkClient = client ?? defaultLinkClient;
  let unsubscribe: (() => void) | null = null;

  return {
    activate(event, text) {
      if (!hasPrimaryModifier(event)) {
        return;
      }
      if (!isBrowsableUrl(text)) {
        reportPersistError(`Only http/https links can be opened: ${text}`);
        return;
      }
      linkClient.openUrl(text).catch((err: unknown) => {
        reportPersistError(`Couldn't open the link: ${String(err)}`);
      });
    },
    hover(event) {
      syncPrimaryModifierHeld(event);
      // OscLinkProvider omits `decorations`, so Linkifier defaults underline +
      // pointer to on, then replaces `link.decorations` with accessors *after*
      // this hover returns. Capture that object the same way xterm installs it
      // so we can flip the flags once ⌘ is known — matching link-provider.ts.
      let decorations: ILinkDecorations | undefined;
      const defineProperties = Object.defineProperties;
      Object.defineProperties = ((
        obj: object,
        props: PropertyDescriptorMap & ThisType<unknown>,
      ) => {
        // Restore immediately — Linkifier installs accessors once per hover.
        Object.defineProperties = defineProperties;
        if (
          Object.prototype.hasOwnProperty.call(props, 'underline') &&
          Object.prototype.hasOwnProperty.call(props, 'pointerCursor')
        ) {
          decorations = obj as ILinkDecorations;
        }
        return defineProperties.call(Object, obj, props);
      }) as typeof Object.defineProperties;

      queueMicrotask(() => {
        Object.defineProperties = defineProperties;
        if (decorations === undefined) {
          return;
        }
        const apply = (held: boolean): void => {
          decorations!.pointerCursor = held;
          decorations!.underline = held;
        };
        apply(isPrimaryModifierHeld());
        unsubscribe?.();
        unsubscribe = onPrimaryModifierChange(apply);
      });
    },
    leave() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
