import { describe, expect, it } from "vitest";
import {
  isReleaseSwitchEnabled,
  releaseSwitchCleanupDue,
  requireReleaseSwitch,
  resolveReleaseSwitches,
} from "./release-switches";

const definitions = Object.freeze({
  preview: Object.freeze({ enabled: false as boolean, createdOn: "2026-10-03" }),
  shipped: Object.freeze({
    enabled: true as boolean,
    createdOn: "2026-09-01",
    enabledOn: "2026-09-15",
  }),
});

describe("temporary release switches", () => {
  it("uses file values in a release and enables all defined switches in development", () => {
    expect(resolveReleaseSwitches(false, definitions)).toEqual({ preview: false, shipped: true });
    expect(resolveReleaseSwitches(true, definitions)).toEqual({ preview: true, shipped: true });
    expect(definitions.preview.enabled).toBe(false);
    expect(Object.isFrozen(resolveReleaseSwitches(false, definitions))).toBe(true);
  });
  it("fails closed on an unknown or inherited switch", () => {
    const snapshot = resolveReleaseSwitches(true, definitions);
    expect(isReleaseSwitchEnabled("missing", snapshot)).toBe(false);
    expect(isReleaseSwitchEnabled("toString", snapshot)).toBe(false);
    expect(() => requireReleaseSwitch("missing", snapshot)).toThrow("not available");
    expect(() =>
      requireReleaseSwitch("preview", resolveReleaseSwitches(false, definitions)),
    ).toThrow("not available");
  });
  it.each(["2026-02-30", "2026-13-01", "yesterday", "2026-1-1"])(
    "rejects invalid creation date %s",
    (createdOn) => {
      expect(() =>
        resolveReleaseSwitches(false, { feature: { enabled: false, createdOn } }),
      ).toThrow("Invalid release switch definition: feature");
    },
  );
  it("rejects invalid boolean values and activation dates", () => {
    expect(() =>
      resolveReleaseSwitches(false, {
        feature: { enabled: "false", createdOn: "2026-10-03" },
      } as never),
    ).toThrow("Invalid release switch definition: feature");
    expect(() =>
      resolveReleaseSwitches(false, {
        feature: { enabled: true, createdOn: "2026-10-03", enabledOn: "2026-10-01" },
      }),
    ).toThrow("Invalid release switch definition: feature");
  });
  it("starts cleanup after fourteen published days and clears the clock on rollback", () => {
    const enabled = { enabled: true, createdOn: "2026-10-03", enabledOn: "2026-10-04" };
    expect(releaseSwitchCleanupDue(enabled, "2026-10-17")).toBe(false);
    expect(releaseSwitchCleanupDue(enabled, "2026-10-18")).toBe(true);
    expect(
      releaseSwitchCleanupDue({ enabled: false, createdOn: enabled.createdOn }, "2026-11-01"),
    ).toBe(false);
    expect(releaseSwitchCleanupDue({ ...enabled, enabledOn: "2026-10-20" }, "2026-11-01")).toBe(
      false,
    );
    expect(
      releaseSwitchCleanupDue({ enabled: true, createdOn: enabled.createdOn }, "2026-11-01"),
    ).toBe(false);
  });
});

describe("the shipped switch table", () => {
  it("keeps mobileCompanion dark in a release and lit in development", () => {
    expect(isReleaseSwitchEnabled("mobileCompanion", resolveReleaseSwitches(false))).toBe(false);
    expect(isReleaseSwitchEnabled("mobileCompanion", resolveReleaseSwitches(true))).toBe(true);
  });

  it("keeps agentControl dark in a release and lit in development", () => {
    expect(isReleaseSwitchEnabled("agentControl", resolveReleaseSwitches(false))).toBe(false);
    expect(isReleaseSwitchEnabled("agentControl", resolveReleaseSwitches(true))).toBe(true);
  });
  it("keeps stageLauncher dark in a release and lit in development", () => {
    expect(isReleaseSwitchEnabled("stageLauncher", resolveReleaseSwitches(false))).toBe(false);
    expect(isReleaseSwitchEnabled("stageLauncher", resolveReleaseSwitches(true))).toBe(true);
  });
});
