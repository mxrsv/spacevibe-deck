import type { ExpoConfig } from "expo/config";

// No ios/ or android/ folders are committed: Expo generates the native projects on demand
// (continuous native generation), and Expo Go runs the JavaScript without any of them.
const config: ExpoConfig = {
  name: "SpaceVibe Deck",
  slug: "spacevibe-deck",
  scheme: "spacevibe-deck",
  version: "1.0.0",
  orientation: "portrait",
  // The iPhone layout runs on iPad too (spec decision 4).
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "dev.spacevibe.deck.mobile",
    supportsTablet: true,
    buildNumber: "1",
    infoPlist: {
      NSCameraUsageDescription:
        "Deck scans the pairing code shown in Deck's Settings on your computer.",
      NSFaceIDUsageDescription:
        "Deck unlocks with Face ID so your agents stay private if you lose your phone.",
      // TODO(owner): the app uses end-to-end encryption (ChaCha20-Poly1305, X25519) implemented in
      // JavaScript, which counts as encryption for App Store export compliance. Answer the export
      // compliance questions in App Store Connect and set ITSAppUsesNonExemptEncryption to match
      // (false only when an exemption applies). It is deliberately left unset here.
    },
  },
  plugins: [
    "expo-router",
    [
      "expo-camera",
      {
        cameraPermission: "Deck scans the pairing code shown in Deck's Settings on your computer.",
      },
    ],
    "expo-secure-store",
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "Deck unlocks with Face ID so your agents stay private if you lose your phone.",
      },
    ],
    "expo-notifications",
  ],
  experiments: { typedRoutes: true },
};

export default config;
