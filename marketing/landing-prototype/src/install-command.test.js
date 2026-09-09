// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTALL_PLATFORMS,
  initialInstallPlatform,
  mountQuickInstall,
  renderQuickInstall,
} from "./install-command.js";

function fixture(navigatorLike = { platform: "MacIntel" }) {
  const root = document.createElement("div");
  root.innerHTML = renderQuickInstall();
  document.body.append(root);
  const dispose = mountQuickInstall(root, { navigatorLike });
  return { dispose, root, shell: root.querySelector("[data-quick-install]") };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("initialInstallPlatform", () => {
  it("uses Windows only as an initial hint and otherwise falls back to macOS", () => {
    expect(initialInstallPlatform({ userAgentData: { platform: "Windows" } })).toBe("win");
    expect(initialInstallPlatform({ userAgent: "Linux x86_64" })).toBe("mac");
    expect(initialInstallPlatform({})).toBe("mac");
  });
});

describe("quick install command", () => {
  it("keeps the visible copy focused on the install action", () => {
    const { dispose, root } = fixture();

    expect(root.querySelector("[data-release-version]")).toBeNull();
    expect(root.querySelector(".quick-install__platform-index")).toBeNull();
    expect(root.querySelector(".quick-install__title").textContent).toBe("Quick install");
    expect(root.querySelector("[data-install-status]").textContent).toBe("Apple Silicon");
    expect(root.querySelector(".quick-install__selector > .quick-install__recommended").textContent).toBe(
      "Recommended",
    );
    expect(root.querySelector('[data-install-platform="mac"] .quick-install__recommended')).toBeNull();

    dispose();
  });

  it("keeps both platform controls visible and exposes selected tab state", () => {
    const { dispose, root, shell } = fixture({
      platform: "Win32",
    });
    const controls = [...root.querySelectorAll("[data-install-platform]")];

    expect(shell.dataset.platform).toBe("win");
    expect(controls).toHaveLength(2);
    expect(controls.map((control) => control.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
    ]);
    expect(root.querySelector("[data-install-command]").textContent).toBe(
      INSTALL_PLATFORMS.win.command,
    );

    dispose();
  });

  it("changes the command only after an explicit choice", () => {
    const { dispose, root, shell } = fixture();
    root.querySelector('[data-install-platform="win"]').click();

    expect(shell.dataset.platform).toBe("win");
    expect(root.querySelector("[data-install-command]").textContent).toBe(
      INSTALL_PLATFORMS.win.command,
    );

    dispose();
  });

  it("supports roving keyboard selection", () => {
    const { dispose, root, shell } = fixture();
    const mac = root.querySelector('[data-install-platform="mac"]');
    mac.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(shell.dataset.platform).toBe("win");
    expect(document.activeElement).toBe(root.querySelector('[data-install-platform="win"]'));

    dispose();
  });

  it("announces copy success without replacing selectable command text", async () => {
    vi.useFakeTimers();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const root = document.createElement("div");
    root.innerHTML = renderQuickInstall();
    const dispose = mountQuickInstall(root, {
      clipboard,
      navigatorLike: { platform: "MacIntel" },
    });

    root.querySelector("[data-install-copy]").click();
    await vi.runAllTicks();

    expect(clipboard.writeText).toHaveBeenCalledWith(INSTALL_PLATFORMS.mac.command);
    expect(root.querySelector("[data-install-command]").textContent).toBe(
      INSTALL_PLATFORMS.mac.command,
    );
    expect(root.querySelector("[data-install-feedback]").textContent).toBe(
      "Command copied.",
    );

    dispose();
  });

  it("keeps the command selectable and reports clipboard failure", async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const root = document.createElement("div");
    root.innerHTML = renderQuickInstall();
    const dispose = mountQuickInstall(root, {
      clipboard,
      navigatorLike: { platform: "MacIntel" },
    });

    root.querySelector("[data-install-copy]").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector("[data-install-command]").textContent).toBe(
      INSTALL_PLATFORMS.mac.command,
    );
    expect(root.querySelector("[data-install-feedback]").textContent).toContain(
      "Select the command",
    );

    dispose();
  });
});
