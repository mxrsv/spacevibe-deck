// Deck's own oxlint rules, loaded through `jsPlugins` in `.oxlintrc.json`. Each rule
// turns a repeated review finding into a lint error; the AGENTS.md rule it backs says
// why. Rules are plain objects, so the plugin needs no dependency beyond oxlint.
import noArbitraryFontSize from "./no-arbitrary-font-size.mjs";
import noUnreasonedSkip from "./no-unreasoned-skip.mjs";
import requireSuppressionReason from "./require-suppression-reason.mjs";

export default {
  meta: { name: "deck" },
  rules: {
    "no-arbitrary-font-size": noArbitraryFontSize,
    "no-unreasoned-skip": noUnreasonedSkip,
    "require-suppression-reason": requireSuppressionReason,
  },
};
