import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { EnvironmentFacts } from "./push-environment";
import type { NotificationApi, PermissionStatus } from "./push-controller";

function extra(): Record<string, unknown> {
  const value: unknown = Constants.expoConfig?.extra;
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The facts `planPush` decides on, read from the running app. */
export function environmentFacts(): EnvironmentFacts {
  const eas = extra().eas;
  const projectId =
    typeof eas === "object" &&
    eas !== null &&
    typeof (eas as { projectId?: unknown }).projectId === "string"
      ? (eas as { projectId: string }).projectId
      : null;
  const override = extra().pushEnv;
  return {
    executionEnvironment: String(Constants.executionEnvironment),
    projectId,
    isDev: __DEV__,
    pushEnvOverride: typeof override === "string" ? override : null,
  };
}

function status(value: string): PermissionStatus {
  return value === "granted" || value === "denied" ? value : "undetermined";
}

export const notificationApi: NotificationApi = {
  async permission() {
    return status((await Notifications.getPermissionsAsync()).status);
  },
  async requestPermission() {
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return status(result.status);
  },
  async token(plan) {
    if (plan.mode === "expo") {
      return (await Notifications.getExpoPushTokenAsync({ projectId: plan.projectId })).data;
    }
    return String((await Notifications.getDevicePushTokenAsync()).data);
  },
  unregister: () => Notifications.unregisterForNotificationsAsync(),
};
