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
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
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
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-colors duration-150 outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:bg-foreground/8 focus-visible:bg-foreground/8 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:data-active:shadow-sm data-active:bg-background data-active:text-foreground dark:data-active:bg-input/30 dark:data-active:text-foreground",
        // Focus on the selected tab goes one step past its fill, or it would show nothing.
        "group-data-[variant=default]/tabs-list:data-active:focus-visible:bg-[color-mix(in_oklch,var(--background)_92%,var(--foreground))] dark:group-data-[variant=default]/tabs-list:data-active:focus-visible:bg-input/50",
        "group-data-[variant=line]/tabs-list:data-active:bg-muted group-data-[variant=line]/tabs-list:data-active:shadow-none dark:group-data-[variant=line]/tabs-list:data-active:bg-muted group-data-[variant=line]/tabs-list:data-active:focus-visible:bg-[color-mix(in_oklch,var(--muted)_90%,var(--foreground))]",
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
