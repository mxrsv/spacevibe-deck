import { describe, expect, it } from "vitest";
import { contrastRatio, mixHex } from "../../lib/derive-colors";
import { BUILT_IN_THEMES } from "../../settings/built-in-themes";
import { FOREGROUND_SHARE_PERCENT, USAGE_AGENT_BASE, usageAgentColor } from "./usage-agent-colors";

/** WCAG's floor for graphical objects (bars, swatches). */
const GRAPHIC_CONTRAST = 3;

describe("usageAgentColor", () => {
  it("gives each agent its own base hue and mixes it toward the theme foreground", () => {
    const colors = Object.keys(USAGE_AGENT_BASE).map((agent) =>
      usageAgentColor(agent as keyof typeof USAGE_AGENT_BASE),
    );
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) {
      expect(color).toContain("var(--fg)");
    }
  });

  describe.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))("on %s", (_, theme) => {
    it.each(Object.entries(USAGE_AGENT_BASE))("%s holds 3:1 on chrome-2", (_agent, base) => {
      // `--fg` is what `usageAgentColor` mixes toward.
      const mixed = mixHex(base, theme.ui.fg, FOREGROUND_SHARE_PERCENT / 100);
      expect(contrastRatio(mixed, theme.ui["chrome-2"])).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST);
    });
  });
});
