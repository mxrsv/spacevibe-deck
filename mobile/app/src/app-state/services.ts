import Constants from "expo-constants";
import { Platform } from "react-native";
import { PROTOCOL_VERSION } from "@protocol/version";
import { deviceCrypto } from "@/crypto/device-crypto";
import { createPairingStore } from "@/pairing/pairing-store";
import { createPrefsController, type PrefsController } from "@/prefs/prefs-store";
import { createSessionManager, type SessionManager } from "@/session/manager";
import { createRnSocket } from "@/session/socket";
import { secureKeyValue } from "@/storage/secure-kv";

export interface AppServices {
  readonly manager: SessionManager;
  readonly prefs: PrefsController;
  readonly pairingDeps: {
    readonly phone: {
      readonly name: string;
      readonly model: string;
      readonly os: string;
      readonly v: number;
    };
  };
  readonly versionLine: string;
}

/** The app version the user sees and the desktop logs, from app.config.ts. */
function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export function createServices(): AppServices {
  const deviceName = Constants.deviceName ?? "iPhone";
  const build = Constants.expoConfig?.ios?.buildNumber ?? "1";
  return {
    manager: createSessionManager({
      store: createPairingStore(secureKeyValue),
      crypto: deviceCrypto,
      socketFactory: createRnSocket,
      session: { device: deviceName, appVersion: appVersion() },
    }),
    prefs: createPrefsController(secureKeyValue),
    pairingDeps: {
      phone: {
        name: deviceName,
        model: Platform.OS === "ios" ? "iPhone" : Platform.OS,
        os: "iOS",
        v: PROTOCOL_VERSION,
      },
    },
    versionLine: `Version ${appVersion()} (${build}) · protocol ${PROTOCOL_VERSION}`,
  };
}
