import { useLocalSearchParams } from "expo-router";
import { NewAgentScreen } from "@/newagent/new-agent-screen";

export default function NewAgentRoute() {
  const { desktopId } = useLocalSearchParams<{ desktopId?: string }>();
  return <NewAgentScreen presetDesktopId={desktopId ?? null} />;
}
