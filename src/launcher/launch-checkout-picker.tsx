import { CaretDown, Check, GitBranch } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { DeckIcon, ROW_ICON } from "../ui/controls/deck-icon";
import type { LaunchCheckoutRow } from "./agent-launch-context-model";

interface LaunchCheckoutPickerProps {
  readonly checkouts: readonly LaunchCheckoutRow[];
  readonly value: string;
  readonly disabled: boolean;
  /** Re-targets the page. NEVER launches. */
  readonly onSelect: (path: string) => void;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * DL-13.1: the repository's checkouts by branch, in the same popover look as
 * `WorkspacePicker` (whose classes it shares). Owns only whether it is open
 * and where focus sits.
 */
export function LaunchCheckoutPicker(props: LaunchCheckoutPickerProps) {
  const open = useSignal(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = props.checkouts.find((entry) => entry.path === props.value);
  const rows = (): HTMLButtonElement[] =>
    Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);

  useLayoutEffect(() => {
    if (!open.value) return;
    const selected = root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (selected ?? rows()[0])?.focus();
  }, [open.value]);

  useEffect(() => {
    if (!open.value) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        open.value = false;
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open.value, open]);

  function close(): void {
    open.value = false;
    trigger.current?.focus();
  }

  function navigate(event: KeyboardEvent): void {
    if (!open.value) return;
    if (event.key === "Escape") {
      // The page closes itself on a bare Escape; the menu answers it first.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!NAV_KEYS.has(event.key)) return;
    event.preventDefault();
    const list = rows();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  }

  return (
    <div
      class="nt-workspace-picker"
      ref={root}
      onKeyDown={navigate}
      onFocusOut={(event) => {
        if (event.relatedTarget instanceof Node && !root.current?.contains(event.relatedTarget)) {
          open.value = false;
        }
      }}
    >
      <button
        type="button"
        class="nt-workspace-picker__trigger"
        ref={trigger}
        aria-label={`Checkout: ${current?.label ?? "none"}`}
        aria-haspopup="menu"
        aria-expanded={open.value}
        title={props.value}
        aria-disabled={props.disabled}
        onClick={() => {
          if (!props.disabled) open.value = !open.value;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open.value && !props.disabled) {
            event.preventDefault();
            event.stopPropagation();
            open.value = true;
          }
        }}
      >
        <DeckIcon icon={GitBranch} size={ROW_ICON} />
        <span>{current?.label ?? "Choose a checkout"}</span>
        <DeckIcon icon={CaretDown} size={ROW_ICON} />
      </button>
      {open.value && !props.disabled ? (
        <div class="nt-workspace-picker__menu" role="menu" aria-label="Choose a checkout">
          {props.checkouts.map((entry) => {
            const selected = entry.path === props.value;
            return (
              <button
                key={entry.path}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                title={entry.path}
                onClick={() => {
                  close();
                  props.onSelect(entry.path);
                }}
              >
                <DeckIcon icon={GitBranch} size={ROW_ICON} />
                <span class="nt-workspace-picker__name">{entry.label}</span>
                {entry.linked ? <span class="nt-workspace-picker__detail">worktree</span> : null}
                {selected ? <DeckIcon icon={Check} size={ROW_ICON} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
