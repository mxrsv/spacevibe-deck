import * as LocalAuthentication from "expo-local-authentication";

export type AuthResult = "ok" | "cancelled" | "unavailable";

/**
 * Face ID with the device passcode as the fallback (MOB4, `disableDeviceFallback: false`). A phone
 * with no passcode at all has nothing to unlock with, so the lock cannot apply: "unavailable"
 * lets the caller open the app rather than trap the user outside it.
 */
export async function authenticate(promptMessage: string): Promise<AuthResult> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return "unavailable";
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: false,
    });
    return result.success ? "ok" : "cancelled";
  } catch {
    return "cancelled";
  }
}
