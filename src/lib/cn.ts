import { createCn } from "cn/config";

/**
 * The font-size steps `src/ui/type-scale.css` adds to the preset. `cn` only knows Tailwind's
 * own sizes, so it reads an unknown `text-code` as a text colour and drops it beside
 * `text-foreground`, leaving the text at 16px.
 */
export const TYPE_SCALE_STEPS = ["2xs", "3xs", "code"] as const;

/** `cn` from the `cn` package, taught Deck's type scale. Import this one, not the package. */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: [...TYPE_SCALE_STEPS] }] } },
});
