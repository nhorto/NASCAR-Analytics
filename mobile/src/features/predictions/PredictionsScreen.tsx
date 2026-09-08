// Race predictions. Both entitlement states render real content: a free
// viewer gets the top three drivers the server chose to send plus the lock,
// a Pro viewer gets the whole field and (after the race) the actual finishes.
// Tapping a row expands the expected laps-led / fast-laps line the DFS
// projections are built from.
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Card, ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { ProLock } from "../pro/ProLock.tsx";
import { fetchPredictions, type PredictionsData } from "./api.ts";
import {
  displayRows,
  expectationLine,
  isEmpty,
  provenance,
  title,
  withheldLabel,
} from "./model.ts";

export function PredictionsScreen() {
  const { viewer } = useViewer();
  const [data, setData] = useState<PredictionsData | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await fetchPredictions(await serverBase()));
  }, []);

  // Re-read on focus so a sign-in or a purchase elsewhere in the app widens
  // the table without a restart; `viewer.status` is in the dep list for the
  // same reason.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, viewer.status]),
  );

  if (data === undefined) return <Loading label="Loading predictions…" />;
  if (data === null)
    return (
      <Screen>
        <ErrorNote message="Could not reach the server." onRetry={() => void load()} />
      </Screen>
    );

  if (isEmpty(data))
    return (
      <Screen>
        <Card title="Predictions">
          <Text style={styles.note}>
            No prediction run is stored yet — the model publishes Thursday (form) and Saturday
            (after qualifying) each race week.
          </Text>
          <Pressable onPress={() => router.push("/methodology")}>
            <Text style={styles.link}>How the model works →</Text>
          </Pressable>
        </Card>
      </Screen>
    );

  const rows = displayRows(data);
  const withheld = withheldLabel(data);
  const showActual = data.race?.hasResults === true;

  return (
    <Screen>
      <Card title={title(data)} right={data.race ? String(data.race.season) : undefined}>
        <Text style={styles.note}>{provenance(data)}</Text>
        <Pressable onPress={() => router.push("/methodology")}>
          <Text style={styles.link}>How this works →</Text>
        </Pressable>

        <View style={[styles.row, styles.headerRow]}>
          <Text style={styles.rank} />
          <Text style={[styles.name, styles.headerText]}>Driver</Text>
          <Text style={[styles.cell, styles.headerText]}>Win</Text>
          <Text style={[styles.cell, styles.headerText]}>T5</Text>
          <Text style={[styles.cell, styles.headerText]}>T10</Text>
          <Text style={[styles.cell, styles.headerText]}>Exp</Text>
          {showActual ? <Text style={[styles.cell, styles.headerText]}>Fin</Text> : null}
        </View>

        {rows.map((row, index) => (
          <View key={row.key}>
            <Pressable
              onPress={() => setExpanded(expanded === row.key ? null : row.key)}
              style={styles.row}
            >
              <Text style={styles.rank}>{row.rank}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={[styles.cell, styles.strong]}>{row.win}</Text>
              <Text style={styles.cell}>{row.top5}</Text>
              <Text style={styles.cell}>{row.top10}</Text>
              <Text style={styles.cell}>{row.exp}</Text>
              {showActual ? (
                <Text style={[styles.cell, row.beat && styles.beat]}>{row.actual || "—"}</Text>
              ) : null}
            </Pressable>
            {expanded === row.key ? (
              <Text style={styles.expanded}>{expectationLine(data.rows[index]!)}</Text>
            ) : null}
          </View>
        ))}
      </Card>

      {withheld ? (
        <ProLock
          title="Race predictions"
          pitch={withheld}
          detail="Win, top-5 and top-10 probabilities for the whole field, refreshed after qualifying, with predicted-vs-actual once the race is scored."
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  link: { color: colors.accent, fontSize: 12, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 7,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: { marginTop: 12, borderBottomColor: colors.muted },
  headerText: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  rank: { color: colors.muted, width: 18, fontSize: 12, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, minWidth: 0, fontSize: 13 },
  cell: {
    color: colors.text,
    width: 40,
    fontSize: 12,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  strong: { fontWeight: "700" },
  beat: { color: colors.pos, fontWeight: "700" },
  expanded: { color: colors.muted, fontSize: 12, paddingBottom: 8, paddingLeft: 22 },
});
