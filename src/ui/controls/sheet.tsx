import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/cn";

import { Button } from "./button";
import { X } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "./deck-icon";
import { withRef } from "./with-ref";

function Sheet({ ...props }: Omit<SheetPrimitive.Root.Props, "ref">) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

const SheetTrigger = withRef(function SheetTrigger({
  ...props
}: Omit<SheetPrimitive.Trigger.Props, "ref">) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
});

const SheetClose = withRef(function SheetClose({
  ...props
}: Omit<SheetPrimitive.Close.Props, "ref">) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
});

function SheetPortal({ ...props }: Omit<SheetPrimitive.Portal.Props, "ref">) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

const SheetOverlay = withRef(function SheetOverlay({
  className,
  ...props
}: Omit<SheetPrimitive.Backdrop.Props, "ref">) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/80 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
});

// `side` is narrowed to the one edge Deck anchors a sheet to; the upstream top, bottom and
// left classes are removed, and the right ones are unchanged (UI-4).
const SheetContent = withRef(function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: Omit<SheetPrimitive.Popup.Props, "ref"> & {
  side?: "right";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-popover bg-clip-padding text-xs/relaxed text-popover-foreground shadow-lg transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=right]:sm:max-w-sm",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
          >
            <DeckIcon icon={X} size={ROW_ICON} />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
});

const SheetHeader = withRef(function SheetHeader({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "ref">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
});

const SheetFooter = withRef(function SheetFooter({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "ref">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
  );
});

const SheetTitle = withRef(function SheetTitle({
  className,
  ...props
}: Omit<SheetPrimitive.Title.Props, "ref">) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
});

const SheetDescription = withRef(function SheetDescription({
  className,
  ...props
}: Omit<SheetPrimitive.Description.Props, "ref">) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
});

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
