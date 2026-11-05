import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ArrowExpand01Icon,
  CancelSquareIcon,
  MoreHorizontalIcon,
  SquareSplitHorizontalIcon,
  SquareSplitVerticalIcon,
} from "@hugeicons/core-free-icons";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../ui/controls/action-tooltip";
import { DeckIcon, type DeckGlyph } from "../ui/controls/deck-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/controls/dropdown-menu";
import { toolbarLabel } from "../ui/toolbar/toolbar-label";
import { shortcutLabel } from "../lib/shortcut-label";
import { paneHeaderActions } from "./pane-header-actions";
import type { ActionId } from "./action-registry";

/**
 * Below this header width four buttons would squeeze the logo, name and state to nothing, so
 * they fold into one `⋯` menu with the same four entries (PH-5).
 */
const NARROW_HEADER_PX = 280;

interface HeaderAction {
  readonly id: ActionId;
  readonly icon: DeckGlyph;
  readonly run: (paneId: number) => void;
}

/** The four acts of PH-2, in the order of the `More` menu and with the icons `deck-toolbar.tsx` gives them. */
const HEADER_ACTIONS: readonly HeaderAction[] = [
  {
    id: "split-row",
    icon: SquareSplitHorizontalIcon,
    run: (id) => paneHeaderActions().split(id, "row"),
  },
  {
    id: "split-column",
    icon: SquareSplitVerticalIcon,
    run: (id) => paneHeaderActions().split(id, "column"),
  },
  {
    id: "toggle-expand",
    icon: ArrowExpand01Icon,
    run: (id) => paneHeaderActions().toggleExpand(id),
  },
  { id: "close-pane", icon: CancelSquareIcon, run: (id) => paneHeaderActions().close(id) },
];

/** One icon button and its DL-23 tooltip: a component because the tooltip is a hook per control. */
function HeaderActionButton({ paneId, action }: { paneId: number; action: HeaderAction }) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const label = toolbarLabel(action.id);
  const tooltipId = `pane-act-tip-${paneId}-${action.id}`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="pane-agent-header__act"
        aria-label={label}
        aria-describedby={tooltip.anchor !== null ? tooltipId : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={() => action.run(paneId)}
      >
        <DeckIcon icon={action.icon} size={14} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={label}
          shortcut={shortcutLabel(action.id)}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

function HeaderActionMenu({ paneId }: { paneId: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            class="pane-agent-header__act"
            aria-label="Pane actions"
            title="Pane actions"
          />
        }
      >
        <DeckIcon icon={MoreHorizontalIcon} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {HEADER_ACTIONS.map((action) => (
          <DropdownMenuItem key={action.id} onClick={() => action.run(paneId)}>
            <DeckIcon icon={action.icon} size={16} />
            {toolbarLabel(action.id)}
            <DropdownMenuShortcut>{shortcutLabel(action.id)}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The pane's own actions (DL-32.9): they act on the pane whose header holds them, through the
 * handlers `App` registered (`pane-header-actions.ts`). The container stops `pointerdown` and
 * `mousedown` because the bar is the pane's drag handle (`pane-drag.ts`). Resting they are
 * dimmed, full strength on header hover or pane focus (PH-4). Width is a JS measure of the
 * header, not a container query: `container-type` would make the bar the containing block for
 * the `fixed` tooltips and move them.
 */
export function PaneHeaderActionButtons({ paneId }: { paneId: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const header = root.current?.parentElement;
    if (!header || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setNarrow((entry?.contentRect.width ?? Number.POSITIVE_INFINITY) < NARROW_HEADER_PX);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={root}
      class="pane-agent-header__actions"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {narrow ? (
        <HeaderActionMenu paneId={paneId} />
      ) : (
        HEADER_ACTIONS.map((action) => (
          <HeaderActionButton key={action.id} paneId={paneId} action={action} />
        ))
      )}
    </div>
  );
}
