import type { ComponentChildren } from "preact";

/** One line under an expanded agent row: the label, and its control at the right. */
export function DetailRow({
  label,
  hint,
  children,
}: {
  readonly label: string;
  /** A reason or a sentence, kept off the row: the label's tooltip. */
  readonly hint?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="text-muted-foreground" title={hint}>
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
    </div>
  );
}
