import type { ComponentChildren } from 'preact';

/** Lowercase group label above a run of config rows (DL-4.2). */
export function ConfigGroup({ label }: { label: string }) {
  return <div class="cfg-group">{label}</div>;
}

interface ConfigRowProps {
  label: string;
  /** Optional one-line lowercase description under the key. */
  desc?: string;
  danger?: boolean;
  /** The single interactive value (plus an optional clear button, DL-6.1). */
  children: ComponentChildren;
}

/** The one control: key (+ desc) left, one interactive value right (DL-5). */
export function ConfigRow({ label, desc, danger, children }: ConfigRowProps) {
  return (
    <div class="cfg-row">
      <div class="cfg-row__key">
        <span class={`cfg-row__label ${danger ? 'cfg-row__label--danger' : ''}`}>{label}</span>
        {desc !== undefined && <span class="cfg-row__desc">{desc}</span>}
      </div>
      <div class="cfg-row__value">{children}</div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  desc?: string;
  checked: boolean;
  onToggle: () => void;
  /** Disables the native button (real enforcement, not just styling); default false. */
  disabled?: boolean;
}

/** toggle value kind: `on` (green) / `off` (faint), click flips (DL-6). */
export function ToggleRow({ label, desc, checked, onToggle, disabled }: ToggleRowProps) {
  return (
    <ConfigRow label={label} desc={desc}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        class={`cfg-btn ${checked ? 'cfg-btn--on' : 'cfg-btn--off'} ${disabled ? 'cfg-btn--disabled' : ''}`}
        disabled={disabled}
        onClick={onToggle}
      >
        {checked ? 'on' : 'off'}
      </button>
    </ConfigRow>
  );
}
