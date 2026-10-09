import { describe, expect, it } from "vitest";
import { FEEDBACK_URL, feedbackUrl } from "./feedback-url";

describe("feedbackUrl", () => {
  it("names the version and platform", () => {
    expect(feedbackUrl("2.7.0", "macos")).toBe(`${FEEDBACK_URL}?v=2.7.0&os=macos`);
    expect(feedbackUrl("2.7.0", "windows")).toBe(`${FEEDBACK_URL}?v=2.7.0&os=windows`);
  });

  it("leaves out what it does not know", () => {
    expect(feedbackUrl("", "macos")).toBe(`${FEEDBACK_URL}?os=macos`);
    expect(feedbackUrl("2.7.0", "unsupported")).toBe(`${FEEDBACK_URL}?v=2.7.0`);
    expect(feedbackUrl("", "unsupported")).toBe(FEEDBACK_URL);
  });
});
