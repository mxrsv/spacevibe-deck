/**
 * Thin wrapper around `@tauri-apps/plugin-notification`. Requesting
 * permission and sending a notification are deliberately separate
 * operations — callers decide when to prompt (e.g. once, on first agent
 * completion) independently of when they actually send.
 *
 * The plugin's `sendNotification` returns `void` — there is no delivery
 * receipt from the OS. `send()` therefore only guarantees the call was
 * made without throwing; it never claims the notification was shown.
 *
 * Everything the OS-facing plugin functions live behind is expressed as
 * `NotificationClient` so tests can inject a fake and never touch the real
 * Tauri API.
 */
import {
  isPermissionGranted as pluginIsPermissionGranted,
  requestPermission as pluginRequestPermission,
  sendNotification as pluginSendNotification,
} from "../host/shell-host";

/** Seam over the plugin's permission + send functions — injected so tests
 * never call the real Tauri API. */
export interface NotificationClient {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: { title: string; body?: string }) => void;
}

/**
 * Already-normalized copy for an agent-attention notification (workspace +
 * agent label + kind). Deliberately has no raw-terminal-body field — the
 * caller is responsible for turning terminal output into safe, human
 * readable `title`/`body` text before it reaches this type.
 */
export interface AgentNotificationPayload {
  title: string;
  body?: string;
}

const realClient: NotificationClient = {
  isPermissionGranted: pluginIsPermissionGranted,
  requestPermission: pluginRequestPermission,
  sendNotification: pluginSendNotification,
};

/**
 * Build the agent-notification adapter. Pass a fake `client` in tests;
 * production callers omit it and get the real Tauri-backed client.
 */
export function createAgentNotificationAdapter(
  client: NotificationClient = realClient,
): {
  requestPermission(): Promise<boolean>;
  send(payload: AgentNotificationPayload): Promise<void>;
} {
  return {
    /**
     * Returns whether notifications may be sent. Never mutates settings by
     * itself — if permission is already granted it returns true without
     * prompting; otherwise it prompts once. A rejecting/throwing permission
     * API is a controlled failure: returns false, never throws.
     */
    async requestPermission(): Promise<boolean> {
      try {
        if (await client.isPermissionGranted()) {
          return true;
        }
        const result = await client.requestPermission();
        return result === "granted";
      } catch {
        return false;
      }
    },

    /**
     * Sends an agent-attention notification. Re-checks permission at send
     * time (it may have been granted earlier and revoked since) rather than
     * trusting a cached flag — if not granted, this is a controlled no-op.
     * `sendNotification` returns void, so a resolved promise here means only
     * "the call was made without throwing", not "the OS displayed it".
     */
    async send(payload: AgentNotificationPayload): Promise<void> {
      try {
        if (!(await client.isPermissionGranted())) {
          return;
        }
        client.sendNotification({ title: payload.title, body: payload.body });
      } catch {
        // Controlled no-op: a synchronous throw from the plugin must not
        // propagate to callers.
      }
    },
  };
}

/** Convenience export matching the plan's naming — same adapter, real client. */
export function requestAgentNotificationPermission(): Promise<boolean> {
  return createAgentNotificationAdapter().requestPermission();
}

/** Convenience export matching the plan's naming — same adapter, real client. */
export function sendAgentNotification(
  payload: AgentNotificationPayload,
): Promise<void> {
  return createAgentNotificationAdapter().send(payload);
}
