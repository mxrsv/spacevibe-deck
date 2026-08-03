import { describe, expect, it } from "vitest";
import { resolveUpdatePreview } from "./update-preview";

describe("resolveUpdatePreview", () => {
  it("accepts only the approved states and layouts in development", () => {
    expect(
      resolveUpdatePreview("?update-preview=downloaded&layout=sidebar", true),
    ).toMatchObject({ phase: "downloaded", sidebar: true });
    expect(
      resolveUpdatePreview("?update-preview=available&layout=top", true),
    ).toMatchObject({ phase: "available", sidebar: false });
  });

  it("rejects unknown query values", () => {
    expect(resolveUpdatePreview("?update-preview=installing", true)).toBeNull();
    expect(
      resolveUpdatePreview("?update-preview=available&layout=wide", true),
    ).toBeNull();
  });

  it("is disabled outside development", () => {
    expect(
      resolveUpdatePreview("?update-preview=available&layout=top", false),
    ).toBeNull();
  });
});
