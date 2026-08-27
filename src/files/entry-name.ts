/**
 * Whether a name may be created inside a workspace (design §6.3).
 *
 * Imported by BOTH the renderer's naming modal and `electron/fs/create-entry.ts`.
 * The renderer's use is a CONVENIENCE — it disables the confirm and prints the
 * reason under the field — and main validates the same name again, because the
 * renderer is not the trust boundary.
 *
 * Deliberately NOT `createDirectory`'s `validName` (design §6.2): that one is
 * the task launcher's, and it refuses every name starting with `.`, so
 * `.github` could not be created. It stays as it is; the launcher's needs are
 * not the explorer's.
 *
 * Windows rules are enforced on BOTH platforms. A repository is shared, and a
 * name macOS accepts but Windows cannot check out is a defect the creating
 * machine should refuse.
 *
 * Dependency-free on purpose: no Preact, no signals, no `node:*`. The main
 * process compiles this file into its own bundle.
 */

/** The filesystem limit on one path component, on every platform Deck ships to. */
const MAX_NAME_BYTES = 255;

/** DOS device names, which Windows resolves before it looks at the directory —
 * with or without an extension, and case-insensitively. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** C0 controls plus DEL. NUL is in here; it is not a special case. */
// oxlint-disable-next-line no-control-regex -- the point of this rule is control characters
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export type NameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: NameCheck = { ok: true };
const no = (reason: string): NameCheck => ({ ok: false, reason });

/**
 * The reasons are printed to the user under the modal's field and thrown as
 * the IPC error's message, so they are sentences, not codes. The check order is
 * fixed so a name failing two rules always reports the same one.
 */
export function checkEntryName(name: unknown): NameCheck {
  if (typeof name !== "string" || name === "") {
    return no("Type a name.");
  }
  if (name !== name.trim()) {
    return no("A name can't start or end with a space.");
  }
  if (CONTROL_CHARACTER.test(name)) {
    return no("A name can't contain control characters.");
  }
  if (name.includes("/") || name.includes("\\")) {
    return no("A name can't contain a path separator.");
  }
  if (name === "." || name === "..") {
    return no("That name is reserved.");
  }
  // Windows strips a trailing dot, so `a.` and `a` are the same entry there —
  // a name that means two different things on two platforms is one the
  // creating machine refuses. A trailing space is already gone with the trim
  // check above.
  if (name.endsWith(".")) {
    return no("A name can't end with a dot.");
  }
  if (RESERVED_DEVICE.test(name)) {
    return no("That name is reserved on Windows.");
  }
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    return no("That name is too long.");
  }
  return OK;
}
