// Home: live-now banner (or next race), top of the standings, quick links.
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { useReload } from "../../lib/reload.ts";
import { Card, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchLive, type LiveData } from "../live/api.ts";
import { formatStart } from "../live/model.ts";
import { fetchStats, type StatsData } from "../stats/api.ts";

interface HomeData {
  live: LiveData | null;
  stats: StatsData | null;
}

export function HomeScreen() {
  const [data, setData] = useState<HomeData | undefined>(undefined);

  const load = useCallback(async () => {
    const base = await serverBase();
    // Home is always Cup, which is never Pro-locked and (in practice) never
    // empty — collapse both non-data verdicts into the card's fallback copy.
    const [live, stats] = await Promise.all([fetchLive(), fetchStats(base, 1)]);
    setData({ live, stats: typeof stats === "string" ? null : stats });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (data === undefined) void load();
    }, [data, load]),
  );
  const { refreshing, onRefresh } = useReload(load);

  if (data === undefined) return <Loading />;
  const liveNow = data.live?.live === true;
  const next = data.live?.nextRace ?? null;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Pressable onPress={() => router.push("/live")}>
        <Card title={liveNow ? "Live now" : "Next up"}>
          {liveNow ? (
            <Text style={styles.liveNow}>● Cup session on track — open the live board</Text>
          ) : next ? (
            <View>
              <Text style={styles.nextName}>{next.name ?? "Next Cup session"}</Text>
              <Text style={styles.nextDetail}>
                {[next.trackName, formatStart(next.startTimeUtc)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ) : (
            <Text style={styles.nextDetail}>Schedule unavailable.</Text>
          )}
        </Card>
      </Pressable>
      {data.stats ? (
        <Pressable onPress={() => router.push("/stats")}>
          <Card title={`${data.stats.season} standings`} right="See all">
            {data.stats.standings.slice(0, 5).map((row, index) => (
              <View key={row.driverId} style={styles.row}>
                <Text style={styles.rank}>{index + 1}</Text>
                <Text style={styles.name}>{row.fullName}</Text>
                <Text style={styles.points}>{row.points} pts</Text>
              </View>
            ))}
          </Card>
        </Pressable>
      ) : (
        <Card title="Standings">
          <Text style={styles.nextDetail}>
            Server unreachable — set the server address under Account → Settings.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveNow: { color: colors.pos, fontSize: 14, fontWeight: "600" },
  nextName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  nextDetail: { color: colors.muted, fontSize: 13, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  rank: { color: colors.muted, width: 20, fontSize: 13, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, fontSize: 14 },
  points: { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
});
