import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

const Switch = withRef(function Switch({
  className,
  size = "default",
  ...props
}: Omit<SwitchPrimitive.Root.Props, "ref"> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-150 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 aria-invalid:border-destructive data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 data-checked:bg-primary data-checked:hover:bg-[color-mix(in_oklch,var(--primary)_92%,black)] data-checked:focus-visible:bg-[color-mix(in_oklch,var(--primary)_92%,black)] data-unchecked:bg-input data-unchecked:hover:bg-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] data-unchecked:focus-visible:bg-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] dark:data-unchecked:bg-input/80 dark:data-unchecked:hover:bg-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] dark:data-unchecked:focus-visible:bg-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
});

export { Switch };
