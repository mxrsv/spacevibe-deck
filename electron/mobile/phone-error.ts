import type { ErrorCode } from "../../mobile/protocol/src/messages";

/** A request failed for a reason the phone can act on; `code` is one of the protocol's closed set. */
export class PhoneError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PhoneError";
  }
}
