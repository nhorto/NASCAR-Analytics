// The Pro hub. Gating reads server entitlement only (usePro ← /api/me).
//
// Every feature that has a mobile screen is reachable from here in *both*
// entitlement states: the screens themselves render the locked treatment (the
// server withholds the data, not the client), so a free viewer can see the
// real shape of what Pro buys instead of a wall. Features that do not have a
// mobile screen yet say so plainly rather than pretending to be a door.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Card, ProBadge, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { ProLock } from "./ProLock.tsx";

interface Feature {
  key: string;
  title: string;
  detail: string;
  /** Where the mobile screen lives; null when it is still web-only. */
  route: string | null;
  /** Shown to a free viewer instead of "Coming to mobile". */
  freeHint?: string;
}

const FEATURES: readonly Feature[] = [
  {
    key: "predictions",
    title: "Race predictions",
    detail: "Win / top-5 / top-10 probabilities every Thursday, refreshed after qualifying.",
    route: "/predictions",
    freeHint: "Open it — the top three are free.",
  },
  {
    key: "dfs",
    title: "DFS projections",
    detail: "DraftKings and FanDuel projected points, with a lineup scratchpad.",
    route: "/dfs",
  },
  {
    key: "compare",
    title: "Compare drivers",
    detail: "Up to four drivers, across series and a season range.",
    route: "/compare",
    freeHint: "Open it — two Cup drivers in one season are free.",
  },
  {
    key: "tracks",
    title: "Track-type explorer",
    detail: "Who is genuinely good on this kind of track, over any season range.",
    route: "/tracks",
    freeHint: "Open it — Cup is free.",
  },
  {
    key: "series",
    title: "Xfinity + Trucks",
    detail: "Every stat, board, and recap for all three national series.",
    route: null,
  },
  {
    key: "export",
    title: "CSV exports",
    detail: "Every table on the site, with the filters you are looking at.",
    route: null,
  },
  {
    key: "push",
    title: "Driver alerts",
    detail: "Pit, caution, stage, and finish alerts for your driver.",
    route: null,
  },
];

export function ProScreen() {
  const { viewer } = useViewer();
  const pro = viewer.status === "signed_in" && viewer.me.pro;

  return (
    <Screen>
      {pro ? (
        <Card title="Pro is active">
          <Text style={styles.pitch}>
            Everything below is unlocked on this device. Entitlement is read from the server, so a
            purchase made anywhere applies everywhere.
          </Text>
        </Card>
      ) : (
        <ProLock
          title="LoopLab Pro"
          pitch="All three series, predictions, DFS projections, deep tools, and driver alerts."
        />
      )}

      {FEATURES.map((feature) => {
        const openable = feature.route !== null;
        return (
          <Card key={feature.key}>
            <View style={styles.featureHeader}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              {pro ? <ProBadge /> : <Text style={styles.lock}>🔒</Text>}
            </View>
            <Text style={styles.featureDetail}>{feature.detail}</Text>
            {openable ? (
              <Pressable onPress={() => router.push(feature.route!)}>
                <Text style={styles.open}>{pro ? "Open →" : (feature.freeHint ?? "Open →")}</Text>
              </Pressable>
            ) : (
              <Text style={styles.soon}>Available on the web — coming to mobile.</Text>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pitch: { color: colors.text, fontSize: 14, lineHeight: 20 },
  featureHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  featureTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  lock: { fontSize: 14 },
  featureDetail: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  open: { color: colors.accent, fontSize: 13, marginTop: 8, fontWeight: "600" },
  soon: { color: colors.muted, fontSize: 12, marginTop: 8, fontStyle: "italic" },
});
