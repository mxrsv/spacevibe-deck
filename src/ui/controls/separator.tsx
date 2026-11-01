"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

const Separator = withRef(function Separator({
  className,
  orientation = "horizontal",
  ...props
}: Omit<SeparatorPrimitive.Props, "ref">) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
});

export { Separator };
