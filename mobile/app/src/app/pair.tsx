import { useRouter } from "expo-router";
import { PairScreen } from "@/pairing/pair-screen";

export default function PairRoute() {
  const router = useRouter();
  return <PairScreen onClose={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
