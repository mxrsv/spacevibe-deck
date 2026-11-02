/** Reads Tailwind class strings for the control tests: where a ring would hide. */

/** Splits one class on its top-level colons: a colon inside `[...]` belongs to an arbitrary value. */
export function splitClass(entry: string): { variants: string; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < entry.length; index += 1) {
    const char = entry[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === ":" && depth === 0) {
      parts.push(entry.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(entry.slice(start));
  return { variants: parts.slice(0, -1).join(":"), utility: parts[parts.length - 1] };
}

const RING_UTILITY = /^!?(?:ring(?!-0$)(?:-|$)|border-ring|outline(?!-(?:none|hidden)$)(?:-|$))/;

/**
 * CMP-11, CMP-13: only an input has a ring; any other control paints focus as it paints hover.
 * Judges each class on its own: a ring, a ring-coloured border or an outline under any variant
 * that names focus or an invalid state (`focus-visible:`, `dark:aria-invalid:`, `data-[focus]:`,
 * `group-has-[:focus-visible]/label:`), however many other variants sit before it.
 */
export function ringClasses(classes: string): string[] {
  return classes.split(/\s+/).filter((entry) => {
    const { variants, utility } = splitClass(entry);
    return /focus|aria-invalid/.test(variants) && RING_UTILITY.test(utility);
  });
}
