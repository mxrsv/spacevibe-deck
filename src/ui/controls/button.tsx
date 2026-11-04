import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

/*
 * CMP-11: a button has no focus ring or border; keyboard focus paints as hover does. CMP-13,
 * RCP-9: a state change moves colour only, in the shared motion pair. Pressed lays black at 8%
 * over the variant's own wash; primary steps its own fill instead (`--primary-hover`,
 * `--primary-pressed`), because `primary/80` would let the page through and cost the label its
 * contrast. Text is 14 at 600 (RCP-5).
 */
const PRESSED = "active:bg-[linear-gradient(var(--state-pressed-bg),var(--state-pressed-bg))]";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors duration-(--duration) ease-(--ease) outline-none select-none disabled:pointer-events-none disabled:opacity-(--state-disabled-opacity) aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // RCP-3: primary is filled and steps its own fill; it is the one filled button (CMP-3).
        default:
          "bg-primary text-primary-foreground hover:bg-(--primary-hover) focus-visible:bg-(--primary-hover) active:bg-(--primary-pressed)",
        // Secondary is framed in the soft control frame, no fill at rest (CMP-8).
        outline: `border-control-frame bg-transparent text-(--text-primary) hover:border-control-frame-hover hover:bg-(--state-hover-bg) focus-visible:border-control-frame-hover focus-visible:bg-(--state-hover-bg) aria-expanded:bg-(--state-hover-bg) ${PRESSED}`,
        secondary: `bg-(--tab-rest-bg) text-(--text-primary) hover:bg-(--state-hover-bg) focus-visible:bg-(--state-hover-bg) aria-expanded:bg-(--state-hover-bg) ${PRESSED}`,
        // Ghost is bare until hover; keyboard focus paints as hover (CMP-11).
        ghost: `text-(--text-muted) hover:bg-(--state-hover-bg) hover:text-(--text-primary) focus-visible:bg-(--state-hover-bg) focus-visible:text-(--text-primary) aria-expanded:bg-(--state-hover-bg) aria-expanded:text-(--text-primary) ${PRESSED}`,
        // Danger sits on its tint with fail ink.
        destructive: `bg-(--danger-bg) text-(--ink-fail) hover:bg-(--danger-bg-hover) focus-visible:bg-(--danger-bg-hover) ${PRESSED}`,
      },
      // RCP-3: 28 / 32 / 36 / 40 high, padded 8 / 12 / 14 / 16, radius 4 / 4 / 6 / 6.
      size: {
        sm: "h-7 gap-1.5 rounded-md px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        default:
          "h-8 gap-1.5 rounded-md px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 rounded-button-lg px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xl: "h-10 gap-2 rounded-button-lg px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        // RCP-4: icon boxes 28 / 24 / 20 holding 16 / 14 / 12; the 20 offers a 24 hit area.
        icon: "size-7 rounded-md",
        "icon-sm": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "relative size-5 rounded-sm after:absolute after:-inset-0.5 [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Button = withRef(function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<ButtonPrimitive.Props, "ref"> & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
