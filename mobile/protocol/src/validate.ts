/** Small shape guards shared by the parsers; every parser returns null instead of throwing. */

export type JsonObject = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isSafeNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A string within `[min, max]` UTF-16 units; the caller sanitises it separately if it is shown. */
export function isStringIn(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

export function oneOf<T extends string>(set: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (set.find((member) => member === value) ?? null) : null;
}

/** JSON text → object, or null. Never throws. */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parses every item of a bounded array, or returns null if any item or the length is bad. */
export function parseList<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/**
 * Like `parseList`, but an item that fails to parse is dropped instead of failing the list. For
 * display lists where one odd entry (a pane with a strange label) must not hide the rest; still
 * null when the value is not an array or is longer than `max`.
 */
export function parseListLenient<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
