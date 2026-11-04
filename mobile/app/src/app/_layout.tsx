import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "@/app-state/app-provider";
import { LockGate } from "@/lock/lock-gate";
import { useTheme } from "@/theme/use-theme";

export default function RootLayout() {
  const palette = useTheme();
  return (
    <AppProvider>
      {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar's `style` is a string union ("auto"), not a style object */}
      <StatusBar style="auto" />
      <LockGate>
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.ground } }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="pair" options={{ presentation: "modal" }} />
          <Stack.Screen name="desktop/[id]" />
          <Stack.Screen name="needs-you" />
          <Stack.Screen name="new-agent" options={{ presentation: "modal" }} />
          <Stack.Screen name="checkout/[desktopId]/index" />
          <Stack.Screen name="checkout/[desktopId]/file" />
          <Stack.Screen name="checkout/[desktopId]/diff" />
          <Stack.Screen name="pane/[desktopId]/[paneId]" />
        </Stack>
      </LockGate>
    </AppProvider>
  );
}
