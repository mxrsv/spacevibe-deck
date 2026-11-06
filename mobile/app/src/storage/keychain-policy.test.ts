import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(path.resolve(import.meta.dirname, "..", relative), "utf8");

describe("Keychain accessibility", () => {
  it("keeps pairing keys and push keys on this device, readable after the first unlock", () => {
    for (const file of ["storage/secure-kv.ts", "push/secure-push-backend.ts"]) {
      const source = read(file);
      expect(source).toContain("AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY");
      expect(source.replace("AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY", "")).not.toMatch(
        /AFTER_FIRST_UNLOCK\b(?!_THIS)/,
      );
    }
  });
});
