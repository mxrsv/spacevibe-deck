import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { settings, updateSettings } from "../settings/settings-store";
import {
  WORKTREE_COLORS,
  withWorktreeColor,
  worktreeColorStyle,
  type WorktreeColor,
} from "../settings/worktree-colors";

function handleColorKey(event: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

function ColorChoices({
  selected,
  choose,
}: {
  readonly selected: WorktreeColor | null;
  readonly choose: (color: WorktreeColor | null) => void;
}) {
  return (
    <>
      <div class="asr-color-menu__swatches" role="group" aria-label="Colors">
        {WORKTREE_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            class="asr-color-menu__swatch"
            role="menuitemradio"
            aria-label={color.label}
            title={color.label}
            aria-checked={selected === color.id}
            tabIndex={selected === color.id ? 0 : -1}
            style={{ "--swatch-color": color.value }}
            onClick={() => choose(color.id)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        class="asr-color-menu__default"
        role="menuitemradio"
        aria-checked={selected === null}
        tabIndex={selected === null ? 0 : -1}
        onClick={() => choose(null)}
      >
        Default
      </button>
    </>
  );
}

/** An expandable item inside the checkout actions menu (DL-27.25). */
export function WorktreeColorPicker({
  path,
  onClose,
}: {
  readonly path: string;
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const palette = useRef<HTMLDivElement>(null);
  const selected = settings.value.worktreeColors[path] ?? null;
  const label = WORKTREE_COLORS.find((color) => color.id === selected)?.label ?? "Default";
  useLayoutEffect(() => {
    if (open) palette.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  const choose = (color: WorktreeColor | null): void => {
    updateSettings({
      worktreeColors: withWorktreeColor(settings.value.worktreeColors, path, color),
    });
    onClose();
  };
  return (
    <>
      <button
        type="button"
        class="asr-act asr-color-action"
        role="menuitem"
        aria-label="Worktree color"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span
          class="asr-act__glyph"
          aria-hidden="true"
          style={worktreeColorStyle(settings.value.worktreeColors, path)}
        >
          <span class="asr-color-action__dot" />
        </span>
        <span class="asr-act__title">Worktree color</span>
        <span class="asr-act__detail">{label}</span>
      </button>
      {open && (
        <div
          ref={palette}
          class="asr-color-menu"
          role="group"
          aria-label="Worktree colors"
          onKeyDown={handleColorKey}
        >
          <ColorChoices selected={selected} choose={choose} />
        </div>
      )}
    </>
  );
}
