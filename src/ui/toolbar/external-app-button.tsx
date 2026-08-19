import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ActionTooltip,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import {
  groupExternalApps,
  type ExternalAppChoice,
} from "../../links/external-app-choices";
import type { ExternalAppId } from "../../lib/external-app-catalog";
import type { MenuAnchor } from "./toolbar-overflow-menu";

/**
 * The external-app control: an icon that opens the active workspace, and a
 * caret that changes which app it is (new DL-23.11).
 *
 * A SPLIT-BUTTON is a new shape for this toolbar — §23 knew icon controls and
 * the `More` menu only — and it is one because the two halves are genuinely
 * two actions on one subject: "open my project over there" is the frequent
 * one, "somewhere else" is the rare one. Collapsing them into a single control
 * would put a menu between the user and the click they make every time; two
 * separate controls would print the same app twice.
 *
 * The icon is an `<img>` carrying a `data:` URL that main read off the
 * installed bundle. That is NOT a DL-14.1 violation: the rule governs authored
 * functional vector icons, and `agent-logos.ts` is the standing precedent for
 * brand marks arriving as image assets. What is new is the SOURCE — an icon supplied
 * by the user's machine at runtime rather than by the repo — which is why the
 * fallback matters: an icon that could not be read leaves the label to carry
 * the control, and no authored logo stands in for it.
 */

const MENU_OFFSET = 6;

interface ExternalAppButtonProps {
  readonly choices: readonly ExternalAppChoice[];
  readonly selected: ExternalAppId | null;
  /** Null while no workspace is on the stage — the icon then says why. */
  readonly workspacePath: string | null;
  onOpen(): void;
  onSelect(id: ExternalAppId): void;
}

function AppMark({ choice }: { readonly choice: ExternalAppChoice }) {
  if (choice.iconDataUrl === null) {
    // No authored stand-in (DL-14.6): the label is the identity here.
    return <span class="extapp__initial">{choice.label.slice(0, 1)}</span>;
  }
  return (
    <img class="extapp__icon" src={choice.iconDataUrl} alt="" aria-hidden />
  );
}

export function ExternalAppButton({
  choices,
  selected,
  workspacePath,
  onOpen,
  onSelect,
}: ExternalAppButtonProps) {
  const openRef = useRef<HTMLButtonElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const tooltip = useTooltipVisibility();

  const current =
    choices.find((choice) => choice.id === selected) ?? choices[0] ?? null;

  useEffect(() => {
    if (menu === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) !== true &&
        caretRef.current?.contains(target) !== true
      ) {
        setMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        caretRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  if (current === null) {
    // Nothing installed, or a host that cannot answer — the control is absent
    // rather than present and inert, the same rule the menu's rows follow.
    return null;
  }

  const reason =
    workspacePath === null ? "No workspace is open on this tab" : null;
  const label = `Open in ${current.label}`;
  const tooltipId = "action-tip-external-app";
  const showTooltip = tooltip.anchor !== null && menu === null;

  const toggleMenu = (): void => {
    if (menu !== null) {
      setMenu(null);
      return;
    }
    const rect = caretRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    setMenu({
      right: Math.max(0, window.innerWidth - rect.right),
      top: rect.bottom + MENU_OFFSET,
    });
  };

  return (
    <span class="ftoolbar__slot extapp">
      <button
        ref={openRef}
        type="button"
        class={`iconbtn extapp__open ${reason !== null ? "is-unavailable" : ""}`}
        aria-label={label}
        aria-disabled={reason !== null}
        aria-describedby={showTooltip ? tooltipId : undefined}
        onPointerEnter={(event) => tooltip.open(event.currentTarget)}
        onPointerLeave={() => {
          if (document.activeElement !== openRef.current) {
            tooltip.close();
          }
        }}
        onFocus={(event) => tooltip.open(event.currentTarget)}
        onBlur={() => tooltip.close()}
        onClick={() => {
          if (reason !== null) {
            return;
          }
          onOpen();
        }}
      >
        <AppMark choice={current} />
      </button>
      <button
        ref={caretRef}
        type="button"
        class="iconbtn extapp__caret"
        aria-label="Choose which app opens a path"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={toggleMenu}
      >
        <DeckIcon icon={CaretDown} size={CHROME_ICON} />
      </button>
      {showTooltip && tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={label}
          shortcut={null}
          reason={reason}
          anchor={tooltip.anchor}
        />
      )}
      {menu !== null && (
        <div
          ref={menuRef}
          class="toolbar-menu"
          role="menu"
          aria-label="Open with"
          style={{ right: `${menu.right}px`, top: `${menu.top}px` }}
        >
          {groupExternalApps(choices).map((view, index) => (
            <div key={view.group} class="toolbar-menu__group">
              {index > 0 && (
                <span class="toolbar-menu__sep" aria-hidden="true" />
              )}
              {view.items.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.id === current.id}
                  class={`toolbar-menu__row ${
                    choice.id === current.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    onSelect(choice.id);
                    setMenu(null);
                    caretRef.current?.focus();
                  }}
                >
                  <AppMark choice={choice} />
                  <span class="toolbar-menu__label">{choice.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
