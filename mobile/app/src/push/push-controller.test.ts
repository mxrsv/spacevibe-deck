import { describe, expect, it, vi } from "vitest";
import {
  createPushController,
  type NotificationApi,
  type PermissionStatus,
} from "./push-controller";
import type { EnvironmentFacts } from "./push-environment";

const BUILD: EnvironmentFacts = {
  executionEnvironment: "standalone",
  projectId: null,
  isDev: true,
  pushEnvOverride: null,
};
const GO: EnvironmentFacts = {
  executionEnvironment: "storeClient",
  projectId: null,
  isDev: true,
  pushEnvOverride: null,
};

function api(initial: PermissionStatus, afterPrompt: PermissionStatus = "granted") {
  let permission = initial;
  let token = "tok-1";
  const fake = {
    permission: vi.fn<() => Promise<PermissionStatus>>(async () => permission),
    requestPermission: vi.fn<() => Promise<PermissionStatus>>(
      async () => (permission = afterPrompt),
    ),
    token: vi.fn<() => Promise<string>>(async () => token),
    unregister: vi.fn<() => Promise<void>>(async () => {}),
  } satisfies NotificationApi;
  return { fake, rotate: (next: string) => (token = next) };
}

describe("push controller", () => {
  it("registers the APNs token with the sandbox env in a debug build once permission is granted", async () => {
    const { fake } = api("granted");
    const push = createPushController(BUILD, fake);
    expect(push.registration()).toBeNull();
    await push.sync(true, false);
    expect(push.status()).toEqual({ state: "on" });
    expect(push.registration()).toEqual({
      t: "push-token",
      kind: "apns",
      token: "tok-1",
      env: "sandbox",
    });
    expect(fake.requestPermission).not.toHaveBeenCalled();
  });

  it("does not ask for permission at launch, only when told to", async () => {
    const { fake } = api("undetermined");
    const push = createPushController(BUILD, fake);
    await push.sync(true, false);
    expect(fake.requestPermission).not.toHaveBeenCalled();
    expect(push.registration()).toBeNull();
    expect(push.status()).toEqual({ state: "off" });
    await push.sync(true, true);
    expect(fake.requestPermission).toHaveBeenCalledTimes(1);
    expect(push.registration()?.t).toBe("push-token");
  });

  it("registers nothing when the user declines, and says so", async () => {
    const { fake } = api("undetermined", "denied");
    const push = createPushController(BUILD, fake);
    await push.sync(true, true);
    expect(push.status()).toEqual({ state: "denied" });
    expect(push.registration()).toBeNull();
    expect(fake.token).not.toHaveBeenCalled();
  });

  it("the off switch unregisters, sends nothing, and never re-registers", async () => {
    const { fake } = api("granted");
    const push = createPushController(BUILD, fake);
    await push.sync(true, false);
    await push.sync(false, false);
    expect(fake.unregister).toHaveBeenCalledTimes(1);
    expect(push.registration()).toBeNull();
    expect(push.status()).toEqual({ state: "off" });
    await push.refreshToken(); // a rotation while off must not bring it back
    expect(push.registration()).toBeNull();
    expect(fake.token).toHaveBeenCalledTimes(1);
  });

  it("picks up a rotated token and tells subscribers", async () => {
    const { fake, rotate } = api("granted");
    const push = createPushController(BUILD, fake);
    const heard = vi.fn<() => void>();
    push.subscribe(heard);
    await push.sync(true, false);
    heard.mockClear();
    rotate("tok-2");
    await push.refreshToken();
    expect(push.registration()).toMatchObject({ token: "tok-2" });
    expect(heard).toHaveBeenCalled();
  });

  it("is unavailable in Expo Go without an EAS project, and registers Expo's token with one", async () => {
    const { fake } = api("granted");
    const unavailable = createPushController(GO, fake);
    await unavailable.sync(true, true);
    expect(unavailable.status()).toMatchObject({ state: "unavailable" });
    expect(unavailable.registration()).toBeNull();
    expect(fake.permission).not.toHaveBeenCalled();

    const withProject = createPushController({ ...GO, projectId: "pid" }, fake);
    await withProject.sync(true, true);
    expect(withProject.registration()).toMatchObject({ kind: "expo", env: "production" });
  });

  it("reports an error when the token cannot be fetched", async () => {
    const { fake } = api("granted");
    fake.token.mockRejectedValueOnce(new Error("no network"));
    const push = createPushController(BUILD, fake);
    await push.sync(true, false);
    expect(push.status()).toEqual({ state: "error" });
    expect(push.registration()).toBeNull();
  });
});
