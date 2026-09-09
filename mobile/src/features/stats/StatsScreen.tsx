// The Stats tab (2026-09-09 UX realignment): a hub for the reference views
// (drivers, compare, track types) plus the standings and metric boards it
// already carried. Series pills at the top switch Cup/Xfinity/Trucks — the
// server serves every series to ?series=N and gates 2/3 for free viewers, so
// SeriesPills locks those pills and a Pro viewer sees real Xfinity/Trucks data.
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { serverBase } from "../../lib/config.ts";
import { useReload } from "../../lib/reload.ts";
import { SERIES, useSeries } from "../../lib/series.tsx";
import { useViewer } from "../../lib/viewer.tsx";
import { Card, ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { ProLock } from "../pro/ProLock.tsx";
import { SeriesPills } from "../pro/SeriesPills.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchStats, type MetricRow, type StatsResult } from "./api.ts";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

const HUB: Array<{ route: string; icon: IoniconName; title: string; sub: string }> = [
  { route: "/drivers", icon: "people-outline", title: "Drivers", sub: "Profiles, race logs, careers" },
  { route: "/compare", icon: "swap-horizontal-outline", title: "Compare drivers", sub: "Head to head — up to four with Pro" },
  { route: "/tracks", icon: "ellipse-outline", title: "Track types", sub: "Who is genuinely good on this kind of track" },
];

export function StatsScreen() {
  const { series } = useSeries();
  const { viewer } = useViewer();
  const [data, setData] = useState<StatsResult | undefined>(undefined);

  const load = useCallback(async () => {
    setData(await fetchStats(await serverBase(), series));
  }, [series]);

  // Re-fetch when the series changes or a sign-in/purchase widens access.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, viewer.status]),
  );
  const { refreshing, onRefresh } = useReload(load);

  const hub = (
    <Card title="Explore">
      {HUB.map((h) => (
        <Pressable key={h.route} onPress={() => router.push(h.route)} style={styles.hubRow}>
          <Ionicons name={h.icon} size={19} color={colors.muted} />
          <View style={styles.hubText}>
            <Text style={styles.hubTitle}>{h.title}</Text>
            <Text style={styles.hubSub}>{h.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </Pressable>
      ))}
    </Card>
  );

  const pills = (
    <View style={styles.pills}>
      <SeriesPills />
    </View>
  );

  if (data === undefined)
    return (
      <Screen>
        {pills}
        {hub}
        <Loading label="Loading standings…" />
      </Screen>
    );

  if (data === "locked")
    return (
      <Screen>
        {pills}
        {hub}
        <ProLock
          title="Xfinity & Trucks"
          pitch="Standings, metric boards and recaps for all three national series."
        />
      </Screen>
    );

  // A series the server has not ingested yet answers 404. Saying "could not
  // reach the server" there blames the network for missing data — the same
  // class of lie as the 2026-09-08 drive's finding #2.
  if (data === "empty")
    return (
      <Screen>
        {pills}
        {hub}
        <Card title={`No ${SERIES.find((s) => s.id === series)?.label ?? "series"} data yet`}>
          <Text style={styles.emptyNote}>
            We haven't loaded this series yet — it's on the way.
          </Text>
        </Card>
      </Screen>
    );

  if (data === null)
    return (
      <Screen>
        {pills}
        {hub}
        <ErrorNote message="Could not reach the server." onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {pills}
      {hub}
      <Card title={`${data.season} standings`}>
        {data.standings.slice(0, 20).map((row, index) => (
          <View key={row.driverId} style={styles.row}>
            <Text style={styles.rank}>{index + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {row.fullName}
            </Text>
            <Text style={styles.points}>{row.points} pts</Text>
            <Text style={styles.wins}>{row.wins > 0 ? `${row.wins}W` : ""}</Text>
          </View>
        ))}
      </Card>
      <MetricCard title="Adjusted pass efficiency" rows={data.adjPass} />
      <MetricCard title="Closer score" rows={data.closer} />
    </Screen>
  );
}

function MetricCard({ title, rows }: { title: string; rows: MetricRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card title={title} right="Beyond the box score">
      {rows.slice(0, 10).map((row) => (
        <View key={row.driverId} style={styles.row}>
          <Text style={styles.rank}>{row.rank}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {row.fullName}
          </Text>
          <Text style={styles.points}>{row.value.toFixed(2)}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { marginBottom: 2 },
  emptyNote: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  hubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 11,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hubText: { flex: 1, minWidth: 0 },
  hubTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  hubSub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { color: colors.muted, width: 22, fontSize: 13, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, minWidth: 0, fontSize: 14 },
  points: { color: colors.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  wins: { color: colors.accent, width: 32, textAlign: "right", fontSize: 12, fontWeight: "700" },
});
