import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useTreeSnapshot } from "@/home/use-home";
import { openPane } from "@/home/open-pane";
import { PaneRow } from "@/home/pane-row";
import type { DesktopEntry } from "@/session/manager";
import { Group } from "@/ui/grouped-list";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";

/**
 * One online desktop's tree under its header: projects, their checkouts (branch symbol) and the
 * panes in each, with the rail's marks. Nothing for a desktop that is not online: a stale tree
 * would claim agents are running that nobody can see.
 */
export function DesktopTree({ entry }: { readonly entry: DesktopEntry }) {
  const router = useRouter();
  const { status, tree } = useTreeSnapshot(entry.connection);
  if (status !== "online" || tree === null) return null;
  if (tree.projects.length === 0) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Txt variant="footnote" tone="faint">
          No projects open in Deck.
        </Txt>
      </View>
    );
  }
  return (
    <View>
      {tree.projects.map((project) => (
        <View key={project.path}>
          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
            <Txt
              variant="subheadlineStrong"
              tone="muted"
              numberOfLines={1}
              accessibilityRole="header"
            >
              {project.name}
            </Txt>
          </View>
          {project.checkouts.map((checkout) => (
            <View key={checkout.path}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${checkout.branch ?? checkout.name}, files, changes and usage`}
                onPress={() =>
                  router.push({
                    pathname: "/checkout/[desktopId]",
                    params: {
                      desktopId: entry.summary.pairingId,
                      root: checkout.path,
                      name: project.name,
                    },
                  })
                }
                style={{
                  minHeight: 36,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 20,
                }}
              >
                <Symbol name="arrow.triangle.branch" size={12} tone="faint" />
                <View style={{ flex: 1 }}>
                  <Txt variant="footnote" tone="faint" numberOfLines={1}>
                    {checkout.branch ?? checkout.name}
                  </Txt>
                </View>
                <Symbol name="chevron.right" size={10} tone="faint" />
              </Pressable>
              {checkout.panes.length === 0 ? null : (
                <Group>
                  {checkout.panes.map((pane) => (
                    <PaneRow
                      key={pane.paneId}
                      pane={pane}
                      onPress={() => openPane(router, entry.summary.pairingId, pane.paneId, false)}
                    />
                  ))}
                </Group>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
