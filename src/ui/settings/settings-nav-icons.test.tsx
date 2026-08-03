// @vitest-environment jsdom
import type { ComponentType } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AppearanceIcon,
  ColorsIcon,
  LinksEditorIcon,
  NotificationsIcon,
  TerminalIcon,
} from "./settings-nav-icons";

describe("settings-nav-icons", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const icons: Array<{ name: string; Icon: ComponentType }> = [
    { name: "AppearanceIcon", Icon: AppearanceIcon },
    { name: "ColorsIcon", Icon: ColorsIcon },
    { name: "TerminalIcon", Icon: TerminalIcon },
    { name: "LinksEditorIcon", Icon: LinksEditorIcon },
    { name: "NotificationsIcon", Icon: NotificationsIcon },
  ];

  for (const { name, Icon } of icons) {
    it(`${name} renders an svg without throwing`, () => {
      expect(() => act(() => render(<Icon />, host))).not.toThrow();

      const svg = host.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("width")).toBe("16");
      expect(svg?.getAttribute("height")).toBe("16");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    });
  }
});
