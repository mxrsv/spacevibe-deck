import { describe, expect, it, vi } from 'vitest';
import { createAgentNotificationAdapter, type NotificationClient } from './native-notification';

function makeClient(overrides: Partial<NotificationClient> = {}): NotificationClient & {
  isPermissionGranted: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
} {
  return {
    isPermissionGranted: vi.fn().mockResolvedValue(false),
    requestPermission: vi.fn().mockResolvedValue('denied'),
    sendNotification: vi.fn(),
    ...overrides,
  } as NotificationClient & {
    isPermissionGranted: ReturnType<typeof vi.fn>;
    requestPermission: ReturnType<typeof vi.fn>;
    sendNotification: ReturnType<typeof vi.fn>;
  };
}

describe('createAgentNotificationAdapter', () => {
  describe('already granted', () => {
    it('requestPermission() returns true without prompting', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(true),
      });
      const adapter = createAgentNotificationAdapter(client);

      const granted = await adapter.requestPermission();

      expect(granted).toBe(true);
      expect(client.requestPermission).not.toHaveBeenCalled();
    });

    it('send() calls sendNotification once', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(true),
      });
      const adapter = createAgentNotificationAdapter(client);

      await adapter.send({ title: 'Agent finished', body: 'Workspace foo' });

      expect(client.sendNotification).toHaveBeenCalledOnce();
      expect(client.sendNotification).toHaveBeenCalledWith({
        title: 'Agent finished',
        body: 'Workspace foo',
      });
    });
  });

  describe('grant flow', () => {
    it('requestPermission() returns true when the user grants', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      });
      const adapter = createAgentNotificationAdapter(client);

      const granted = await adapter.requestPermission();

      expect(granted).toBe(true);
      expect(client.requestPermission).toHaveBeenCalledOnce();
    });
  });

  describe('deny flow', () => {
    it('requestPermission() returns false when the user denies', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });
      const adapter = createAgentNotificationAdapter(client);

      const granted = await adapter.requestPermission();

      expect(granted).toBe(false);
    });

    it('a subsequent send() does not call sendNotification', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });
      const adapter = createAgentNotificationAdapter(client);

      await adapter.requestPermission();
      await adapter.send({ title: 'Agent finished' });

      expect(client.sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('revoked between grant and send', () => {
    it('send() is a no-op when permission is no longer granted at send time', async () => {
      let granted = true;
      const client = makeClient({
        isPermissionGranted: vi.fn(() => Promise.resolve(granted)),
      });
      const adapter = createAgentNotificationAdapter(client);

      // Permission was granted earlier...
      expect(await adapter.requestPermission()).toBe(true);
      // ...but revoked before the send happens.
      granted = false;

      await adapter.send({ title: 'Agent finished' });

      expect(client.sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('API rejects/throws', () => {
    it('requestPermission() returns false when isPermissionGranted rejects', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockRejectedValue(new Error('plugin unavailable')),
      });
      const adapter = createAgentNotificationAdapter(client);

      await expect(adapter.requestPermission()).resolves.toBe(false);
    });

    it('requestPermission() returns false when requestPermission rejects', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(false),
        requestPermission: vi.fn().mockRejectedValue(new Error('denied by OS')),
      });
      const adapter = createAgentNotificationAdapter(client);

      await expect(adapter.requestPermission()).resolves.toBe(false);
    });

    it('send() is a controlled no-op when isPermissionGranted rejects', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockRejectedValue(new Error('plugin unavailable')),
      });
      const adapter = createAgentNotificationAdapter(client);

      await expect(adapter.send({ title: 'Agent finished' })).resolves.toBeUndefined();
      expect(client.sendNotification).not.toHaveBeenCalled();
    });

    it('send() is a controlled no-op when sendNotification throws synchronously', async () => {
      const client = makeClient({
        isPermissionGranted: vi.fn().mockResolvedValue(true),
        sendNotification: vi.fn(() => {
          throw new Error('OS notification center unavailable');
        }),
      });
      const adapter = createAgentNotificationAdapter(client);

      await expect(adapter.send({ title: 'Agent finished' })).resolves.toBeUndefined();
    });
  });
});
