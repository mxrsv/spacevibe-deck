import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useServices } from "@/app-state/app-provider";
import { deviceCrypto } from "@/crypto/device-crypto";
import { routeTap } from "./notification-routing";
import { tapInbox } from "./tap-inbox";

/**
 * Below the lock gate, so it only exists once the app is unlocked (MOB4): opens the pane a tapped
 * notification names, or Home when the pairing is unknown or the payload does not open (MOB23).
 */
export function TapRouter() {
  const router = useRouter();
  const { manager } = useServices();

  useEffect(() => {
    const open = (): void => {
      const tap = tapInbox.take();
      if (tap === null) return;
      const route = routeTap(tap.data, deviceCrypto, (id) => manager.pushKeyOf(id));
      if (route.kind === "pane") {
        router.push({
          pathname: "/pane/[desktopId]/[paneId]",
          params: { desktopId: route.desktopId, paneId: String(route.paneId) },
        });
      } else {
        router.navigate("/");
      }
    };
    open();
    return tapInbox.subscribe(open);
  }, [router, manager]);

  return null;
}
