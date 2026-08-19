import { describe, expect, it, vi } from "vitest";
import {
  createUpdateController,
  UPDATE_UNSUPPORTED,
  type PendingUpdate,
  type UpdateControllerDependencies,
} from "./update-controller";

function pending(overrides: Partial<PendingUpdate> = {}): PendingUpdate {
  return {
    currentVersion: "0.9.0",
    version: "0.10.0",
    notes: "A safer and faster Deck release.",
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setup(
  update: PendingUpdate | null = pending(),
  overrides: Partial<UpdateControllerDependencies> = {},
) {
  const deps: UpdateControllerDependencies = {
    platform: "macos",
    check: vi.fn().mockResolvedValue(update),
    confirmInstall: vi.fn().mockResolvedValue(true),
    flush: vi.fn().mockResolvedValue(undefined),
    relaunch: vi.fn().mockResolvedValue(undefined),
    report: vi.fn(),
    recordAttempt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { controller: createUpdateController(deps), deps, update };
}

describe("createUpdateController", () => {
  it("checks once and leaves an available update undownloaded", async () => {
    const { controller, deps, update } = setup();

    await controller.start();
    await controller.start();

    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(update?.download).not.toHaveBeenCalled();
    expect(controller.view.value).toMatchObject({
      phase: "available",
      currentVersion: "0.9.0",
      availableVersion: "0.10.0",
    });
  });

  it("checks again on manual request after the startup check found no update", async () => {
    const update = pending();
    const check = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(update);
    const { controller } = setup(null, { check });

    await controller.start();
    const result = await controller.checkNow();

    expect(check).toHaveBeenCalledTimes(2);
    expect(result).toBe("available");
    expect(controller.view.value).toMatchObject({
      phase: "available",
      availableVersion: "0.10.0",
    });
    expect(update.download).not.toHaveBeenCalled();
  });

  it("stays hidden when current, unsupported, or the automatic check fails", async () => {
    const current = setup(null);
    await current.controller.start();
    expect(current.controller.view.value.phase).toBe("hidden");

    const unsupported = setup(pending(), { platform: "unsupported" });
    await unsupported.controller.start();
    expect(unsupported.deps.check).not.toHaveBeenCalled();

    const failure = setup(null, {
      check: vi.fn().mockRejectedValue(new Error("offline")),
    });
    await failure.controller.start();
    expect(failure.controller.view.value.phase).toBe("hidden");
    expect(failure.deps.report).toHaveBeenCalledWith("Update check failed", expect.any(Error));
  });

  it("reports a host with no updater as unsupported, not as up to date", async () => {
    // The distinction the Electron host had no way to make: it reports a real
    // platform, so `platform === "unsupported"` never fires, and a `null`
    // check made the menu answer "SpaceVibe Deck is up to date" to a build
    // that cannot update at all.
    const { controller, deps } = setup(null, {
      check: vi.fn().mockResolvedValue(UPDATE_UNSUPPORTED),
    });

    await expect(controller.checkNow()).resolves.toBe("unsupported");
    expect(controller.view.value.phase).toBe("hidden");
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("requires separate download and install actions", async () => {
    const { controller, deps, update } = setup();
    await controller.start();

    await controller.download();

    expect(controller.view.value.phase).toBe("downloaded");
    expect(update?.install).not.toHaveBeenCalled();

    await controller.installAndRelaunch();

    expect(deps.confirmInstall).toHaveBeenCalledTimes(1);
    expect(deps.flush).toHaveBeenCalledTimes(1);
    expect(update?.install).toHaveBeenCalledTimes(1);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  it("preserves the downloaded update when the safety gate is cancelled", async () => {
    const { controller, deps, update } = setup(pending(), {
      confirmInstall: vi.fn().mockResolvedValue(false),
    });
    await controller.start();
    await controller.download();

    await controller.installAndRelaunch();

    expect(controller.view.value.phase).toBe("downloaded");
    expect(deps.flush).not.toHaveBeenCalled();
    expect(update?.install).not.toHaveBeenCalled();
  });

  it("flush rejection never installs or relaunches and retains retry state", async () => {
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error("store locked"))
      .mockResolvedValueOnce(undefined);
    const { controller, deps, update } = setup(pending(), { flush });
    await controller.start();
    await controller.download();

    await controller.installAndRelaunch();

    expect(controller.view.value.phase).toBe("install-failed");
    expect(update?.install).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();

    await controller.installAndRelaunch();
    expect(update?.install).toHaveBeenCalledTimes(1);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  it("supports download and install retries", async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error("installer"))
      .mockResolvedValueOnce(undefined);
    const { controller, update } = setup(pending({ download, install }));
    await controller.start();

    await controller.download();
    expect(controller.view.value.phase).toBe("download-failed");
    await controller.download();
    expect(controller.view.value.phase).toBe("downloaded");

    await controller.installAndRelaunch();
    expect(controller.view.value.phase).toBe("install-failed");
    await controller.installAndRelaunch();
    expect(update?.install).toHaveBeenCalledTimes(2);
  });

  it("retries relaunch without reinstalling", async () => {
    const relaunch = vi
      .fn()
      .mockRejectedValueOnce(new Error("restart"))
      .mockResolvedValueOnce(undefined);
    const { controller, update } = setup(pending(), { relaunch });
    await controller.start();
    await controller.download();
    await controller.installAndRelaunch();

    expect(controller.view.value.phase).toBe("relaunch-failed");
    await controller.relaunch();
    expect(update?.install).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(2);
  });

  it("drops re-entrant downloads", async () => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { controller } = setup(pending({ download }));
    await controller.start();

    const first = controller.download();
    const second = controller.download();
    expect(download).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  it("bounds untrusted release notes", async () => {
    const { controller } = setup(pending({ notes: "x".repeat(1_000) }));
    await controller.start();

    expect(controller.view.value.notes.length).toBeLessThanOrEqual(400);
    expect(controller.view.value.notes.endsWith("…")).toBe(true);
  });
});

describe("install breadcrumb", () => {
  it("records the target version before handing over to the installer", async () => {
    const { controller, deps, update } = setup();
    await controller.checkNow();
    await controller.download();
    await controller.installAndRelaunch();

    expect(deps.recordAttempt).toHaveBeenCalledWith(update!.version);
    // Ordering is the whole point: on Windows the installer exits this
    // process, so anything after install() may never run.
    const recordOrder = vi.mocked(deps.recordAttempt).mock.invocationCallOrder[0];
    const installOrder = vi.mocked(update!.install).mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(installOrder);
  });

  it("does not record anything when the user cancels the confirmation", async () => {
    const { controller, deps } = setup(pending(), {
      confirmInstall: vi.fn().mockResolvedValue(false),
    });
    await controller.checkNow();
    await controller.download();
    await controller.installAndRelaunch();

    expect(deps.recordAttempt).not.toHaveBeenCalled();
  });
});

describe("breadcrumb failure aborts the install", () => {
  it("never calls install() when the attempt could not be recorded", async () => {
    const { controller, deps, update } = setup(pending(), {
      recordAttempt: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    await controller.checkNow();
    await controller.download();
    await controller.installAndRelaunch();

    // Installing blind is worse than not installing: a failure would then be
    // undetectable forever, which is the silence this mechanism exists to end.
    expect(update!.install).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(controller.view.value.phase).toBe("install-failed");
    expect(deps.report).toHaveBeenCalledWith(
      "Could not record the update attempt",
      expect.any(Error),
    );
  });

  it("leaves the app usable and retryable after that abort", async () => {
    const recordAttempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const { controller, update } = setup(pending(), { recordAttempt });
    await controller.checkNow();
    await controller.download();
    await controller.installAndRelaunch();
    await controller.installAndRelaunch();

    expect(update!.install).toHaveBeenCalledTimes(1);
  });
});

describe("update check single-flight", () => {
  it("does not auto-check when another window already claimed the check", async () => {
    const { controller, deps } = setup(null, { claim: async () => false });

    await controller.start();

    expect(deps.check).not.toHaveBeenCalled();
  });

  it("auto-checks when this window wins the claim", async () => {
    const { controller, deps } = setup(null, { claim: async () => true });

    await controller.start();

    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("auto-checks when the claim command fails — a broken single-flight must not disable updates", async () => {
    const { controller, deps } = setup(null, {
      claim: async () => {
        throw new Error("command not found");
      },
    });

    await controller.start();

    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("never gates an explicit Check for Updates…", async () => {
    const { controller, deps } = setup(null, { claim: async () => false });

    await controller.checkNow();

    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("releases the single-flight claim even when the check throws", async () => {
    const releaseClaim = vi.fn().mockResolvedValue(undefined);
    const { controller } = setup(null, {
      check: vi.fn().mockRejectedValue(new Error("network down")),
      claim: async () => true,
      releaseClaim,
    });

    await controller.start();

    expect(releaseClaim).toHaveBeenCalledOnce();
  });
});
