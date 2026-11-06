/**
 * The WebSocket as the session code sees it. The app uses React Native's `WebSocket`; tests pass a
 * scripted fake. Callbacks arrive through the factory so a socket never has handlers swapped under it.
 */
export interface SocketEvents {
  onOpen(): void;
  onText(text: string): void;
  onBinary(bytes: Uint8Array): void;
  onClose(code: number, reason: string): void;
}

export interface PhoneSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, events: SocketEvents) => PhoneSocket;

/** A close that never reached the relay (network down, TLS failure): RFC 6455's abnormal closure. */
export const CLOSE_ABNORMAL = 1006;
export const CLOSE_NORMAL = 1000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** React Native's built-in `WebSocket`, with binary frames as `ArrayBuffer`. */
export const createRnSocket: SocketFactory = (url, events) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  let closed = false;
  const closeOnce = (code: number, reason: string): void => {
    if (closed) return;
    closed = true;
    events.onClose(code, reason);
  };
  ws.onopen = () => events.onOpen();
  ws.onmessage = (event) => {
    const data: unknown = event.data;
    if (typeof data === "string") events.onText(data);
    else if (data instanceof ArrayBuffer) events.onBinary(new Uint8Array(data));
  };
  // React Native fires `onerror` and then `onclose`; the close carries the code, so only a missing
  // close needs the fallback.
  ws.onerror = () => closeOnce(CLOSE_ABNORMAL, "error");
  ws.onclose = (event) => closeOnce(event.code ?? CLOSE_ABNORMAL, event.reason ?? "");
  return {
    send(data) {
      ws.send(typeof data === "string" ? data : toArrayBuffer(data));
    },
    close(code, reason) {
      ws.close(code, reason);
    },
  };
};
