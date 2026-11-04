import { SymbolView, type SFSymbol } from "expo-symbols";
import { useTheme } from "@/theme/use-theme";
import { toneColor, type TextTone } from "./text";

interface SymbolProps {
  readonly name: SFSymbol;
  readonly size?: number;
  readonly tone?: TextTone;
}

/** An SF Symbol (spec decision 26). Decorative: the control around it carries the accessibility label. */
export function Symbol({ name, size = 18, tone = "muted" }: SymbolProps) {
  const palette = useTheme();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={toneColor(palette, tone)}
      weight="regular"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
