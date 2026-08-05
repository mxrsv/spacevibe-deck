/**
 * Category icons for the settings rail — hand-drawn inline SVG, 16px, single
 * stroke, `currentColor`. No icon library: `DL-1.1` forbids new runtime
 * dependencies for chrome UI, and `DL-11.3` exists so that constraint isn't
 * quietly re-litigated per icon. Same authoring pattern as
 * `chrome-actions.tsx`'s `GearIcon`/`SplitRowIcon`.
 */

export function AppearanceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="14" rx="2" />
      <line x1="3.5" y1="9" x2="20.5" y2="9" />
    </svg>
  );
}

export function ColorsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="4.5" />
      <circle cx="15" cy="9" r="4.5" />
      <circle cx="12" cy="15" r="4.5" />
    </svg>
  );
}

export function TerminalIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 10l3 2.5-3 2.5" />
      <line x1="12.5" y1="15" x2="16.5" y2="15" />
    </svg>
  );
}

export function LinksEditorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M8 15.5a3 3 0 0 1 0-4.24l2-2a3 3 0 0 1 4.24 0" />
      <path d="M16 8.5a3 3 0 0 1 0 4.24l-2 2a3 3 0 0 1-4.24 0" />
      <path d="M9.5 14.5l5-5" />
    </svg>
  );
}

export function NotificationsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4.5a5 5 0 0 0-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 16.5h14l-1.4-2.1a2.8 2.8 0 0 1-.6-1.7V9.5a5 5 0 0 0-5-5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** An arrow landing on a baseline — the update, not a generic info circle. */
export function AboutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4.5v10" />
      <path d="m8 10.5 4 4 4-4" />
      <path d="M5.5 18.5h13" />
    </svg>
  );
}

export function AgentsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="7" width="15" height="12" rx="2.5" />
      <path d="M12 3.5v3.5" />
      <path d="M9.5 12.5v1.5" />
      <path d="M14.5 12.5v1.5" />
    </svg>
  );
}
