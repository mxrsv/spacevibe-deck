import { useCallback, useEffect, useMemo, useState } from "react";
import type { WebView } from "react-native-webview";
import { usePrefsState, useServices, useConnectionSnapshot } from "@/app-state/app-provider";
import { zoomFor } from "@/prefs/prefs-store";
import type { DesktopEntry } from "@/session/manager";
import { useTheme } from "@/theme/use-theme";
import { Holder } from "./holder";
import { createInputBatcher } from "./keys";
import { createTerminalBridge, createTerminalFeed, type PageCommand } from "./terminal-bridge";
import { fitFontSize, pinchZoom, stepZoom } from "./zoom";

export type TerminalState = "connecting" | "live" | "ended" | "offline";

/**
 * One pane's terminal: subscribes with `pane.subscribe` while the desktop is online and the screen
 * is shown, feeds xterm through the bridge, sizes it to the DESKTOP pane (MOB14: the phone never
 * resizes it) and keeps the text size per desktop. A reconnect subscribes again by itself.
 */
export function usePaneTerminal(entry: DesktopEntry, paneId: number, live: boolean) {
  const { prefs: controller } = useServices();
  const { prefs } = usePrefsState();
  const palette = useTheme();
  const connection = entry.connection;
  const pairingId = entry.summary.pairingId;
  const online = useConnectionSnapshot(connection).status === "online";
  const zoom = zoomFor(prefs, pairingId);

  // Plain holders, not refs read while rendering: only event handlers and effects touch them.
  const [view] = useState(() => new Holder<WebView<object> | null>(null));
  const setWebView = useCallback(
    (instance: WebView<object> | null) => {
      view.set(instance);
    },
    [view],
  );
  const [size, setSize] = useState({ cols: 80, rows: 24 });
  const [width, setWidth] = useState(0);
  const [replay, setReplay] = useState(0);
  const [ended, setEnded] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Latest values for callbacks the bridge keeps (they are created once).
  const [latest] = useState(() => new Holder({ size, width, zoom, palette, pairingId }));
  useEffect(() => {
    latest.set({ size, width, zoom, palette, pairingId });
  }, [latest, size, width, zoom, palette, pairingId]);

  const batcher = useMemo(
    () =>
      createInputBatcher({
        send: (data) => {
          void connection.rpc.request("pane.input", { paneId, data }).catch(() => {});
        },
      }),
    [connection, paneId],
  );

  const bridge = useMemo(
    () =>
      createTerminalBridge({
        post: (command: PageCommand) =>
          view.get()?.injectJavaScript(`window.__deck(${JSON.stringify(command)});true;`),
        init: () => ({
          t: "init",
          cols: latest.get().size.cols,
          rows: latest.get().size.rows,
          fontSize: fitFontSize(latest.get().width, latest.get().size.cols, latest.get().zoom),
          background: latest.get().palette.terminalBg,
          foreground: latest.get().palette.terminalFg,
        }),
        onInput: (data) => batcher.push(data),
        onPinch: (scale) =>
          void controller.setTerminalZoom(
            latest.get().pairingId,
            pinchZoom(latest.get().zoom, scale),
          ),
        onNeedsReplay: () => setReplay((n) => n + 1),
      }),
    [batcher, controller, latest, view, setReplay],
  );

  const feed = useMemo(
    () =>
      createTerminalFeed({
        bridge,
        onSize: (cols, rows) =>
          setSize((old) => (old.cols === cols && old.rows === rows ? old : { cols, rows })),
        onEnd: (reason) => setEnded(reason),
        onGap: () => setReplay((n) => n + 1),
      }),
    [bridge, setSize, setEnded, setReplay],
  );

  useEffect(() => () => batcher.dispose(), [batcher]);

  // The subscription lives exactly as long as the screen is shown and the desktop is online; a
  // reconnect changes `online` and so subscribes again (the replay of the subscription).
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    let sub: string | null = null;
    feed.expect();
    const off = connection.onEvent((event) => feed.handle(event));
    connection.rpc
      .request("pane.subscribe", { paneId })
      .then((result) => {
        if (cancelled) {
          void connection.rpc.request("pane.unsubscribe", { sub: result.sub }).catch(() => {});
          return;
        }
        sub = result.sub;
        setEnded(null);
        setProblem(null);
        setSubscribed(true);
        feed.begin(result.sub, result.cols, result.rows);
      })
      .catch(() => {
        if (!cancelled) setProblem("Could not open this pane's terminal.");
      });
    return () => {
      cancelled = true;
      setSubscribed(false);
      off();
      feed.stop();
      if (sub !== null) void connection.rpc.request("pane.unsubscribe", { sub }).catch(() => {});
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `replay` is a re-run trigger (a gap or reload asks for a fresh subscription), not a value the effect reads
  }, [connection, online, paneId, feed, replay]);

  // Fit-to-width: the font size follows the screen width, the desktop's columns and the zoom.
  useEffect(() => {
    bridge.send({ t: "font", size: fitFontSize(width, size.cols, zoom) });
  }, [bridge, width, size.cols, zoom]);

  // Live mode: the terminal takes keyboard focus; the WebView allows it without a tap.
  useEffect(() => {
    bridge.send({ t: live ? "focus" : "blur" });
  }, [bridge, live]);

  const sendKeys = useCallback(
    (data: string) => {
      batcher.push(data);
      batcher.flush();
    },
    [batcher],
  );

  const state: TerminalState = !online
    ? "offline"
    : ended !== null
      ? "ended"
      : subscribed
        ? "live"
        : "connecting";
  return {
    setWebView,
    bridge,
    state,
    problem,
    endedReason: ended,
    cols: size.cols,
    zoom,
    setWidth,
    sendKeys,
    stepZoom: (direction: 1 | -1) =>
      void controller.setTerminalZoom(pairingId, stepZoom(zoom, direction)),
    resetZoom: () => void controller.setTerminalZoom(pairingId, 100),
  };
}
