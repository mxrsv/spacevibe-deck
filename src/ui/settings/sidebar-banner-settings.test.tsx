// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../host/dialog-host", () => ({ open: vi.fn() }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn() }));
vi.mock("../../chrome/events", () => ({ reportPersistError: vi.fn() }));

import { open } from "../../host/dialog-host";
import { invoke } from "../../host/bridge";
import {
  DEFAULT_SIDEBAR_BANNER,
  sidebarBanner,
} from "../../settings/sidebar-banner-store";
import { SidebarBannerSettings } from "./sidebar-banner-settings";

describe("SidebarBannerSettings", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    sidebarBanner.value = DEFAULT_SIDEBAR_BANNER;
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(invoke).mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
    sidebarBanner.value = DEFAULT_SIDEBAR_BANNER;
    vi.clearAllMocks();
  });

  it("keeps off, every flag, and image import in one config row", () => {
    act(() => render(<SidebarBannerSettings />, host));

    const labels = [...host.querySelectorAll(".cfg-row__label")].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(["Sidebar banner"]);
    const options = [...host.querySelectorAll("select option")].map(
      (option) => option.textContent,
    );
    expect(options).toEqual([
      "Off",
      "Vietnam",
      "United States",
      "South Korea",
      "Japan",
      "France",
      "Germany",
      "Ukraine",
      "Indonesia",
      "Choose image…",
    ]);
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it("selects and enables a built-in flag from the native menu", () => {
    act(() => render(<SidebarBannerSettings />, host));
    const select = host.querySelector<HTMLSelectElement>("select");

    act(() => {
      if (select !== null) {
        select.value = "germany";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(sidebarBanner.value.selection).toBe("germany");
    expect(sidebarBanner.value.enabled).toBe(true);
  });

  it("turns the banner off without discarding its selected image", () => {
    sidebarBanner.value = {
      enabled: true,
      selection: "japan",
      customImage: "",
    };
    act(() => render(<SidebarBannerSettings />, host));
    const select = host.querySelector<HTMLSelectElement>("select");

    act(() => {
      if (select !== null) {
        select.value = "off";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(sidebarBanner.value).toEqual({
      enabled: false,
      selection: "japan",
      customImage: "",
    });
  });

  it("imports, selects and enables one custom image", async () => {
    vi.mocked(open).mockResolvedValue("/tmp/banner.png");
    vi.mocked(invoke).mockResolvedValue("data:image/png;base64,AAAA");
    act(() => render(<SidebarBannerSettings />, host));

    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>("select");
      if (select !== null) {
        select.value = "choose-image";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(open).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("read_image_as_data_url", {
      path: "/tmp/banner.png",
    });
    expect(sidebarBanner.value).toEqual({
      enabled: true,
      selection: "custom",
      customImage: "data:image/png;base64,AAAA",
    });
  });
});
