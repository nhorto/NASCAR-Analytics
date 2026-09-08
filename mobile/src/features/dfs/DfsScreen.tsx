// DFS projections, DK/FD toggle, and a lineup scratchpad. This screen is
// Pro-only in full: the server answers 403 for a free viewer and no
// projection ever reaches the device, so the unentitled state is the lock
// card and nothing else.
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { useReload } from "../../lib/reload.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card, ErrorNote, Loading, Screen, Segmented } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { ProLock } from "../pro/ProLock.tsx";
import { fetchDfs, PLATFORM_LABELS, type DfsPlatform, type DfsResult } from "./api.ts";
import { displayRows, lineupSummary, pruneSelection, scoringLine, stampLine, toggleDriver } from "./model.ts";

const PLATFORM_OPTIONS = [
  { value: "dk" as const, label: PLATFORM_LABELS.dk },
  { value: "fd" as const, label: PLATFORM_LABELS.fd },
];

export function DfsScreen() {
  const { viewer } = useViewer();
  const [platform, setPlatform] = useState<DfsPlatform>("dk");
  const [result, setResult] = useState<DfsResult | undefined>(undefined);
  const [selected, setSelected] = useState<number[]>([]);

  const load = useCallback(
    async (next: DfsPlatform) => {
      const fetched = await fetchDfs(await serverBase(), next);
      setResult(fetched);
      // Switching platforms keeps the picks; a new race week drops the ones
      // that no longer exist rather than silently counting stale points.
      if (fetched.status === "ok")
        setSelected((current) => pruneSelection(fetched.data.rows, current));
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void load(platform);
    }, [load, platform, viewer.status]),
  );
  const { refreshing, onRefresh } = useReload(useCallback(() => load(platform), [load, platform]));

  if (result === undefined) return <Loading label="Loading projections…" />;

  if (result.status === "locked")
    return (
      <Screen>
        <ProLock
          title="DFS projections — Pro"
          pitch="DraftKings and FanDuel projected points for the whole field, every race weekend."
          detail="Projections come from the same simulation as the race predictions — expected finish, laps led and fastest laps, scored with each platform's own rules."
        />
      </Screen>
    );

  if (result.status === "error")
    return (
      <Screen>
        <ErrorNote message="Could not reach the server." onRetry={() => void load(platform)} />
      </Screen>
    );

  const { data } = result;
  const rows = displayRows(data.rows, selected);
  const lineup = lineupSummary(data.rows, selected);
  const scoring = scoringLine(data.scoring);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Card title={`DFS projections — ${PLATFORM_LABELS[data.platform]}`}>
        <Segmented options={PLATFORM_OPTIONS} value={platform} onChange={setPlatform} />
        {data.rows.length === 0 ? (
          <Text style={styles.note}>
            No projection run is stored yet — projections publish with each predictions run
            (Thursday and Saturday).
          </Text>
        ) : (
          <>
            <Text style={styles.stamp}>{stampLine(data)}</Text>
            {scoring ? <Text style={styles.scoring}>Scoring: {scoring}</Text> : null}
          </>
        )}
      </Card>

      {lineup.count > 0 ? (
        <Card title="Lineup scratchpad" right={`${lineup.points} proj pts`}>
          {lineup.drivers.map((driver) => (
            <Pressable
              key={driver.driverId}
              onPress={() => setSelected((current) => toggleDriver(current, driver.driverId))}
              style={styles.row}
            >
              <Text style={styles.name} numberOfLines={1}>
                {driver.fullName}
              </Text>
              <Text style={styles.points}>{driver.projectedPoints.toFixed(1)}</Text>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          ))}
          <Text style={styles.note}>
            {lineup.count} selected. Salaries are not in the dataset, so this totals projected
            points only — pair it with your site's salary sheet for value.
          </Text>
          <View style={styles.clear}>
            <Button label="Clear" tone="quiet" onPress={() => setSelected([])} />
          </View>
        </Card>
      ) : null}

      {data.rows.length > 0 ? (
        <Card title="Projections" right="Tap to build a lineup">
          <View style={[styles.row, styles.headerRow]}>
            <Text style={styles.rank} />
            <Text style={[styles.name, styles.headerText]}>Driver</Text>
            <Text style={[styles.cell, styles.headerText]}>Start</Text>
            <Text style={[styles.cell, styles.headerText]}>Proj</Text>
          </View>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={() => setSelected((current) => toggleDriver(current, row.driverId))}
              style={[styles.row, row.picked && styles.rowPicked]}
            >
              <Text style={styles.rank}>{row.picked ? "✓" : row.rank}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={styles.cell}>{row.start}</Text>
              <Text style={[styles.cell, styles.strong]}>{row.points}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => router.push("/predictions")}>
            <Text style={styles.link}>See the predictions behind these numbers →</Text>
          </Pressable>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  stamp: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  scoring: { color: colors.muted, fontSize: 12, marginTop: 4 },
  link: { color: colors.accent, fontSize: 12, marginTop: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPicked: { backgroundColor: colors.surface2 },
  headerRow: { borderBottomColor: colors.muted },
  headerText: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  rank: { color: colors.muted, width: 20, fontSize: 12, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, minWidth: 0, fontSize: 14 },
  cell: {
    color: colors.text,
    width: 52,
    fontSize: 13,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  strong: { fontWeight: "700" },
  points: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  remove: { color: colors.muted, fontSize: 13, width: 18, textAlign: "right" },
  clear: { marginTop: 12 },
});
