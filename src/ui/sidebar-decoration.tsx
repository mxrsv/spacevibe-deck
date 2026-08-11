import { settings } from "../settings/settings-store";

/**
 * The decorative mark at the foot of the workspace sidebar (DL-16).
 *
 * Deliberately almost nothing: the element carries an id, and `styles.css`
 * attaches the artwork as a mask so the color comes from `--decor` rather than
 * from the file. That is why this renders a bare `<div>` and not an `<img>` —
 * an image would paint its own palette and stop following the theme (DL-16.2).
 *
 * `aria-hidden` because it means nothing; `pointer-events: none` lives in CSS
 * so the ornament can never eat a click meant for the list above it (DL-16.4).
 */
export function SidebarDecoration() {
  const id = settings.value.sidebarDecoration;
  if (id === "off") {
    return null;
  }
  return <div class="wsbar__decor" data-decor={id} aria-hidden="true" />;
}
