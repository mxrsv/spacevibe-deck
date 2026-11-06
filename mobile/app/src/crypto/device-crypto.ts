import { getRandomBytes } from "expo-crypto";
import { createNobleCrypto } from "./noble";

/** The app-wide provider, seeded by the OS CSPRNG. */
export const deviceCrypto = createNobleCrypto((length) => getRandomBytes(length));
