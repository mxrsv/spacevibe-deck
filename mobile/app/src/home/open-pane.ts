import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;

/** Opens the pane screen; `fromNeeds` turns on its pager over the waiting panes (MOB16). */
export function openPane(
  router: Router,
  desktopId: string,
  paneId: number,
  fromNeeds: boolean,
): void {
  router.push({
    pathname: "/pane/[desktopId]/[paneId]",
    params: { desktopId, paneId: String(paneId), ...(fromNeeds ? { from: "needs" } : {}) },
  });
}
