import { View } from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "@/ui/text";
import { parsePageMessage } from "./terminal-bridge";
import { TERMINAL_HTML } from "./terminal-html.generated";
import type { usePaneTerminal } from "./use-pane-terminal";

type Terminal = ReturnType<typeof usePaneTerminal>;

interface TerminalViewProps {
  readonly state: Terminal["state"];
  readonly problem: Terminal["problem"];
  readonly bridge: Terminal["bridge"];
  readonly setWebView: Terminal["setWebView"];
  readonly setWidth: Terminal["setWidth"];
}

const SOURCE = { html: TERMINAL_HTML };

/** xterm.js in a WebView (MOB17). All traffic goes through the bridge; the page needs no network. */
export function TerminalView({ state, problem, bridge, setWebView, setWidth }: TerminalViewProps) {
  const palette = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: palette.terminalBg }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <WebView<object>
        ref={setWebView}
        source={SOURCE}
        originWhitelist={["about:*"]}
        // Our own page only: nothing inside it may navigate the WebView elsewhere.
        onShouldStartLoadWithRequest={(request) => request.url.startsWith("about:")}
        onMessage={(event) => {
          const message = parsePageMessage(event.nativeEvent.data);
          if (message !== null) bridge.receive(message);
        }}
        style={{ flex: 1, backgroundColor: palette.terminalBg }}
        bounces={false}
        overScrollMode="never"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        accessibilityLabel="Terminal"
      />
      {state === "live" ? null : (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" }}
        >
          <Txt variant="footnote" tone="faint">
            {state === "offline"
              ? "Desktop offline"
              : state === "ended"
                ? "This pane has closed"
                : (problem ?? "Connecting…")}
          </Txt>
        </View>
      )}
    </View>
  );
}
