// @vitest-environment jsdom
import { render, type ComponentType } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AboutIcon,
  AgentsIcon,
  AppearanceIcon,
  BrowserIcon,
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
    {
      name: "AppearanceIcon",
      icon: "deck-icon--app-window",
      Icon: AppearanceIcon,
    },
    {
      name: "TerminalIcon",
      icon: "deck-icon--terminal-window",
      Icon: TerminalIcon,
    },
    { name: "AgentsIcon", icon: "deck-icon--robot", Icon: AgentsIcon },
    { name: "LinksEditorIcon", icon: "deck-icon--link", Icon: LinksEditorIcon },
    { name: "ShortcutsIcon", icon: "deck-icon--command", Icon: ShortcutsIcon },
    {
      name: "NotificationsIcon",
      icon: "deck-icon--bell",
      Icon: NotificationsIcon,
    },
    { name: "BrowserIcon", icon: "deck-icon--globe", Icon: BrowserIcon },
    // An arrow landing on a baseline: this category is About/Update, and the
    // icon has always been the update rather than a generic info circle.
    { name: "AboutIcon", icon: "deck-icon--download-simple", Icon: AboutIcon },
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
      // Phosphor is fill-based: colour reaches the icon through `fill`, and
      // weight lives in the path data rather than in a stroke attribute.
      expect(svg?.getAttribute("fill")).toBe("currentColor");
    });
  }

  it("covers every navigable category — a new one cannot ship untested", () => {
    expect(icons).toHaveLength(SETTINGS_CATEGORIES.length);
  });

  it("gives each category its own icon", () => {
    expect(new Set(icons.map(({ icon }) => icon)).size).toBe(icons.length);
  });
});
