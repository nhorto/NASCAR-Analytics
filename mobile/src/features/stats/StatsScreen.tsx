// Season standings and the proprietary-metric boards (Cup, free tier).
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { useReload } from "../../lib/reload.ts";
import { Card, ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchStats, type MetricRow, type StatsData } from "./api.ts";

export function StatsScreen() {
  const [data, setData] = useState<StatsData | null | undefined>(undefined);

  const load = useCallback(async () => {
    setData(await fetchStats(await serverBase()));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (data === undefined || data === null) void load();
    }, [data, load]),
  );
  const { refreshing, onRefresh } = useReload(load);

  if (data === undefined) return <Loading label="Loading standings…" />;
  if (data === null)
    return (
      <Screen>
        <ErrorNote message="Could not reach the server." onRetry={() => void load()} />
      </Screen>
    );

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Card title={`${data.season} Cup standings`}>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { color: colors.muted, width: 24, fontSize: 13, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, fontSize: 14 },
  points: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  wins: { color: colors.accent, width: 30, fontSize: 12, textAlign: "right" },
});
