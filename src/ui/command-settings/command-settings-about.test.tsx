// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sections and pieces an area mounts pull in host-backed stores; stub them for jsdom.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      loadState: { state: "ready", fresh: false },
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock("../../lib/native-notification", () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock("../../chrome/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../chrome/events")>();
  return { ...actual, reportPersistError: vi.fn() };
});
const shell = vi.hoisted(() => ({ openUrl: vi.fn(async (_url: string) => {}) }));
vi.mock("../../host/shell-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../host/shell-host")>()),
  openUrl: shell.openUrl,
}));

// The import order is load-bearing: with the kit below these imports, this suite fails at import
// with an xterm "Data error" (tiny-inflate in the unicode-graphemes addon). Root cause unknown.
import {
  clickIn,
  openSurface as open,
  resetCommandSettings,
  rowOf,
} from "./command-settings-test-kit";
import { signal } from "@preact/signals";
import { activeUpdateController } from "../../updater/active-update-controller";
import { appVersion } from "../../updater/app-version";
import type { UpdateController, UpdateView } from "../../updater/update-controller";
import { settle } from "../controls/preset-test-kit";
import { commandScope } from "./command-settings-state";

function controller(view: Partial<UpdateView> = {}): UpdateController {
  return {
    view: signal<UpdateView>({
      phase: "hidden",
      currentVersion: "",
      availableVersion: "",
      notes: "",
      ...view,
    }),
    start: vi.fn(async () => {}),
    checkNow: vi.fn(async () => "current" as const),
    download: vi.fn(async () => {}),
    installAndRelaunch: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  } as unknown as UpdateController;
}

beforeEach(() => {
  resetCommandSettings();
  commandScope.value = "about";
  appVersion.value = "0.11.0";
  shell.openUrl.mockClear();
});

afterEach(() => {
  activeUpdateController.value = null;
  vi.restoreAllMocks();
});

const press = (): HTMLButtonElement =>
  rowOf("about:update")?.querySelector("button") as HTMLButtonElement;

describe("the About rows", () => {
  it("shows the running version and checks on demand, then says what the check found", async () => {
    const updater = controller();
    activeUpdateController.value = updater;
    await open();
    expect(rowOf("about:update")?.textContent).toContain("Currently 0.11.0");
    expect(press().textContent).toBe("check");

    await clickIn(press());
    expect(updater.checkNow).toHaveBeenCalledTimes(1);
    expect(rowOf("about:update")?.textContent).toContain("You're on the latest version");
  });

  it("says so when the check fails", async () => {
    const updater = controller();
    vi.mocked(updater.checkNow).mockResolvedValue("failed");
    activeUpdateController.value = updater;
    await open();
    await clickIn(press());
    expect(rowOf("about:update")?.textContent).toContain("Couldn't reach the update server");
  });

  it("downloads an available update, and installs a downloaded one instead of downloading again", async () => {
    const updater = controller({ phase: "available" });
    activeUpdateController.value = updater;
    await open();
    expect(press().textContent).toBe("update");
    await clickIn(press());
    expect(updater.download).toHaveBeenCalledTimes(1);

    (updater.view as ReturnType<typeof signal<UpdateView>>).value = {
      ...updater.view.value,
      phase: "downloaded",
    };
    await settle();
    expect(press().textContent).toBe("install & relaunch");
    await clickIn(press());
    expect(updater.installAndRelaunch).toHaveBeenCalledTimes(1);
    expect(updater.download).toHaveBeenCalledTimes(1);
  });

  it.each(["downloading", "installing"] as const)("is inert while it is %s", async (phase) => {
    const updater = controller({ phase });
    activeUpdateController.value = updater;
    await open();
    expect(press().disabled).toBe(true);
    await clickIn(press());
    expect(updater.checkNow).not.toHaveBeenCalled();
  });

  it("blocks a second install after the installer took over, and says what to do", async () => {
    const updater = controller({ phase: "install-failed", installRetryable: false });
    activeUpdateController.value = updater;
    await open();
    expect(press().textContent).toBe("install failed");
    expect(press().disabled).toBe(true);
    expect(rowOf("about:update")?.textContent).toContain("Quit and reopen Deck");
    await clickIn(press());
    expect(updater.installAndRelaunch).not.toHaveBeenCalled();
  });

  it("cannot be pressed with no updater to drive", async () => {
    await open();
    expect(press().disabled).toBe(true);
  });

  it("opens the release notes and the feedback page with the running version", async () => {
    await open();
    await clickIn(rowOf("about:notes")?.querySelector("button"));
    expect(shell.openUrl.mock.calls[0]?.[0]).toContain("changelog");
    await clickIn(rowOf("about:feedback")?.querySelector("button"));
    expect(shell.openUrl.mock.calls[1]?.[0]).toBe("https://deck.spacevibe.dev/feedback?v=0.11.0");
  });
});
