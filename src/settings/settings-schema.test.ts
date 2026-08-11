import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "./settings-schema";

describe("validateSettings", () => {
  it("silently drops the legacy restoreTabs field", () => {
    const validated = validateSettings({ restoreTabs: false });
    expect("restoreTabs" in validated).toBe(false);
  });

  it("silently drops the legacy sidebarPosition field", () => {
    const validated = validateSettings({ sidebarPosition: "top" });
    expect("sidebarPosition" in validated).toBe(false);
  });
});

describe("tabBarPosition", () => {
  it("defaults to left, including for settings files that predate it", () => {
    expect(DEFAULT_SETTINGS.tabBarPosition).toBe("left");
    expect(validateSettings({}).tabBarPosition).toBe("left");
  });

  it("keeps an explicit top", () => {
    expect(validateSettings({ tabBarPosition: "top" }).tabBarPosition).toBe(
      "top",
    );
  });

  it("falls back to left on an unknown value", () => {
    expect(
      validateSettings({ tabBarPosition: "diagonal" }).tabBarPosition,
    ).toBe("left");
    expect(validateSettings({ tabBarPosition: 7 }).tabBarPosition).toBe("left");
  });
});

describe("showPaneBar", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.showPaneBar).toBe(false);
    expect(validateSettings({}).showPaneBar).toBe(false);
  });

  it("accepts a boolean and rejects other types", () => {
    expect(validateSettings({ showPaneBar: true }).showPaneBar).toBe(true);
    expect(validateSettings({ showPaneBar: "yes" }).showPaneBar).toBe(false);
  });
});

describe("focusExpand", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.focusExpand).toBe(false);
  });

  it("accepts a valid boolean", () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: true }).focusExpand,
    ).toBe(true);
  });

  it("falls back to false when missing or not a boolean", () => {
    expect(validateSettings({}).focusExpand).toBe(false);
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: "yes" }).focusExpand,
    ).toBe(false);
  });
});

describe("agentNotifications", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.agentNotifications).toBe(false);
    expect(validateSettings({}).agentNotifications).toBe(false);
  });

  it("accepts true", () => {
    expect(
      validateSettings({ agentNotifications: true }).agentNotifications,
    ).toBe(true);
  });

  it("accepts false", () => {
    expect(
      validateSettings({ agentNotifications: false }).agentNotifications,
    ).toBe(false);
  });

  it("falls back to false on invalid types (string, number)", () => {
    expect(
      validateSettings({ agentNotifications: "yes" }).agentNotifications,
    ).toBe(false);
    expect(validateSettings({ agentNotifications: 1 }).agentNotifications).toBe(
      false,
    );
  });
});

describe("scrollback", () => {
  it("defaults to 10000 when missing", () => {
    expect(DEFAULT_SETTINGS.scrollback).toBe(10_000);
    expect(validateSettings({}).scrollback).toBe(10_000);
  });

  it("falls back to 10000 on a non-number", () => {
    expect(validateSettings({ scrollback: "abc" }).scrollback).toBe(10_000);
  });

  it("clamps below the minimum to 1000", () => {
    expect(validateSettings({ scrollback: 250 }).scrollback).toBe(1000);
  });

  it("clamps above the maximum to 100000", () => {
    expect(validateSettings({ scrollback: 999_999 }).scrollback).toBe(100_000);
  });

  it("keeps an in-range value", () => {
    expect(validateSettings({ scrollback: 5000 }).scrollback).toBe(5000);
  });
});

describe("customAgents", () => {
  const valid = {
    id: "custom:aider",
    label: "Aider",
    command: "aider --model sonnet",
  };

  it("defaults to none declared", () => {
    expect(DEFAULT_SETTINGS.customAgents).toEqual([]);
    expect(validateSettings({}).customAgents).toEqual([]);
  });

  it("falls back to none when the stored value is not an array", () => {
    expect(validateSettings({ customAgents: "aider" }).customAgents).toEqual(
      [],
    );
  });

  it("keeps a well-formed entry verbatim", () => {
    expect(validateSettings({ customAgents: [valid] }).customAgents).toEqual([
      valid,
    ]);
  });

  it("drops an entry whose binary a shell would act on", () => {
    // The stored file is user-writable, so this is a real input path — not
    // only what the settings form produced.
    const evil = { ...valid, id: "custom:evil", command: "x; rm -rf ~" };
    expect(
      validateSettings({ customAgents: [valid, evil] }).customAgents,
    ).toEqual([valid]);
  });

  it("drops entries with a missing id prefix, blank label or blank command", () => {
    const broken = [
      { ...valid, id: "aider" },
      { ...valid, id: "custom:" },
      { ...valid, id: "custom:blank", label: "   " },
      { ...valid, id: "custom:long", label: "l".repeat(33) },
      { ...valid, id: "custom:nocmd", command: "  " },
      { id: "custom:partial", label: "Partial" },
      null,
      "aider",
    ];
    expect(validateSettings({ customAgents: broken }).customAgents).toEqual([]);
  });

  it("keeps the first of two entries sharing an id", () => {
    const clash = { ...valid, label: "Aider clone" };
    expect(
      validateSettings({ customAgents: [valid, clash] }).customAgents,
    ).toEqual([valid]);
  });
});

describe("promptTemplates validation", () => {
  const good = {
    id: "tpl:fix-bug",
    label: "fix bug",
    body: "Fix the failing test.",
    autoSend: false,
  };

  it("defaults to none", () => {
    expect(validateSettings({}).promptTemplates).toEqual([]);
  });

  it("keeps well-formed entries", () => {
    expect(
      validateSettings({ promptTemplates: [good] }).promptTemplates,
    ).toEqual([good]);
  });

  it("drops a malformed entry rather than repairing it", () => {
    const raw = {
      promptTemplates: [good, { id: "tpl:x" }, { label: "no id" }],
    };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });

  it("falls back to none for a malformed array", () => {
    expect(
      validateSettings({ promptTemplates: "nope" }).promptTemplates,
    ).toEqual([]);
  });

  it("dedupes repeated ids, first wins", () => {
    const second = { ...good, label: "other" };
    expect(
      validateSettings({ promptTemplates: [good, second] }).promptTemplates,
    ).toEqual([good]);
  });

  it("keeps only the four known fields", () => {
    const raw = { promptTemplates: [{ ...good, extra: "dropped" }] };
    expect(validateSettings(raw).promptTemplates).toEqual([good]);
  });
});

describe("sidebarDecoration", () => {
  it("defaults to off, including for settings files that predate it", () => {
    expect(DEFAULT_SETTINGS.sidebarDecoration).toBe("off");
    expect(validateSettings({}).sidebarDecoration).toBe("off");
  });

  it("keeps an id from the set", () => {
    expect(
      validateSettings({ sidebarDecoration: "orbit" }).sidebarDecoration,
    ).toBe("orbit");
  });

  it("falls back to off for an id that no longer exists", () => {
    expect(
      validateSettings({ sidebarDecoration: "nebula" }).sidebarDecoration,
    ).toBe("off");
    expect(validateSettings({ sidebarDecoration: 7 }).sidebarDecoration).toBe(
      "off",
    );
  });
});
