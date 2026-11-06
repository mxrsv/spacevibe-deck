import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { type } from "@/theme/type";
import { useTheme } from "@/theme/use-theme";

interface IconProps {
  readonly color: ColorValue;
  readonly size: number;
}
const DesktopsIcon = ({ color, size }: IconProps) => (
  <SymbolView name="laptopcomputer" tintColor={color} size={size} />
);
const SettingsIcon = ({ color, size }: IconProps) => (
  <SymbolView name="gearshape" tintColor={color} size={size} />
);

/** Desktops and Settings (spec decision 25, MOB16). */
export default function TabsLayout() {
  const palette = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.text,
        tabBarInactiveTintColor: palette.textFaint,
        tabBarLabelStyle: {
          fontSize: type.caption2.fontSize,
          fontWeight: type.caption2.fontWeight,
        },
        tabBarStyle: { backgroundColor: palette.ground, borderTopColor: palette.separator },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Desktops",
          tabBarAccessibilityLabel: "Desktops",
          tabBarIcon: DesktopsIcon,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarAccessibilityLabel: "Settings",
          tabBarIcon: SettingsIcon,
        }}
      />
    </Tabs>
  );
}
