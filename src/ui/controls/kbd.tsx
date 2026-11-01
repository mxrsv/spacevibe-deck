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
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-xs bg-muted px-1 font-sans text-[0.625rem] font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
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
