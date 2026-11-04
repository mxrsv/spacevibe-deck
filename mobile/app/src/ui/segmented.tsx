import { Pressable, View } from "react-native";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "./text";

/** The mock's three-way control (Files · Changes · Usage): a quiet track with the chosen segment raised. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (id: T) => void;
}) {
  const palette = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        marginHorizontal: metrics.screenInset,
        marginTop: 4,
        marginBottom: 10,
        flexDirection: "row",
        padding: 2,
        borderRadius: 9,
        backgroundColor: palette.iconBox,
      }}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.id)}
            style={{
              flex: 1,
              minHeight: metrics.hit - 8,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 7,
              backgroundColor: selected ? palette.group : "transparent",
            }}
          >
            <Txt
              variant={selected ? "subheadlineStrong" : "subheadline"}
              tone={selected ? "text" : "muted"}
            >
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
