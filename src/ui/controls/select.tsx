"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@/lib/cn";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { DeckIcon } from "./deck-icon";
import { withRef } from "./with-ref";

const Select = SelectPrimitive.Root;

const SelectGroup = withRef(function SelectGroup({
  className,
  ...props
}: Omit<SelectPrimitive.Group.Props, "ref">) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  );
});

const SelectValue = withRef(function SelectValue({
  className,
  ...props
}: Omit<SelectPrimitive.Value.Props, "ref">) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  );
});

const SelectTrigger = withRef(function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<SelectPrimitive.Trigger.Props, "ref"> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-control-frame bg-transparent py-2 pr-2 pl-3 text-sm whitespace-nowrap text-(--text-primary) transition-colors duration-(--duration) outline-none not-data-disabled:hover:border-control-frame-hover not-data-disabled:hover:bg-(--state-hover-bg) focus-visible:border-control-frame-hover focus-visible:bg-(--state-hover-bg) disabled:cursor-not-allowed disabled:opacity-(--state-disabled-opacity) aria-invalid:border-destructive data-placeholder:text-(--text-faint) data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="pointer-events-none flex items-center text-muted-foreground">
        <DeckIcon icon={UnfoldMoreIcon} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

const SelectContent = withRef(function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "ref"> &
  Pick<
    Omit<SelectPrimitive.Positioner.Props, "ref">,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={() =>
            cn(
              "isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-(--radius-surface) bg-(--popover-bg) p-(--space-4) text-(--text-primary) shadow-(--elev-1) duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
              className,
            )
          }
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
});

const SelectLabel = withRef(function SelectLabel({
  className,
  ...props
}: Omit<SelectPrimitive.GroupLabel.Props, "ref">) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
});

const SelectItem = withRef(function SelectItem({
  className,
  children,
  ...props
}: Omit<SelectPrimitive.Item.Props, "ref">) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex h-(--row-32) w-full items-center gap-2 rounded-(--radius-control) pr-(--control-h-32) pl-(--space-pad-row) text-sm text-(--text-primary) outline-hidden select-none focus:bg-(--state-hover-bg) data-highlighted:bg-(--state-hover-bg) data-disabled:pointer-events-none data-disabled:opacity-(--state-disabled-opacity) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-(--icon-16) *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <DeckIcon icon={Tick02Icon} class="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});

const SelectSeparator = withRef(function SelectSeparator({
  className,
  ...props
}: Omit<SelectPrimitive.Separator.Props, "ref">) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

const SelectScrollUpButton = withRef(function SelectScrollUpButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>, "ref">) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full items-center justify-center bg-(--popover-bg) py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <DeckIcon icon={ArrowUp01Icon} />
    </SelectPrimitive.ScrollUpArrow>
  );
});

const SelectScrollDownButton = withRef(function SelectScrollDownButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>, "ref">) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full items-center justify-center bg-(--popover-bg) py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <DeckIcon icon={ArrowDown01Icon} />
    </SelectPrimitive.ScrollDownArrow>
  );
});

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
