import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@/lib/cn";
import { withRef } from "../controls/with-ref";

/** CMP-5: a pressable small control, 24 or 20 high. Hover and focus share a step, press goes one more. */
const SIZES = {
  24: "h-6 rounded-md px-2",
  20: "h-5 rounded-sm px-1.5",
} as const;

const Chip = withRef(function Chip({
  className,
  size = 24,
  quiet = false,
  ...props
}: Omit<ButtonPrimitive.Props, "ref"> & {
  size?: keyof typeof SIZES;
  /** No fill until hover. */
  quiet?: boolean;
}) {
  return (
    <ButtonPrimitive
      data-slot="chip"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap text-foreground transition-colors duration-150 outline-none select-none hover:bg-[color-mix(in_oklch,var(--muted)_90%,var(--foreground))] focus-visible:bg-[color-mix(in_oklch,var(--muted)_90%,var(--foreground))] active:bg-[color-mix(in_oklch,var(--muted)_84%,var(--foreground))] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
        SIZES[size],
        quiet ? "bg-transparent" : "bg-muted",
        className,
      )}
      {...props}
    />
  );
});

export { Chip };
