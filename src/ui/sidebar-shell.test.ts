// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { SIDEBAR_COLLAPSED_ATTR, applySidebarShell } from "./sidebar-shell";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
});

describe("applySidebarShell", () => {
  it("writes the painted width and the collapsed flag", () => {
    applySidebarShell(root, { width: 275, collapsed: false, sidebar: true });
    expect(root.style.getPropertyValue("--sidebar-w")).toBe("275px");
    expect(root.getAttribute(SIDEBAR_COLLAPSED_ATTR)).toBe("false");

    applySidebarShell(root, { width: 124, collapsed: true, sidebar: true });
    expect(root.style.getPropertyValue("--sidebar-w")).toBe("124px");
    expect(root.getAttribute(SIDEBAR_COLLAPSED_ATTR)).toBe("true");
  });

  it("clears both in top-tab layout, so the stylesheet answers instead", () => {
    applySidebarShell(root, { width: 124, collapsed: true, sidebar: true });
    applySidebarShell(root, { width: 124, collapsed: true, sidebar: false });
    expect(root.style.getPropertyValue("--sidebar-w")).toBe("");
    expect(root.hasAttribute(SIDEBAR_COLLAPSED_ATTR)).toBe(false);
  });

  it("is idempotent — the same state applied twice leaves the same values", () => {
    applySidebarShell(root, { width: 300, collapsed: false, sidebar: true });
    const first = root.getAttribute("style");
    applySidebarShell(root, { width: 300, collapsed: false, sidebar: true });
    expect(root.getAttribute("style")).toBe(first);
  });
});
