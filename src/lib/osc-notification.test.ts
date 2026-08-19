import { describe, expect, it } from "vitest";
import { classifyOscNotification } from "./osc-notification";

describe("classifyOscNotification", () => {
  it("classifies an OSC 9 general notification as requested", () => {
    expect(classifyOscNotification(9, "Build finished")).toEqual({
      kind: "requested",
      source: "osc-notification",
    });
  });

  it("classifies an OSC 777 notify form as requested", () => {
    expect(classifyOscNotification(777, "notify;Title;Body")).toEqual({
      kind: "requested",
      source: "osc-notification",
    });
  });

  it("rejects OSC 9;4 progress reports routed through the raw-output path", () => {
    expect(classifyOscNotification(9, "4;1")).toBeNull();
    expect(classifyOscNotification(9, "4")).toBeNull();
    expect(classifyOscNotification(9, "4;2;50")).toBeNull();
  });

  it("rejects empty/whitespace-only OSC 9 payload", () => {
    expect(classifyOscNotification(9, "")).toBeNull();
    expect(classifyOscNotification(9, "   ")).toBeNull();
  });

  it("rejects empty OSC 777 payload", () => {
    expect(classifyOscNotification(777, "")).toBeNull();
  });

  it("rejects a bare 'notify' with no title", () => {
    expect(classifyOscNotification(777, "notify")).toBeNull();
    expect(classifyOscNotification(777, "notify;")).toBeNull();
  });

  it("rejects a non-notify OSC 777 form", () => {
    expect(classifyOscNotification(777, "beep;x")).toBeNull();
  });

  it("rejects an unrecognized OSC id", () => {
    expect(classifyOscNotification(0, "my title")).toBeNull();
    expect(classifyOscNotification(8, "http://example.com;label")).toBeNull();
  });

  it("never carries the payload's title/body text in the result", () => {
    const result = classifyOscNotification(777, "notify;Secret Title;Secret Body");
    expect(result).not.toBeNull();
    expect(Object.keys(result as object).sort()).toEqual(["kind", "source"]);
    expect(JSON.stringify(result)).not.toContain("Secret");
  });
});
