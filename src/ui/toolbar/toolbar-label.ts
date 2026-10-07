import { ACTION_REGISTRY, type ActionId } from "../../terminal/action-registry";

const REGISTRY_LABELS: ReadonlyMap<string, string> = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.label]),
);

/**
 * Registry labels are macOS menu grammar — Title Case, with a trailing
 * ellipsis on dialog openers. Chrome copy is sentence case (§8) and the
 * "opens a surface" job belongs to `aria-haspopup` here, so the toolbar layer
 * re-cases at its boundary and the registry keeps the menu's spelling (D6).
 * The transform lowercases every word after the first, which is right for
 * every projected label today; an action whose label carries a proper noun
 * would need its own casing here, not a registry change.
 *
 * Its own module so the rail's tools row and the pane header name an action
 * exactly as the toolbar's `More` menu does, without importing the toolbar.
 */
export function toolbarLabel(id: ActionId): string {
  const raw = REGISTRY_LABELS.get(id) ?? id;
  return raw
    .replace(/…$/, "")
    .split(" ")
    .map((word, index) => (index === 0 ? word : word.toLowerCase()))
    .join(" ");
}
