"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

const Label = withRef(function Label({
  className,
  ...props
}: Omit<React.ComponentProps<"label">, "ref">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs/relaxed leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export { Label };
