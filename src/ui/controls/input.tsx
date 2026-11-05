import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@/lib/cn";
import { withRef } from "./with-ref";

/** An input that sits inside a frame owning the border and the focus ring paints neither. */
const FRAMED =
  "border-transparent bg-transparent hover:border-transparent focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

const Input = withRef(function Input({
  className,
  type,
  framed = false,
  ...props
}: Omit<InputPrimitive.Props, "ref" | "className"> & { className?: string; framed?: boolean }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-control-frame bg-background px-2.5 py-1 text-sm transition-colors duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground hover:border-control-frame-hover focus-visible:border-muted-foreground focus-visible:ring-[3px] focus-visible:ring-foreground/14 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30 dark:disabled:bg-input/80 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50",
        framed && FRAMED,
        className,
      )}
      {...props}
    />
  );
});

export { Input };
