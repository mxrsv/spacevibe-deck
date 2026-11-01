/** Electron notification adapter. Support checks do not reveal OS authorization;
 * the OS owns permission and delivery. A successful send is not a delivery receipt. */
import {
  isPermissionGranted as pluginIsPermissionGranted,
  requestPermission as pluginRequestPermission,
  sendNotification as pluginSendNotification,
} from "../host/shell-host";

/** Seam over the plugin's permission + send functions — injected so tests
 * never call the real host. */
export interface NotificationClient {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<"granted" | "denied" | "default">;
  sendNotification: (options: AgentNotificationPayload) => void | Promise<void>;
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
  paneId?: number;
}

const realClient: NotificationClient = {
  isPermissionGranted: pluginIsPermissionGranted,
  requestPermission: pluginRequestPermission,
  sendNotification: pluginSendNotification,
};

/**
 * Build the agent-notification adapter. Pass a fake `client` in tests;
 * production callers omit it and get the real Electron-backed client.
 */
export function createAgentNotificationAdapter(client: NotificationClient = realClient): {
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
     * Re-checks host support before sending. Electron cannot read macOS
     * authorization; the OS may suppress an otherwise supported alert.
     * A resolved promise here means only
     * "the call was made without throwing", not "the OS displayed it".
     */
    async send(payload: AgentNotificationPayload): Promise<void> {
      try {
        if (!(await client.isPermissionGranted())) {
          return;
        }
        await client.sendNotification(payload);
      } catch {
        // Controlled no-op: a rejected host call must not
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
export function sendAgentNotification(payload: AgentNotificationPayload): Promise<void> {
  return createAgentNotificationAdapter().send(payload);
}
