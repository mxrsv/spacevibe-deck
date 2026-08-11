// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { statusInfo } from "../terminal/tabs-store";
import { StatusBar } from "./status-bar";
import {
  openFileTab,
  resetFileSurfaces,
  updateDocument,
} from "../files/file-surface-store";

describe("StatusBar", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
    resetFileSurfaces();
    document.body.innerHTML = "";
  });

  function mount(): HTMLDivElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      render(<StatusBar />, host);
    });
    return host;
  }

  it("renders the pane count with a terminal tab active", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      cwd: "/repo",
      home: "/Users/dev",
      branch: "main",
      agent: null,
      paneCount: 2,
    };
    expect(mount().textContent).toContain("2 panes");
  });

  it("omits the pane count entirely with a file tab active", () => {
    // Absent, not zero-with-a-label: "0 panes" reads as a broken window
    // rather than as a different kind of surface (spec §7).
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      cwd: "/repo",
      home: "/Users/dev",
      branch: "main",
      agent: "claude",
      paneCount: null,
    };
    openFileTab("/repo", "/repo/src/index.ts", { keep: true });

    const text = mount().textContent ?? "";

    expect(text).not.toContain("pane");
    expect(text).not.toContain("0");
  });

  it("shows the file's path relative to the workspace, its position and encoding", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    statusInfo.value = {
      cwd: "/repo",
      home: "/Users/dev",
      branch: "main",
      agent: null,
      paneCount: null,
    };
    openFileTab("/repo", "/repo/src/index.ts", { keep: true });
    updateDocument("/repo/src/index.ts", {
      line: 12,
      column: 5,
      file: {
        content: "",
        eol: "crlf",
        encoding: "utf-8",
        bytes: 0,
        mixedEol: false,
        readOnly: false,
        reason: null,
      },
    });

    const text = mount().textContent ?? "";

    expect(text).toContain("src/index.ts");
    expect(text).toContain("12:5");
    expect(text).toContain("UTF-8");
    expect(text).toContain("CRLF");
    // The branch indicator stays (spec §7).
    expect(text).toContain("main");
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
      Array.from(host.querySelectorAll(".status__kbd"), (node) => node.textContent),
    ).toEqual(["Ctrl+Shift+D", "Ctrl+Shift+T"]);
  });
});
