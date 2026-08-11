/**
 * Output batching for a PTY session — the Node counterpart of the reader and
 * emitter threads in `src-tauri/src/pty.rs`.
 *
 * Rust runs two threads and a bounded `sync_channel`, so a fast producer
 * (`cat` on a huge file, `yes`) backs up into the PTY pipe and gets throttled
 * by the kernel. Node has one event loop and `node-pty` hands us decoded
 * chunks, so the shape is different but the two properties that matter are
 * kept:
 *
 *  1. **Batching.** Chunks that arrive while the renderer is busy are merged
 *     into one IPC message, capped at `BATCH_MAX_BYTES`, instead of producing
 *     one message per read.
 *  2. **A bounded backlog.** Once the queue exceeds `QUEUE_MAX_BYTES` the
 *     session is paused, which stops `node-pty` reading and lets the kernel
 *     apply the same backpressure Rust got from its bounded channel.
 *
 * The UTF-8 holdback from Rust (`take_valid_utf8`) is NOT reimplemented here:
 * `node-pty` is constructed with `encoding: null` and the raw bytes run
 * through `TextDecoder({ stream: true })` in `decodeStream`, which is the same
 * guarantee — an incomplete trailing sequence is carried to the next chunk
 * instead of becoming U+FFFD.
 */

/** Cap for one emitted batch — big enough for a bursty `cat`, small enough
 * that a single IPC message stays cheap. Matches `BATCH_MAX_BYTES` in pty.rs. */
export const BATCH_MAX_BYTES = 64 * 1024;

/**
 * Backlog ceiling before the PTY is paused. Rust bounds its queue by chunk
 * count (`QUEUE_CHUNKS = 64` of up to 8 KB each); this is the same order of
 * magnitude expressed in bytes, which is the unit actually available here.
 */
export const QUEUE_MAX_BYTES = 64 * 8192;

export interface OutputBatcherOptions {
  /** Deliver one batch. Called on a microtask, never synchronously. */
  readonly emit: (data: string) => void;
  /** Stop the source reading — invoked when the backlog passes the ceiling. */
  readonly pause: () => void;
  /** Resume the source once the backlog has drained. */
  readonly resume: () => void;
  readonly batchMaxBytes?: number;
  readonly queueMaxBytes?: number;
}

/**
 * Accumulates chunks and flushes them as batches.
 *
 * Flushing is deferred by one microtask so a burst of `onData` callbacks in
 * the same tick coalesces into a single emit, which is the behaviour Rust got
 * for free from `try_recv` draining the channel.
 */
export class OutputBatcher {
  private readonly options: Required<OutputBatcherOptions>;
  private queue: string[] = [];
  private queuedBytes = 0;
  private scheduled = false;
  private paused = false;
  private closed = false;

  constructor(options: OutputBatcherOptions) {
    this.options = {
      batchMaxBytes: BATCH_MAX_BYTES,
      queueMaxBytes: QUEUE_MAX_BYTES,
      ...options,
    };
  }

  push(chunk: string): void {
    if (this.closed || chunk.length === 0) {
      return;
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    if (!this.paused && this.queuedBytes > this.options.queueMaxBytes) {
      this.paused = true;
      this.options.pause();
    }
    this.schedule();
  }

  /** Flush everything still queued — used on the exit path. */
  flush(): void {
    this.scheduled = false;
    while (this.queue.length > 0) {
      this.emitOneBatch();
    }
  }

  /** Stop accepting and scheduling; the caller flushes first if it wants the tail. */
  close(): void {
    this.closed = true;
    this.queue = [];
    this.queuedBytes = 0;
  }

  private schedule(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.closed) {
        return;
      }
      this.emitOneBatch();
      if (this.queue.length > 0) {
        this.schedule();
        return;
      }
      if (this.paused) {
        this.paused = false;
        this.options.resume();
      }
    });
  }

  /**
   * Take up to `batchMaxBytes` worth of queued chunks, in order.
   *
   * A chunk that would push the batch past the cap is left at the head for the
   * next call — unless the batch is still empty, in which case it goes out
   * whole. That mirrors `collect_batch`'s `len != 0` guard in pty.rs and is
   * what stops a single oversized chunk from wedging the queue forever.
   */
  private emitOneBatch(): void {
    if (this.queue.length === 0) {
      return;
    }
    let size = 0;
    let count = 0;
    for (const chunk of this.queue) {
      if (count > 0 && size + chunk.length > this.options.batchMaxBytes) {
        break;
      }
      size += chunk.length;
      count += 1;
      if (size >= this.options.batchMaxBytes) {
        break;
      }
    }
    const batch = this.queue.slice(0, count).join("");
    this.queue = this.queue.slice(count);
    this.queuedBytes -= size;
    this.options.emit(batch);
  }
}

/**
 * Incremental UTF-8 decoder for raw PTY bytes.
 *
 * `node-pty` with `encoding: null` emits Buffers, and a multi-byte sequence can
 * straddle a read boundary. `TextDecoder` in streaming mode holds the partial
 * sequence back, which is exactly what `take_valid_utf8` does in Rust —
 * including turning genuinely invalid bytes into U+FFFD rather than stalling.
 */
export function createStreamDecoder(): (bytes: Uint8Array) => string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return (bytes) => decoder.decode(bytes, { stream: true });
}
