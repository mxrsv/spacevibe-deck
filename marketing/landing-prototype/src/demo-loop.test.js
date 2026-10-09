// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "./copy.js";
import { mountDemoLoop, renderDemoLoop } from "./demo-loop.js";

let observe;
let reduceMotion;

function mount() {
  const root = document.createElement("div");
  root.innerHTML = renderDemoLoop(messages.en);
  document.body.append(root);

  const video = root.querySelector("video");
  video.play = vi.fn(() => Promise.resolve());
  video.pause = vi.fn();

  return { video, dispose: mountDemoLoop(root) };
}

beforeEach(() => {
  reduceMotion = false;
  window.matchMedia = vi.fn(() => ({
    get matches() {
      return reduceMotion;
    },
  }));
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      observe = (isIntersecting) => callback([{ isIntersecting }]);
    }

    observe() {}

    disconnect() {}
  };
});

afterEach(() => {
  document.body.replaceChildren();
  delete globalThis.IntersectionObserver;
});

describe("demo loop", () => {
  it("renders a muted, looping, lazy video with a text alternative", () => {
    const { video } = mount();

    expect(video.muted || video.hasAttribute("muted")).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("poster")).toContain("demo-loop-poster");
    expect(video.closest("[role=img]").getAttribute("aria-label")).toBe(messages.en.demoLoopAlt);
  });

  it("plays on entering the screen and pauses on leaving", () => {
    const { video } = mount();

    observe(true);
    expect(video.play).toHaveBeenCalledTimes(1);

    observe(false);
    expect(video.pause).toHaveBeenCalled();
  });

  it("never plays under reduced motion", () => {
    reduceMotion = true;
    const { video } = mount();

    observe(true);
    expect(video.play).not.toHaveBeenCalled();
  });
});
