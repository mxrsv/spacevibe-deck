import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/cn";
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { DeckIcon } from "./deck-icon";
import { withRef } from "./with-ref";

/**
 * RCP-11, RCP-21: every menu is one floating surface on `--popover-bg` at `--elev-1`, the
 * `--radius-surface` corner, 4 inset, holding 32 rows 2 apart. Opaque and static: no frosted
 * backdrop (DL-1.3) and no enter or exit motion on the shadow. An item highlights on the hover wash,
 * whether the pointer or the keyboard put it there (CMP-11).
 */
const MENU_SURFACE =
  "flex flex-col gap-(--space-list) rounded-(--radius-surface) bg-(--popover-bg) p-(--space-4) text-(--text-primary) shadow-(--elev-1) duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0";

/** RCP-21: a menu row is 32, padded 8, with its 16 glyph 8 from its label. */
const MENU_ROW =
  "relative flex h-(--row-32) shrink-0 items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-sm text-(--text-primary) outline-hidden transition-colors duration-(--duration) select-none focus:bg-(--state-hover-bg) data-highlighted:bg-(--state-hover-bg) data-disabled:pointer-events-none data-disabled:opacity-(--state-disabled-opacity) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-(--text-muted) [&_svg:not([class*='size-'])]:size-(--icon-16)";

function DropdownMenu({ ...props }: Omit<MenuPrimitive.Root.Props, "ref">) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({ ...props }: Omit<MenuPrimitive.Portal.Props, "ref">) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

const DropdownMenuTrigger = withRef(function DropdownMenuTrigger({
  ...props
}: Omit<MenuPrimitive.Trigger.Props, "ref">) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
});

const DropdownMenuContent = withRef(function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "ref"> &
  Pick<
    Omit<MenuPrimitive.Positioner.Props, "ref">,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={() =>
            cn(
              `z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto outline-none ${MENU_SURFACE}`,
              className,
            )
          }
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
});

const DropdownMenuGroup = withRef(function DropdownMenuGroup({
  ...props
}: Omit<MenuPrimitive.Group.Props, "ref">) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
});

const DropdownMenuLabel = withRef(function DropdownMenuLabel({
  className,
  inset,
  ...props
}: Omit<MenuPrimitive.GroupLabel.Props, "ref"> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "flex h-(--row-24) items-center px-(--space-pad-row) text-xs text-(--text-faint) data-inset:pl-6",
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuItem = withRef(function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: Omit<MenuPrimitive.Item.Props, "ref"> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        `group/dropdown-menu-item ${MENU_ROW} data-inset:pl-6 data-[variant=destructive]:text-(--ink-fail) data-[variant=destructive]:*:[svg]:text-(--ink-fail)`,
        className,
      )}
      {...props}
    />
  );
});

function DropdownMenuSub({ ...props }: Omit<MenuPrimitive.SubmenuRoot.Props, "ref">) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

const DropdownMenuSubTrigger = withRef(function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Omit<MenuPrimitive.SubmenuTrigger.Props, "ref"> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        `${MENU_ROW} data-inset:pl-6 data-popup-open:bg-(--state-hover-bg) data-open:bg-(--state-hover-bg)`,
        className,
      )}
      {...props}
    >
      {children}
      <DeckIcon icon={ArrowRight01Icon} class="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
});

const DropdownMenuSubContent = withRef(function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuContent>, "ref">) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn(`w-auto min-w-32 ${MENU_SURFACE}`, className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
});

const DropdownMenuCheckboxItem = withRef(function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: Omit<MenuPrimitive.CheckboxItem.Props, "ref"> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(`${MENU_ROW} pr-(--control-h-32) data-inset:pl-6`, className)}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <DeckIcon icon={Tick02Icon} />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
});

const DropdownMenuRadioGroup = withRef(function DropdownMenuRadioGroup({
  ...props
}: Omit<MenuPrimitive.RadioGroup.Props, "ref">) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
});

const DropdownMenuRadioItem = withRef(function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: Omit<MenuPrimitive.RadioItem.Props, "ref"> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(`${MENU_ROW} pr-(--control-h-32) data-inset:pl-6`, className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <DeckIcon icon={Tick02Icon} />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
});

const DropdownMenuSeparator = withRef(function DropdownMenuSeparator({
  className,
  ...props
}: Omit<MenuPrimitive.Separator.Props, "ref">) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-(--seam-w) shrink-0 bg-(--menu-sep)", className)}
      {...props}
    />
  );
});

/**
 * RCP-12: groups in a menu separate by an 8 gap, not a line. The line (`DropdownMenuSeparator`)
 * stays only between a list that scrolls and the fixed actions under it.
 */
const DropdownMenuGap = withRef(function DropdownMenuGap({
  className,
  ...props
}: Omit<MenuPrimitive.Separator.Props, "ref">) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-gap"
      className={cn("h-2 shrink-0", className)}
      {...props}
    />
  );
});

const DropdownMenuShortcut = withRef(function DropdownMenuShortcut({
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "ref">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("ml-auto text-xs text-(--text-muted)", className)}
      {...props}
    />
  );
});

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuGap,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
