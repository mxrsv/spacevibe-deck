import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { PrefsController } from "@/prefs/prefs-store";
import type { DesktopConnection } from "@/session/connection";
import type { DesktopEntry } from "@/session/manager";
import { createServices, type AppServices } from "./services";

const ServicesContext = createContext<AppServices | null>(null);

/**
 * Owns the app's long-lived objects: the connection manager and the preferences. Connections run
 * while the app is in front (iOS suspends sockets in the background anyway) and restart on return.
 */
export function AppProvider({ children }: { readonly children: ReactNode }) {
  const [services] = useState(createServices);

  useEffect(() => {
    let cancelled = false;
    void services.prefs.load();
    void services.manager.load().then(() => {
      if (!cancelled) services.manager.setActive(AppState.currentState === "active");
    });
    const subscription = AppState.addEventListener("change", (state) => {
      services.manager.setActive(state === "active");
    });
    return () => {
      cancelled = true;
      subscription.remove();
      services.manager.setActive(false);
    };
  }, [services]);

  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error("AppProvider is missing above this component");
  return services;
}

export function useDesktopEntries(): readonly DesktopEntry[] {
  const { manager } = useServices();
  return useSyncExternalStore(manager.subscribe, manager.getEntries);
}

export function useConnectionSnapshot(connection: DesktopConnection) {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}

function usePrefsController(): PrefsController {
  return useServices().prefs;
}

export function usePrefsState() {
  const prefs = usePrefsController();
  return useSyncExternalStore(prefs.subscribe, prefs.getSnapshot);
}
