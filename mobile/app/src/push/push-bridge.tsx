import { useEffect } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { useServices } from "@/app-state/app-provider";
import { usePrefsState } from "@/app-state/app-provider";
import { deviceCrypto } from "@/crypto/device-crypto";
import { extractPushData, foregroundCopy, localNotificationData } from "./notification-routing";
import { tapInbox } from "./tap-inbox";

/**
 * Lives above the lock gate: keeps the push registration in line with the preference, shows the
 * real copy of a push that arrives while the app is open (Expo Go has no extension), and drops
 * taps into the inbox for the router below the gate to open.
 */
export function PushBridge() {
  const { push, manager } = useServices();
  const { loaded, prefs } = usePrefsState();
  const wanted = prefs.notifications;

  // Register when the preference is known and on, unregister when it is off. No OS prompt here: at
  // launch the user has done nothing that explains one. The prompt comes from the Settings switch
  // and from finishing a pairing (`askForPushPermission`).
  useEffect(() => {
    if (!loaded) return;
    void push.sync(wanted, false).then(() => manager.announcePush());
  }, [loaded, wanted, push, manager]);

  useEffect(() => {
    const onChange = push.subscribe(() => manager.announcePush());
    // Tokens rotate: the OS tells us, and the relay hears the new one.
    const tokens = Notifications.addPushTokenListener(() => {
      void push.refreshToken();
    });
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void push.refreshToken();
    });
    return () => {
      onChange();
      tokens.remove();
      foreground.remove();
    };
  }, [push, manager]);

  useEffect(() => {
    Notifications.setNotificationHandler({
      async handleNotification(notification) {
        const data: unknown = notification.request.content.data;
        const incoming = extractPushData(data);
        // A sealed push in the foreground: open it and show the real copy as a local notification;
        // the generic one is not shown. Anything that does not open keeps the generic line.
        if (incoming?.sealed != null) {
          const copy = foregroundCopy(data, deviceCrypto, (id) => manager.pushKeyOf(id));
          if (copy !== null) {
            void Notifications.scheduleNotificationAsync({
              content: { title: copy.title, body: copy.body, data: localNotificationData(copy) },
              trigger: null,
            });
            return {
              shouldShowBanner: false,
              shouldShowList: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
            };
          }
        }
        return {
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      },
    });
    const taps = Notifications.addNotificationResponseReceivedListener((response) => {
      tapInbox.put(response.notification.request.content.data);
    });
    // A tap that started the app: the listener above was not there yet.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response !== null) tapInbox.put(response.notification.request.content.data);
    });
    return () => {
      taps.remove();
      Notifications.setNotificationHandler(null);
    };
  }, [manager]);

  return null;
}
