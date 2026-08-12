// @vitest-environment jsdom
import type { ComponentType } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AboutIcon,
  AgentsIcon,
  AppearanceIcon,
  BrowserIcon,
  ColorsIcon,
  LinksEditorIcon,
  NotificationsIcon,
  ShortcutsIcon,
  TerminalIcon,
} from "./settings-nav-icons";
import { SETTINGS_CATEGORIES } from "./settings-categories";

describe("settings-nav-icons", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const icons: Array<{ name: string; icon: string; Icon: ComponentType }> = [
    { name: "AppearanceIcon", icon: "lucide-app-window", Icon: AppearanceIcon },
    { name: "ColorsIcon", icon: "lucide-palette", Icon: ColorsIcon },
    {
      name: "TerminalIcon",
      icon: "lucide-square-terminal",
      Icon: TerminalIcon,
    },
    { name: "AgentsIcon", icon: "lucide-bot", Icon: AgentsIcon },
    { name: "LinksEditorIcon", icon: "lucide-link", Icon: LinksEditorIcon },
    { name: "ShortcutsIcon", icon: "lucide-command", Icon: ShortcutsIcon },
    {
      name: "NotificationsIcon",
      icon: "lucide-bell",
      Icon: NotificationsIcon,
    },
    { name: "BrowserIcon", icon: "lucide-globe", Icon: BrowserIcon },
    // An arrow landing on a baseline: this category is About/Update, and the
    // icon has always been the update rather than a generic info circle.
    { name: "AboutIcon", icon: "lucide-download", Icon: AboutIcon },
  ];

  for (const { name, icon, Icon } of icons) {
    it(`${name} draws ${icon} through the shared icon contract`, () => {
      expect(() => act(() => render(<Icon />, host))).not.toThrow();

      const svg = host.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.classList.contains(icon)).toBe(true);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("width")).toBe("16");
      expect(svg?.getAttribute("height")).toBe("16");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    });
  }

  it("covers every navigable category — a new one cannot ship untested", () => {
    expect(icons).toHaveLength(SETTINGS_CATEGORIES.length);
  });

  it("gives each category its own icon", () => {
    expect(new Set(icons.map(({ icon }) => icon)).size).toBe(icons.length);
  });
});
