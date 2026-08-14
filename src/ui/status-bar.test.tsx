// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { statusInfo } from "../terminal/tabs-store";
import {
  activateFileTab,
  openFileTab,
  resetFileSurfaces,
  updateDocument,
} from "../files/file-surface-store";
import { StatusBar } from "./status-bar";

describe("StatusBar", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
    resetFileSurfaces();
    document.body.innerHTML = "";
  });

  it("renders Windows split and New Tab hints from the active keymap", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\Deck",
    });
    statusInfo.value = {
      cwd: "C:\\work",
      home: "C:\\Users\\Deck",
      branch: null,
      agent: null,
      paneCount: 1,
    };
    const host = document.createElement("div");
    document.body.appendChild(host);

    act(() => {
      render(<StatusBar />, host);
    });

    expect(
      Array.from(
        host.querySelectorAll(".status__kbd"),
        (node) => node.textContent,
      ),
    ).toEqual(["Ctrl+Shift+D", "Ctrl+Shift+T"]);
  });

  /** Renders `<StatusBar />` into a fresh host and returns it. */
  function renderStatusBar(): HTMLDivElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      render(<StatusBar />, host);
    });
    return host;
  }

  it("shows the file branch — relative path, dirty dot, position, encoding, EOL (spec §7)", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      // Absent, not zero-with-a-label — spec §7's rule for a file surface.
      paneCount: null,
      cwd: "/repo/should-not-show",
      home: "/Users/dev",
      branch: "main",
      agent: null,
    };
    openFileTab("/repo", "/repo/src/app.ts", { keep: true });
    activateFileTab("/repo", "/repo/src/app.ts");
    updateDocument("/repo/src/app.ts", {
      dirty: true,
      file: {
        content: "",
        eol: "crlf",
        encoding: "utf-8",
        bytes: 0,
        mixedEol: false,
        readOnly: false,
        reason: null,
      },
      line: 3,
      column: 7,
    });

    const host = renderStatusBar();

    // The path stays, the pane-scoped cwd never shows for a file surface.
    expect(host.textContent).toContain("src/app.ts");
    expect(host.textContent).not.toContain("should-not-show");
    // Branch stays even with a file surface active (spec §7).
    expect(host.textContent).toContain("main");
    expect(host.textContent).toContain("3:7");
    expect(host.textContent).toContain("CRLF");
    expect(host.querySelector(".status__dirty-dot")).not.toBeNull();
    // Absent, never "0 panes" or "null panes".
    expect(host.textContent).not.toMatch(/panes?/);
  });

  it("does not render a dirty dot for a clean file", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      paneCount: null,
      cwd: null,
      home: "/Users/dev",
      branch: null,
      agent: null,
    };
    openFileTab("/repo", "/repo/src/app.ts", { keep: true });
    activateFileTab("/repo", "/repo/src/app.ts");
    updateDocument("/repo/src/app.ts", {
      dirty: false,
      file: {
        content: "",
        eol: "lf",
        encoding: "utf-8",
        bytes: 0,
        mixedEol: false,
        readOnly: false,
        reason: null,
      },
    });

    const host = renderStatusBar();

    expect(host.querySelector(".status__dirty-dot")).toBeNull();
  });

  it("keeps the ordinary pane-count segment when no file surface is active", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      paneCount: 2,
      cwd: "/repo",
      home: "/Users/dev",
      branch: null,
      agent: null,
    };

    const host = renderStatusBar();

    expect(host.textContent).toContain("2 panes");
  });
});
