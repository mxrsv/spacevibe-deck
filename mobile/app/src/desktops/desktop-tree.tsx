import type { DesktopEntry } from "@/session/manager";

/**
 * The seam for T7: Home shows each online desktop's tree (projects, checkouts, panes with the rail's
 * marks, the waiting panes pinned on top, MOB16) under its row. T7 fills this component: it
 * subscribes with `entry.connection.rpc.request("tree.subscribe", {})`, listens to `tree` events
 * through `entry.connection.onEvent`, and renders nothing for a desktop that is not online.
 */
export function DesktopTree(_props: { readonly entry: DesktopEntry }) {
  return null;
}
