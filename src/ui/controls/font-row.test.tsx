// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { FontRow } from "./font-row";

const CUSTOM_OPTION = "__custom__";
const ignoreChange = (): void => {};

/** Today's macOS picker list, spelled out so it cannot drift with the source. */
const MACOS_CANDIDATES = [
  "SF Mono",
  "Menlo",
  "Monaco",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "IBM Plex Mono",
  "Hack",
];

const MONOSPACE_WIDTH = 100;
const SERIF_WIDTH = 120;
const INSTALLED_WIDTH = 90;

/** A canvas whose text width differs from both baselines only for `installed`. */
function stubCanvas(installed: readonly string[] | null): void {
  const context =
    installed === null
      ? null
      : {
          font: "",
          measureText(): { width: number } {
            const family = /"([^"]+)"/.exec(this.font)?.[1];
            if (family !== undefined && installed.includes(family)) {
              return { width: INSTALLED_WIDTH };
            }
            return { width: this.font.endsWith("serif") ? SERIF_WIDTH : MONOSPACE_WIDTH };
          },
        };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D | null,
  );
}

describe("FontRow candidates", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    resetDesktopEnvironmentForTests();
    vi.restoreAllMocks();
  });

  const optionValues = (): string[] =>
    Array.from(host.querySelectorAll("option"))
      .map((option) => option.value)
      .filter((value) => value !== CUSTOM_OPTION);

  const mount = (value = "SF Mono"): void => {
    act(() => {
      render(<FontRow value={value} onChange={ignoreChange} />, host);
    });
  };

  it("lists exactly today's candidates on macOS", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    stubCanvas(null);
    mount();
    expect(optionValues()).toEqual(MACOS_CANDIDATES);
  });

  it("offers the two Windows faces on Windows", () => {
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    stubCanvas(null);
    mount();
    expect(optionValues()).toEqual(["Cascadia Mono", "Consolas", ...MACOS_CANDIDATES]);
  });

  it("does not list Consolas on a Mac that has it installed", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    stubCanvas(["Menlo", "Consolas"]);
    mount("Menlo");
    expect(optionValues()).toEqual(["Menlo"]);
  });

  it("lists an installed Windows face and drops one that is missing", () => {
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    stubCanvas(["Consolas"]);
    mount("Consolas");
    expect(optionValues()).toEqual(["Consolas"]);
  });

  it("keeps the shared list where the platform is unsupported", () => {
    stubCanvas(null);
    mount();
    expect(optionValues()).toEqual(MACOS_CANDIDATES);
  });
});
