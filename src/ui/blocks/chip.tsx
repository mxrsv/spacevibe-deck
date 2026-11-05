import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@/lib/cn";
import { withRef } from "../controls/with-ref";
import { STATE_DISABLED, STATE_IDLE, STATE_MOTION } from "./recipe-classes";

/**
 * CMP-5, RCP-4: a pressable small control, 24 or 20 high, 12px text at 400 in the muted ink. A
 * quiet chip has no fill until hover; hover and focus share a step, and press lays the pressed
 * layer over it (RCP-9).
 */
const SIZES = {
  24: "h-(--chip-h-24) gap-(--space-icon-label) rounded-(--radius-control) px-(--chip-pad-24)",
  20: "h-(--chip-h-20) gap-(--space-4) rounded-(--radius-tight) px-(--chip-pad-20)",
} as const;

/** A status chip's ink and tint: needs you reads `--ink-need` on its tint, fail reads `--ink-fail`. */
const TONES = {
  need: "text-(--ink-need) hover:text-(--ink-need) focus-visible:text-(--ink-need) bg-[linear-gradient(var(--state-needs-you-bg),var(--state-needs-you-bg))]",
  fail: "text-(--ink-fail) hover:text-(--ink-fail) focus-visible:text-(--ink-fail)",
} as const;

const Chip = withRef(function Chip({
  className,
  size = 24,
  quiet = false,
  tone,
  ...props
}: Omit<ButtonPrimitive.Props, "ref"> & {
  size?: keyof typeof SIZES;
  /** No fill until hover. */
  quiet?: boolean;
  /** A status chip: the attention chip is `need`. */
  tone?: keyof typeof TONES;
}) {
  return (
    <ButtonPrimitive
      data-slot="chip"
      className={cn(
        "inline-flex shrink-0 items-center text-xs leading-(--leading-meta) font-normal whitespace-nowrap text-(--text-muted) select-none hover:text-(--text-primary) focus-visible:text-(--text-primary) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--icon-12)",
        STATE_MOTION,
        STATE_IDLE,
        STATE_DISABLED,
        SIZES[size],
        quiet ? "bg-transparent" : "bg-(--tab-rest-bg)",
        tone === undefined ? null : TONES[tone],
        className,
      )}
      {...props}
    />
  );
});

export { Chip };
