/**
 * `@xterm/addon-unicode-graphemes` decodes its tables with `Buffer.from(text, "base64")` and reads
 * `result.buffer` from offset 0. A small `Buffer` lives inside Node's shared pool, so once anything
 * has used the pool the addon inflates the wrong bytes and throws "Data error" at import. The
 * renderer has no `Buffer` (the addon takes `atob` there), so only tests can hit it.
 */
Buffer.poolSize = 0;
