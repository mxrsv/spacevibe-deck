import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useTheme } from "@/theme/use-theme";

/** A scroll view with pull to refresh; the spinner shows until the promise settles. */
export function RefreshableScroll({
  onRefresh,
  children,
}: {
  readonly onRefresh: () => Promise<void>;
  readonly children: ReactNode;
}) {
  const palette = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={palette.textFaint}
          onRefresh={() => {
            setRefreshing(true);
            void onRefresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
