import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, type Palette } from "./tokens";

/** The palette for the system appearance; Deck has no in-app theme switch on the phone. */
export function useTheme(): Palette {
  return useColorScheme() === "light" ? lightPalette : darkPalette;
}
