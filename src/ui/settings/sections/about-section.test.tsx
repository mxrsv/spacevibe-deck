// @vitest-environment jsdom
import { signal } from "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the factory below can close over it — `vi.mock` runs before any
// top-level `const` in this file is initialised.
const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => {}),
}));
vi.mock("../../../host/shell-host", () => ({ openUrl }));

import { AboutSection } from "./about-section";
import { activeUpdateController } from "../../../updater/active-update-controller";
import { appVersion } from "../../../updater/app-version";
import type { UpdateController, UpdateView } from "../../../updater/update-controller";

function controller(view: Partial<UpdateView> = {}): UpdateController {
  return {
    view: signal<UpdateView>({
      phase: "hidden",
      // Matches the real `HIDDEN_VIEW`: until a check finds something, the
      // controller knows no version at all. An earlier fixture filled this in
      // and hid the fact that the row had nothing to show.
      currentVersion: view.phase === undefined ? "" : "0.11.0",
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

function pills(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button.cfg-btn")];
}

describe("AboutSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    openUrl.mockClear();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    appVersion.value = "0.11.0";
  });

  afterEach(() => {
    act(() => render(null, host));
    activeUpdateController.value = null;
  });

  it("shows the running version and offers a check when nothing was found", () => {
    activeUpdateController.value = controller();
    act(() => render(<AboutSection />, host));

    expect(host.textContent).toContain("Currently 0.11.0");
    expect(pills(host)[0].textContent).toBe("check");
  });

  it("checks on demand — the door Windows never had", async () => {
    // The macOS menu bar carries `Check for Updates…`; `menu.rs` builds no
    // menu off macOS, so without this row a Windows user can only recheck by
    // restarting Deck.
    const updater = controller();
    activeUpdateController.value = updater;
    act(() => render(<AboutSection />, host));

    await act(async () => {
      pills(host)[0].click();
    });

    expect(updater.checkNow).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("You're on the latest version");
  });

  it("drives the existing state machine instead of a second one", async () => {
    const updater = controller({
      phase: "available",
      availableVersion: "1.0.0",
    });
    activeUpdateController.value = updater;
    act(() => render(<AboutSection />, host));

    expect(pills(host)[0].textContent).toBe("update");
    await act(async () => {
      pills(host)[0].click();
    });

    expect(updater.download).toHaveBeenCalledTimes(1);
    expect(updater.checkNow).not.toHaveBeenCalled();
  });

  it("installs from the downloaded phase rather than downloading again", async () => {
    const updater = controller({
      phase: "downloaded",
      availableVersion: "1.0.0",
    });
    activeUpdateController.value = updater;
    act(() => render(<AboutSection />, host));

    expect(pills(host)[0].textContent).toBe("install & relaunch");
    await act(async () => {
      pills(host)[0].click();
    });

    expect(updater.installAndRelaunch).toHaveBeenCalledTimes(1);
    expect(updater.download).not.toHaveBeenCalled();
  });

  it("disables the pill while work is in flight", () => {
    activeUpdateController.value = controller({ phase: "downloading" });
    act(() => render(<AboutSection />, host));

    expect(pills(host)[0].disabled).toBe(true);
  });

  it("stays usable with no controller — the pill simply cannot be pressed", () => {
    activeUpdateController.value = null;
    act(() => render(<AboutSection />, host));

    expect(pills(host)[0].disabled).toBe(true);
    expect(pills(host)[1].disabled).toBe(false);
  });

  it("says something when the check fails", async () => {
    const updater = controller();
    (updater.checkNow as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("failed");
    activeUpdateController.value = updater;
    act(() => render(<AboutSection />, host));

    await act(async () => {
      pills(host)[0].click();
    });

    expect(host.textContent).toContain("Couldn't reach the update server");
  });

  it("shows the running version even with no update available", () => {
    activeUpdateController.value = controller();
    act(() => render(<AboutSection />, host));

    expect(host.textContent).toContain("0.11.0");
  });

  it("opens the release notes", async () => {
    activeUpdateController.value = controller();
    act(() => render(<AboutSection />, host));

    await act(async () => {
      pills(host)[1].click();
    });

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl.mock.calls[0]?.[0]).toContain("changelog");
  });
});
