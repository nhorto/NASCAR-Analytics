// The free Cup live board. Polls while focused (5 s, matching the Worker's
// 3 s edge cache), stops on blur — no timers run off-screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Card, ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { colors, flagColors } from "../../ui/theme.ts";
import { fetchLive, type LiveData } from "./api.ts";
import { liveModel, type BoardRow } from "./model.ts";

const POLL_MS = 5_000;

export function LiveScreen() {
  const [data, setData] = useState<LiveData | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    setData(await fetchLive());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void poll();
      timer.current = setInterval(() => void poll(), POLL_MS);
      return () => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
      };
    }, [poll]),
  );

  if (data === undefined) return <Loading label="Loading the live board…" />;
  const model = liveModel(data, Date.now());

  if (model.kind === "unavailable") {
    return (
      <Screen>
        <ErrorNote message="The live feed is unreachable." onRetry={() => void poll()} />
      </Screen>
    );
  }

  if (model.kind === "idle") {
    return (
      <Screen>
        <Card title="Live">
          <Text style={styles.idleHeadline}>{model.headline}</Text>
          {model.detail ? <Text style={styles.idleDetail}>{model.detail}</Text> : null}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {model.header.title}
        </Text>
        <View style={styles.headerRow}>
          <Text style={[styles.flag, { color: flagColors[model.header.flag.toLowerCase()] ?? colors.muted }]}>
            ● {model.header.flag}
          </Text>
          <Text style={styles.lapLine}>{model.header.lapLine}</Text>
        </View>
        {model.header.stageLine ? <Text style={styles.stageLine}>{model.header.stageLine}</Text> : null}
        {model.header.staleness ? <Text style={styles.stale}>{model.header.staleness}</Text> : null}
      </View>
      <FlatList
        data={model.rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <Row row={item} />}
        contentContainerStyle={styles.list}
      />
    </Screen>
  );
}

function Row({ row }: { row: BoardRow }) {
  return (
    <View style={[styles.row, row.out && styles.rowOut]}>
      <Text style={styles.pos}>{row.position}</Text>
      <Text style={styles.car}>{row.carNumber}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {row.driverName}
      </Text>
      <View style={styles.rowRight}>
        <Text style={[styles.gap, row.out && styles.gapOut]}>{row.gap}</Text>
        <Text style={styles.sub}>
          {row.lastLap}
          {row.lapsLed ? `  LL ${row.lapsLed}` : ""}
          {row.pits ? `  P${row.pits}` : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idleHeadline: { color: colors.text, fontSize: 15, fontWeight: "600" },
  idleDetail: { color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 18 },
  header: { padding: 14, paddingBottom: 8, gap: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  flag: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  lapLine: { color: colors.muted, fontSize: 13 },
  stageLine: { color: colors.muted, fontSize: 12 },
  stale: { color: colors.neg, fontSize: 12 },
  list: { paddingHorizontal: 14, paddingBottom: 48 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowOut: { opacity: 0.45 },
  pos: { color: colors.muted, width: 24, fontSize: 14, fontVariant: ["tabular-nums"] },
  car: { color: colors.accent, width: 38, fontSize: 13, fontWeight: "700" },
  name: { color: colors.text, flex: 1, fontSize: 14 },
  rowRight: { alignItems: "flex-end" },
  gap: { color: colors.text, fontSize: 13, fontVariant: ["tabular-nums"] },
  gapOut: { color: colors.neg },
  sub: { color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] },
});
