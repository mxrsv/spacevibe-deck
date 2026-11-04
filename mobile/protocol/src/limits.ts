/**
 * The numbers both ends and the relay agree on (spec MOB1, MOB8). The relay enforces the relay
 * limits per pairing because it has no accounts to hold an abuser to (spec decision 10); the
 * desktop and the phone enforce the message limits on what they accept.
 */

/** A QR code is good for this long after the desktop shows it (MOB1). */
export const PAIRING_TTL_MS = 5 * 60_000;
/** The relay refuses a registration that claims to live longer than this. */
export const RELAY_REGISTER_MAX_AHEAD_MS = 10 * 60_000;

/** Largest binary or text WebSocket message the relay forwards or the LAN listener accepts. */
export const RELAY_MAX_FRAME_BYTES = 128 * 1024;
/** Largest plaintext app message; anything bigger travels as `chunk` events. */
export const MAX_MESSAGE_BYTES = 96 * 1024;
/** Size of one chunk's `data` before encoding; leaves room for JSON and base64 inside a message. */
export const CHUNK_BYTES = 48 * 1024;

/**
 * Messages one socket may send in a window, as a token bucket. The desktop paces each terminal
 * stream to one message per 50 ms, so this leaves room for several busy panes at once plus the
 * tree and replies; a socket over it is closed, which drops every session on it.
 */
export const RELAY_RATE = { messages: 1500, perMs: 10_000 } as const;
/** Pushes one pairing's desktop may ask for in a window. */
export const RELAY_PUSH_RATE = { messages: 30, perMs: 60_000 } as const;
/** Live sockets per role per pairing; a reconnect may overlap the socket it replaces. */
export const RELAY_MAX_SOCKETS_PER_ROLE = 2;
/** Sockets per pairing that have connected but not authenticated; the oldest makes room. */
export const RELAY_MAX_UNAUTH_SOCKETS = 4;
/** Registrations one client address may make in a window (the Worker's rate-limit binding). */
export const RELAY_REGISTER_RATE = { messages: 10, perMs: 60_000 } as const;
/** A claimed pairing with both sides absent this long is deleted by an alarm. */
export const RELAY_IDLE_PAIRING_MS = 30 * 24 * 60 * 60_000;
/** A socket that has not authenticated by then is closed. */
export const RELAY_AUTH_TIMEOUT_MS = 10_000;
/** Largest sealed push body the desktop may hand the relay. */
export const MAX_PUSH_BYTES = 4 * 1024;

/** Undecryptable frames a channel drops before it gives up on the session (MOB7). */
export const MAX_AUTH_FAILURES = 16;

/** Keystrokes in one Live-mode `pane.input`. */
export const MAX_INPUT_CHARS = 4096;
/** Text in one composer `pane.send`. */
export const MAX_SEND_CHARS = 16_384;
/** Rows one `pane.read` may ask for. */
export const MAX_READ_LINES = 400;
/** A file or diff the phone may read (MOB21); longer ones come back truncated. */
export const MAX_READ_BYTES = 512 * 1024;

/** The LAN listener (MOB9). */
export const LAN_MAX_SOCKETS = 8;
export const LAN_HANDSHAKE_TIMEOUT_MS = 5_000;

/** Keep-alive the clients send to the relay. */
export const PING_INTERVAL_MS = 25_000;
