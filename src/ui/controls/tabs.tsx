"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

const Tabs = withRef(function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: Omit<TabsPrimitive.Root.Props, "ref">) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
});

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-(--radius-control) p-0.5 text-(--text-muted) group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const TabsList = withRef(function TabsList({
  className,
  variant = "default",
  ...props
}: Omit<TabsPrimitive.List.Props, "ref"> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
});

const TabsTrigger = withRef(function TabsTrigger({
  className,
  ...props
}: Omit<TabsPrimitive.Tab.Props, "ref">) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-normal whitespace-nowrap text-(--text-muted) transition-colors duration-150 outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-1 hover:bg-(--state-hover-bg) focus-visible:bg-(--state-hover-bg) disabled:pointer-events-none disabled:opacity-(--state-disabled-opacity) has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-active:bg-(--tab-active-bg) data-active:text-(--text-primary)",
        // Focus on the selected tab goes one step past its fill, or it would show nothing.
        "data-active:focus-visible:bg-(--tab-active-focus-bg)",
        className,
      )}
      {...props}
    />
  );
});

const TabsContent = withRef(function TabsContent({
  className,
  ...props
}: Omit<TabsPrimitive.Panel.Props, "ref">) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
});

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
