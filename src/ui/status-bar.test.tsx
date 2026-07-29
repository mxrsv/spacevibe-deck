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

describe("StatusBar", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
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
      Array.from(host.querySelectorAll(".status__kbd"), (node) => node.textContent),
    ).toEqual(["Ctrl+Shift+D", "Ctrl+Shift+T"]);
  });
});
