import { Switch, View } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { IconBox } from "./grouped-list";
import { Symbol } from "./symbol";
import { Txt } from "./text";

interface SwitchRowProps {
  readonly title: string;
  readonly icon: SFSymbol;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}

export function SwitchRow({ title, icon, value, onValueChange }: SwitchRowProps) {
  const palette = useTheme();
  return (
    <View
      style={{
        minHeight: metrics.rowOneLine,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 14,
      }}
    >
      <IconBox>
        <Symbol name={icon} />
      </IconBox>
      <View style={{ flex: 1 }}>
        <Txt variant="subheadlineStrong">{title}</Txt>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.switchTrack, true: palette.status.done }}
        thumbColor={palette.switchThumb}
      />
    </View>
  );
}
