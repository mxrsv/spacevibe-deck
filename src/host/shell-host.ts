/**
 * Clipboard, notifications, external links, relaunch and app version — the
 * replacements for `@tauri-apps/plugin-clipboard-manager`,
 * `plugin-notification`, `plugin-opener`, `plugin-process` and `api/app`.
 */
import { invoke, listen, type UnlistenFn } from "./bridge";

export function openUrl(url: string): Promise<void> {
  return invoke("shell_open_url", { url });
}

export function readText(): Promise<string> {
  return invoke<string>("clipboard_read_text");
}

export function writeText(text: string): Promise<void> {
  return invoke("clipboard_write_text", { text });
}

export function isPermissionGranted(): Promise<boolean> {
  return invoke<boolean>("notification_permission_granted");
}

export function requestPermission(): Promise<"granted" | "denied"> {
  return invoke<"granted" | "denied">("notification_request_permission");
}

export interface NotificationOptions {
  readonly title: string;
  readonly body?: string;
  readonly paneId?: number;
}

export function sendNotification(options: NotificationOptions): Promise<void> {
  const { title, body, paneId } = options;
  return invoke("notification_send", { title, body, paneId });
}

export function setAttentionBadge(count: number): Promise<void> {
  return invoke("attention_badge_set", { count });
}

export function openNotificationSettings(): Promise<boolean> {
  return invoke<boolean>("notification_open_settings");
}

export function listenNotificationActivated(
  handler: (paneId: number) => void,
): Promise<UnlistenFn> {
  return listen<{ paneId: number }>("notification:activated", ({ payload }) => {
    if (Number.isSafeInteger(payload?.paneId) && payload.paneId >= 0) handler(payload.paneId);
  });
}

export function relaunch(): Promise<void> {
  return invoke("app_relaunch");
}

export function getVersion(): Promise<string> {
  return invoke<string>("app_version");
}
