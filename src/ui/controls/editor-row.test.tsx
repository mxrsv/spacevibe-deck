// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
  type DesktopPlatform,
} from "../../lib/platform";
import { EditorRow } from "./editor-row";

function renderDescription(platform: DesktopPlatform, homeDir: string): string {
  initializeDesktopEnvironment({ platform, homeDir });
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(
      <EditorRow
        value="vscode"
        command=""
        onChange={vi.fn()}
        onCommandChange={vi.fn()}
      />,
      host,
    );
  });
  return host.querySelector(".cfg-row__desc")?.textContent ?? "";
}

describe("EditorRow", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
    document.body.innerHTML = "";
  });

  it("names the active platform link gesture", () => {
    expect(renderDescription("macos", "/Users/dev")).toBe(
      "Cmd+click a file path",
    );
    resetDesktopEnvironmentForTests();
    expect(renderDescription("windows", "C:\\Users\\dev")).toBe(
      "Ctrl+click a file path",
    );
  });
});
