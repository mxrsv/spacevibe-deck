import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/cn";

import { Button } from "./button";
import { X } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "./deck-icon";
import { withRef } from "./with-ref";

function Dialog({ ...props }: Omit<DialogPrimitive.Root.Props, "ref">) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

const DialogTrigger = withRef(function DialogTrigger({
  ...props
}: Omit<DialogPrimitive.Trigger.Props, "ref">) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
});

function DialogPortal({ ...props }: Omit<DialogPrimitive.Portal.Props, "ref">) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

const DialogClose = withRef(function DialogClose({
  ...props
}: Omit<DialogPrimitive.Close.Props, "ref">) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
});

const DialogOverlay = withRef(function DialogOverlay({
  className,
  ...props
}: Omit<DialogPrimitive.Backdrop.Props, "ref">) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
});

const DialogContent = withRef(function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "ref"> & {
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <DeckIcon icon={X} size={ROW_ICON} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
});

const DialogHeader = withRef(function DialogHeader({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "ref">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />
  );
});

const DialogFooter = withRef(function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
});

const DialogTitle = withRef(function DialogTitle({
  className,
  ...props
}: Omit<DialogPrimitive.Title.Props, "ref">) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  );
});

const DialogDescription = withRef(function DialogDescription({
  className,
  ...props
}: Omit<DialogPrimitive.Description.Props, "ref">) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
});

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
