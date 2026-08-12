// @vitest-environment jsdom
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeAction } from "../external-change";
import { ExternalChangeBar } from "./external-change-bar";

let host: HTMLDivElement | null = null;

function mount(
  prompt: ChangeAction["kind"] | null,
  onResolve = vi.fn(),
): { node: HTMLDivElement; onResolve: ReturnType<typeof vi.fn> } {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <ExternalChangeBar
      prompt={prompt}
      fileName="index.ts"
      onResolve={onResolve}
    />,
    host,
  );
  return { node: host, onResolve };
}

function buttons(node: HTMLElement): string[] {
  return [...node.querySelectorAll(".filebar__btn")].map(
    (element) => element.textContent ?? "",
  );
}

afterEach(() => {
  if (host !== null) {
    render(null, host);
    host.remove();
    host = null;
  }
});

describe("ExternalChangeBar", () => {
  it("offers Reload / Keep mine when a DIRTY file changed on disk", () => {
    const { node } = mount("prompt-changed");
    expect(buttons(node)).toEqual(["Reload", "Keep mine"]);
    expect(node.textContent).toContain("index.ts");
  });

  it("offers Save again / Close when a DIRTY file was deleted", () => {
    const { node } = mount("prompt-deleted");
    expect(buttons(node)).toEqual(["Save again", "Close"]);
  });

  it("stays silent for every row the table handles without asking", () => {
    // Clean+changed reloads silently and clean+deleted marks the tab gone; a
    // bar for something Deck already handled is noise the user must dismiss.
    for (const prompt of ["none", "reload", "mark-gone", null] as const) {
      const { node } = mount(prompt);
      expect(node.querySelector(".filebar")).toBeNull();
      render(null, node);
    }
  });

  it("reports exactly the answer that was clicked", () => {
    const { node, onResolve } = mount("prompt-changed");
    node.querySelectorAll<HTMLButtonElement>(".filebar__btn")[0].click();
    expect(onResolve).toHaveBeenCalledWith("reload");
    node.querySelectorAll<HTMLButtonElement>(".filebar__btn")[1].click();
    expect(onResolve).toHaveBeenLastCalledWith("keep-mine");
  });

  it("never auto-decides — it renders buttons and nothing else happens", () => {
    const { onResolve } = mount("prompt-changed");
    expect(onResolve).not.toHaveBeenCalled();
  });
});
