import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

const Kbd = withRef(function Kbd({
  className,
  ...props
}: Omit<React.ComponentProps<"kbd">, "ref">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-(--badge-h) w-fit min-w-(--badge-h) items-center justify-center gap-1 rounded-(--radius-pill) bg-(--hair) px-1.5 font-sans text-xs font-normal text-(--text-muted) select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
});

const KbdGroup = withRef(function KbdGroup({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "ref">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
});

export { Kbd, KbdGroup };
