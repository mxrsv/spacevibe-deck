"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

/*
 * CMP-11, CMP-13: a segment ladder in four steps. Hover and focus are half a `muted`, the pressed
 * (selected) segment is `muted`, a press on an idle segment lands on `muted`, and focus or press
 * on a selected one goes one step further. Focus never matches the selected fill, so a keyboard
 * user can tell "here" from "chosen".
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-semibold whitespace-nowrap transition-colors duration-150 outline-none hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground active:bg-muted disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-pressed:bg-muted aria-pressed:focus-visible:bg-[color-mix(in_oklch,var(--muted)_90%,var(--foreground))] aria-pressed:active:bg-[color-mix(in_oklch,var(--muted)_90%,var(--foreground))] data-[state=on]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-control-frame bg-transparent hover:bg-muted/50 focus-visible:bg-muted/50",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = withRef(function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<TogglePrimitive.Props, "ref"> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Toggle, toggleVariants };
