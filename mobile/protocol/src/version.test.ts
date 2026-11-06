import { describe, expect, it } from "vitest";
import { judgeVersion } from "./version";

describe("judgeVersion", () => {
  it("lets two peers inside each other's range talk", () => {
    expect(judgeVersion({ version: 2, min: 1 }, { version: 2, min: 2 })).toBe("ok");
    expect(judgeVersion({ version: 3, min: 2 }, { version: 2, min: 1 })).toBe("ok");
  });

  it("names the phone when it is older than the desktop still reads", () => {
    expect(judgeVersion({ version: 1, min: 1 }, { version: 3, min: 2 })).toBe("update-phone");
  });

  it("names the desktop when it is older than the phone still reads", () => {
    expect(judgeVersion({ version: 4, min: 3 }, { version: 2, min: 1 })).toBe("update-desktop");
  });
});
