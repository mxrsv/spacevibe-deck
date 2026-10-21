// Deck's own oxlint rules, loaded through `jsPlugins` in `.oxlintrc.json`. Each rule
// turns a repeated review finding into a lint error; the AGENTS.md rule it backs says
// why. Rules are plain objects, so the plugin needs no dependency beyond oxlint.
import noOutsetStateIndicators from "./no-outset-state-indicators.mjs";
import noUnreasonedSkip from "./no-unreasoned-skip.mjs";
import requireSuppressionReason from "./require-suppression-reason.mjs";

export default {
  meta: { name: "deck" },
  rules: {
    "no-outset-state-indicators": noOutsetStateIndicators,
    "no-unreasoned-skip": noUnreasonedSkip,
    "require-suppression-reason": requireSuppressionReason,
  },
};
