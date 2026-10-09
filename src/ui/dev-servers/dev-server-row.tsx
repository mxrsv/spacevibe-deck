import { ArrowSquareOut, Browser, Copy, type Icon } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../controls/action-tooltip";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import type { DevServerAction } from "./dev-server-actions";
import type { DevServerItem } from "./dev-server-model";

/**
 * One server as a DL-36.1 row: a state mark, the endpoint and its state word,
 * the address, a line of facts, and at the trailing edge one `Open` pill with
 * two icon buttons. Every control is a cell of one keyboard grid
 * (`data-col`, walked by `DevServersPanel`), with a single tab stop for the
 * whole list.
 */

interface ActionSpec {
  readonly col: number;
  readonly action: DevServerAction;
  readonly label: string;
  readonly icon: Icon;
  readonly reason: string | null;
  readonly pill?: boolean;
}

function actionsFor(item: DevServerItem): readonly ActionSpec[] {
  return [
    {
      col: 0,
      action: "open-deck",
      label: "Open in Deck",
      icon: Browser,
      reason: item.openReason,
      pill: true,
    },
    {
      col: 1,
      action: "open-external",
      label: "Open in your browser",
      icon: ArrowSquareOut,
      reason: item.openReason,
    },
    {
      col: 2,
      action: "copy",
      label: item.url === null ? "Copy address" : "Copy URL",
      icon: Copy,
      reason: null,
    },
  ];
}

interface ActionButtonProps {
  readonly spec: ActionSpec;
  readonly item: DevServerItem;
  readonly tabbable: boolean;
  onFocusCell(): void;
  onRun(action: DevServerAction): void;
}

/**
 * DL-23.6: a control that cannot run stays focusable and says why in its
 * tooltip and its accessible description; it is never `disabled`, which would
 * make that reason unreachable by keyboard.
 */
function ActionButton({ spec, item, tabbable, onFocusCell, onRun }: ActionButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const tipId = `dev-server-tip-${item.id}-${spec.col}`;
  const trigger = tooltipTriggerProps(tooltip, ref);
  const unavailable = spec.reason !== null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        class={`${spec.pill === true ? "dsv-pill" : "iconbtn dsv-icon"}${unavailable ? " is-unavailable" : ""}`}
        data-col={spec.col}
        aria-label={`${spec.label} — ${item.title}`}
        aria-disabled={unavailable}
        aria-describedby={tooltip.anchor !== null ? tipId : undefined}
        tabIndex={tabbable ? 0 : -1}
        {...trigger}
        onFocus={(event) => {
          onFocusCell();
          trigger.onFocus(event);
        }}
        onClick={() => {
          if (!unavailable) {
            onRun(spec.action);
          }
        }}
      >
        <DeckIcon icon={spec.icon} size={ROW_ICON} />
        {spec.pill === true ? <span>Open</span> : null}
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tipId}
          label={spec.label}
          shortcut={null}
          reason={spec.reason}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

export interface DevServerRowProps {
  readonly item: DevServerItem;
  readonly rowIndex: number;
  /** The one cell that is a tab stop, as `${id}:${col}`. */
  readonly stop: string;
  onStop(cell: string): void;
  onRun(item: DevServerItem, action: DevServerAction): void;
}

export function DevServerRow({ item, rowIndex, stop, onStop, onRun }: DevServerRowProps) {
  const address = item.url ?? "No web address";
  return (
    <li class="dsv-row" data-state={item.state} data-row={rowIndex}>
      <span class="dsv-mark" data-state={item.state} aria-hidden="true" />
      <div class="dsv-row__body">
        <span class="dsv-row__line">
          <span class="dsv-row__title">{item.title}</span>
          <span class="dsv-row__state">{item.stateWord}</span>
        </span>
        <span class="dsv-row__url" title={item.url ?? undefined}>
          {address}
        </span>
        <span class="dsv-row__meta">
          {item.detail !== null && <span class="dsv-row__detail">{item.detail}</span>}
          {item.protocol !== null && (
            <span data-tone={item.protocol.tone}>{item.protocol.text}</span>
          )}
          {item.age !== null && <span>{item.age}</span>}
        </span>
      </div>
      <div class="dsv-row__actions" role="group" aria-label={`${item.title} actions`}>
        {actionsFor(item).map((spec) => (
          <ActionButton
            key={spec.col}
            spec={spec}
            item={item}
            tabbable={stop === `${item.id}:${spec.col}`}
            onFocusCell={() => onStop(`${item.id}:${spec.col}`)}
            onRun={(action) => onRun(item, action)}
          />
        ))}
      </div>
    </li>
  );
}
