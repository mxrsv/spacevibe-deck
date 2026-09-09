import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { PushPin, PushPinSlash, X } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "./controls/deck-icon";
import {
  useDismiss,
  useStageOverlayFlag,
  useSurfacePlacement,
  type AnchorRect,
} from "./worktree-card-menus";

export type StripMenuAction = "pin" | "close" | "others" | "right";

export interface StripMenuAnchor {
  readonly key: string;
  readonly rect: AnchorRect;
  readonly trigger: HTMLElement;
}

interface Props {
  readonly anchor: StripMenuAnchor;
  readonly label: string;
  readonly pinned: boolean;
  readonly canPin: boolean;
  readonly canCloseOthers: boolean;
  readonly canCloseRight: boolean;
  readonly onAction: (action: StripMenuAction) => void;
  readonly onClose: () => void;
}

/** A portalled menu clears the strip's scroll clip and the browser's native
 * stage layer. Reuse Deck's placement, dismissal and row treatment. */
export function TabStripMenu(props: Props) {
  const { ref, style, placed } = useSurfacePlacement(props.anchor.rect, "below");
  useDismiss(props.onClose, ref, null);
  useStageOverlayFlag();
  const rows = [
    {
      id: "pin",
      label: props.pinned ? "Unpin" : "Pin",
      icon: props.pinned ? PushPinSlash : PushPin,
      disabled: !props.canPin,
    },
    { id: "close", label: "Close", icon: X, disabled: false },
    { id: "others", label: "Close Others", icon: X, disabled: !props.canCloseOthers },
    { id: "right", label: "Close to the Right", icon: X, disabled: !props.canCloseRight },
  ] as const;

  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const menuElement = ref.current;
  useLayoutEffect(() => {
    if (placed) menuElement?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [placed, menuElement, props.anchor]);

  useEffect(() => {
    const trigger = props.anchor.trigger;
    const resize = (): void => closeRef.current();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (
        trigger.isConnected &&
        (document.activeElement === document.body || menuElement?.contains(document.activeElement))
      ) {
        trigger.focus();
      }
    };
  }, [props.anchor, menuElement]);

  return createPortal(
    <div
      ref={ref}
      class="toolbar-menu tab-strip-menu"
      role="menu"
      aria-label={`Actions for ${props.label}`}
      style={style}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") {
          props.onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
        ];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {rows.map((row, index) => (
        <div key={row.id} role="none">
          {index === 1 && <span class="toolbar-menu__sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            class="toolbar-menu__row"
            disabled={row.disabled}
            onClick={() => props.onAction(row.id)}
          >
            <DeckIcon icon={row.icon} size={CHROME_ICON} />
            <span class="toolbar-menu__label">{row.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
