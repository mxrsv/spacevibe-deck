// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section pulls in the host-backed settings store; stub it so the tree
// mounts under jsdom (same shape as agents-section.test.tsx).
vi.mock("../../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

vi.mock("../../../settings/settings-store", async () => {
  const actual = await vi.importActual<typeof import("../../../settings/settings-store")>(
    "../../../settings/settings-store",
  );
  return { ...actual, updateSettings: vi.fn() };
});

// No host answers, as on Tauri, a preview, and any platform the scan skips.
vi.mock("../../../host/external-apps-host", () => ({
  listExternalApps: vi.fn(async () => []),
}));

import { LinksEditorSection } from "./links-editor-section";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DEFAULT_SETTINGS } from "../../../settings/settings-schema";
import { EXTERNAL_APPS } from "../../../lib/external-app-catalog";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../../../lib/platform";

const UNAVAILABLE = "Not available on Windows";

/**
 * "Open with" writes the app a path goes to when no open workspace holds it.
 * Windows cannot open external apps (`electron/external-apps.ts` returns no
 * apps off macOS), so there the row keeps its place but is unavailable
 * (DL-23.6) and says why in a tooltip. Everywhere else it is what it was.
 */
describe("LinksEditorSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
    vi.mocked(updateSettings).mockReset();
    vi.mocked(updateSettings).mockImplementation((patch) => {
      settings.value = { ...settings.value, ...patch };
    });
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    settings.value = DEFAULT_SETTINGS;
    resetDesktopEnvironmentForTests();
  });

  const mount = async (): Promise<void> => {
    await act(async () => {
      render(<LinksEditorSection />, host);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const row = (): Element => {
    const found = host.querySelector(".cfg-row");
    expect(found).not.toBeNull();
    return found!;
  };

  describe("on macOS", () => {
    beforeEach(() => {
      initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    });

    it("renders the picker live, exactly as before", async () => {
      await mount();

      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Open with"]');
      expect(select).not.toBeNull();
      expect(select?.disabled).toBe(false);
      expect(select?.hasAttribute("aria-disabled")).toBe(false);
      expect(select?.querySelectorAll("option")).toHaveLength(EXTERNAL_APPS.length);
      const pill = select?.parentElement;
      expect(pill?.tagName).toBe("SPAN");
      expect(pill?.className).toBe("cfg-btn cfg-btn--overlay");
      expect(row().querySelector("[title]")).toBeNull();
      expect(row().querySelector("[aria-disabled]")).toBeNull();
      expect(row().querySelector("button")).toBeNull();
    });

    it("keeps its label and its Cmd+click description", async () => {
      await mount();

      expect(row().querySelector(".cfg-row__label")?.textContent).toBe("Open with");
      expect(row().querySelector(".cfg-row__desc")?.textContent).toBe(
        "Cmd+click a path outside your open workspaces",
      );
    });

    it("still writes the chosen app", async () => {
      await mount();
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Open with"]')!;
      const other = EXTERNAL_APPS.find((app) => app.id !== settings.value.externalAppId)!;

      act(() => {
        select.value = other.id;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(updateSettings).toHaveBeenCalledWith({ externalAppId: other.id });
    });
  });

  describe("where the platform is unsupported (browser preview)", () => {
    it("keeps the picker live", async () => {
      initializeDesktopEnvironment({ platform: "unsupported", homeDir: "" });
      await mount();

      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Open with"]');
      expect(select?.disabled).toBe(false);
      expect(row().querySelector("[title]")).toBeNull();
    });
  });

  describe("on Windows", () => {
    beforeEach(() => {
      initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    });

    const control = (): HTMLElement => {
      const found = host.querySelector<HTMLElement>('[aria-label="Open with"]');
      expect(found).not.toBeNull();
      return found!;
    };

    it("mounts no picker to open", async () => {
      await mount();

      expect(host.querySelector("select")).toBeNull();
    });

    it("shows the row unavailable, with the reason as a tooltip", async () => {
      await mount();

      expect(control().getAttribute("aria-disabled")).toBe("true");
      expect(control().getAttribute("title")).toBe(UNAVAILABLE);
      expect(control().classList.contains("cfg-btn--disabled")).toBe(true);
      // DL-23.6: it keeps its tab stop, or the reason is unreachable by keyboard.
      expect(control().hasAttribute("disabled")).toBe(false);
      expect(control().tabIndex).toBeGreaterThanOrEqual(0);
    });

    it("keeps the row's place: same label, description, pill text and caret", async () => {
      await mount();

      expect(row().querySelector(".cfg-row__label")?.textContent).toBe("Open with");
      expect(row().querySelector(".cfg-row__desc")?.textContent).toBe(
        "Ctrl+click a path outside your open workspaces",
      );
      expect(row().querySelector(".cfg-row__value")?.contains(control())).toBe(true);
      expect(control().classList.contains("cfg-btn")).toBe(true);
      expect(control().querySelector(".cfg-btn__text")?.textContent).not.toBe("");
      expect(control().querySelector(".cfg-btn__hint svg")).not.toBeNull();
    });

    it("writes nothing when pressed", async () => {
      await mount();

      act(() => {
        control().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(updateSettings).not.toHaveBeenCalled();
    });
  });
});
