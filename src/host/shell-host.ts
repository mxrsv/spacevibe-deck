/**
 * Clipboard, notifications, external links, relaunch and app version — the
 * replacements for `@tauri-apps/plugin-clipboard-manager`,
 * `plugin-notification`, `plugin-opener`, `plugin-process` and `api/app`.
 */
import { invoke } from './bridge';

export function openUrl(url: string): Promise<void> {
  return invoke('shell_open_url', { url });
}

export function readText(): Promise<string> {
  return invoke<string>('clipboard_read_text');
}

export function writeText(text: string): Promise<void> {
  return invoke('clipboard_write_text', { text });
}

export function isPermissionGranted(): Promise<boolean> {
  return invoke<boolean>('notification_permission_granted');
}

export function requestPermission(): Promise<'granted' | 'denied'> {
  return invoke<'granted' | 'denied'>('notification_request_permission');
}

export interface NotificationOptions {
  readonly title: string;
  readonly body?: string;
}

export function sendNotification(options: NotificationOptions): Promise<void> {
  return invoke('notification_send', options);
}

export function relaunch(): Promise<void> {
  return invoke('app_relaunch');
}

export function getVersion(): Promise<string> {
  return invoke<string>('app_version');
}
