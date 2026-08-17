import { describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals";
import type {
  UpdateCheckResult,
  UpdateController,
  UpdateView,
} from "./update-controller";
import { RELEASE_NOTES_URL, runUpdateMenuAction } from "./update-menu-actions";

function controller(
  result: UpdateCheckResult,
  view: UpdateView = {
    phase: "hidden",
    currentVersion: "",
    availableVersion: "",
    notes: "",
  },
): Pick<UpdateController, "checkNow" | "view"> {
  return {
    view: signal(view),
    checkNow: vi.fn().mockResolvedValue(result),
  };
}

function setup(updateController: Pick<UpdateController, "checkNow" | "view">) {
  return {
    deps: {
      controller: updateController,
      openUrl: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      report: vi.fn(),
    },
  };
}

describe("runUpdateMenuAction", () => {
  it("checks manually and confirms when Deck is current", async () => {
    const current = controller("current");
    const { deps } = setup(current);

    const handled = await runUpdateMenuAction("check-for-updates", deps);

    expect(handled).toBe(true);
    expect(current.checkNow).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      "SpaceVibe Deck is up to date.",
      "info",
    );
  });

  it("reports the available version without downloading it", async () => {
    const available = controller("available", {
      phase: "available",
      currentVersion: "0.9.0",
      availableVersion: "0.10.0",
      notes: "",
    });
    const { deps } = setup(available);

    await runUpdateMenuAction("check-for-updates", deps);

    expect(deps.notify).toHaveBeenCalledWith(
      "SpaceVibe Deck 0.10.0 is available. Use Update in the toolbar to download it.",
      "info",
    );
  });

  it("opens the trusted web release notes URL", async () => {
    const { deps } = setup(controller("current"));

    const handled = await runUpdateMenuAction("open-release-notes", deps);

    expect(RELEASE_NOTES_URL).toBe(
      "https://deck.spacevibe.dev/landing-prototype/changelog/",
    );
    expect(handled).toBe(true);
    expect(deps.openUrl).toHaveBeenCalledWith(RELEASE_NOTES_URL);
  });

  it("reports an opener failure and shows a recoverable error", async () => {
    const { deps } = setup(controller("current"));
    deps.openUrl.mockRejectedValue(new Error("browser unavailable"));

    await runUpdateMenuAction("open-release-notes", deps);

    expect(deps.report).toHaveBeenCalledWith(
      "Opening release notes failed",
      expect.any(Error),
    );
    expect(deps.notify).toHaveBeenCalledWith(
      "Couldn't open Release Notes in your browser.",
      "error",
    );
  });

  it("returns false for unrelated menu actions", async () => {
    const { deps } = setup(controller("current"));

    const handled = await runUpdateMenuAction("toggle-settings", deps);

    expect(handled).toBe(false);
    expect(deps.openUrl).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
