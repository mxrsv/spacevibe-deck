import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

function Popover({ ...props }: Omit<PopoverPrimitive.Root.Props, "ref">) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

const PopoverTrigger = withRef(function PopoverTrigger({
  ...props
}: Omit<PopoverPrimitive.Trigger.Props, "ref">) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
});

const PopoverContent = withRef(function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "ref"> &
  Pick<
    Omit<PopoverPrimitive.Positioner.Props, "ref">,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-(--space-in-lg) rounded-(--radius-surface) bg-(--popover-bg) p-(--space-12) text-sm text-(--text-primary) shadow-(--elev-1) outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
});

const PopoverHeader = withRef(function PopoverHeader({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "ref">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  );
});

const PopoverTitle = withRef(function PopoverTitle({
  className,
  ...props
}: Omit<PopoverPrimitive.Title.Props, "ref">) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-semibold", className)}
      {...props}
    />
  );
});

const PopoverDescription = withRef(function PopoverDescription({
  className,
  ...props
}: Omit<PopoverPrimitive.Description.Props, "ref">) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
});

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger };
