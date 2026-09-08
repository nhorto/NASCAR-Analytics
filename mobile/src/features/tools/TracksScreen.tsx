// Track-type explorer: who is actually good on this kind of track, over a
// season range you choose. Cup is free (WS-G shipped the range control to
// everyone on the web); Xfinity and Trucks are Pro, and the server refuses
// those reads for a free viewer, so the locked state here is the same 403 the
// web teaser is built on.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { usePro } from "../../lib/viewer.tsx";
import { Card, ErrorNote, Loading, Screen, Segmented, Stepper } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchLatestSeason } from "../stats/api.ts";
import { ProLock } from "../pro/ProLock.tsx";
import { fetchTrackBoard, TRACK_TYPES, type TrackResult, type TrackType } from "./api.ts";
import {
  coerceRange,
  sortTrackLeaders,
  trackMetricText,
  TRACK_SORTS,
  type TrackSortKey,
} from "./model.ts";

const SERIES_OPTIONS = [
  { value: "1", label: "Cup" },
  { value: "2", label: "Xfinity" },
  { value: "3", label: "Trucks" },
] as const;

const MIN_STARTS = [3, 5, 8, 10];
const RANGE_YEARS = 20;
/** The web explorer's default window: the last eight seasons. */
const DEFAULT_WINDOW = 7;

export function TracksScreen() {
  const pro = usePro();
  const [latestSeason, setLatestSeason] = useState<number | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [seriesId, setSeriesId] = useState("1");
  const [trackType, setTrackType] = useState<TrackType>("road");
  const [minStarts, setMinStarts] = useState(5);
  const [sort, setSort] = useState<TrackSortKey>("avgFinish");
  const [result, setResult] = useState<TrackResult | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const season = await fetchLatestSeason(await serverBase());
      setLatestSeason(season);
      if (season !== null) setRange({ from: season - DEFAULT_WINDOW, to: season });
    })();
  }, []);

  const load = useCallback(async () => {
    if (!range) return;
    setResult(
      await fetchTrackBoard(await serverBase(), {
        seriesId: Number(seriesId),
        trackType,
        from: range.from,
        to: range.to,
        min: minStarts,
      }),
    );
  }, [range, seriesId, trackType, minStarts]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (latestSeason === null || range === null) return <Loading />;

  const minIndex = MIN_STARTS.indexOf(minStarts);

  return (
    <Screen>
      <Card title="Track type">
        <Segmented
          options={TRACK_TYPES.map((type) => ({ value: type.value, label: type.label }))}
          value={trackType}
          onChange={setTrackType}
        />
        <View style={styles.gap} />
        <Segmented
          options={SERIES_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            locked: !pro && option.value !== "1",
          }))}
          value={seriesId}
          onChange={setSeriesId}
        />
      </Card>

      <Card title="Window" right={`${range.from}–${range.to}`}>
        <Stepper
          label="From"
          value={range.from}
          min={latestSeason - RANGE_YEARS}
          max={latestSeason}
          onChange={(from) => setRange((r) => coerceRange({ from, to: r!.to }, "from"))}
        />
        <View style={styles.gap} />
        <Stepper
          label="To"
          value={range.to}
          min={latestSeason - RANGE_YEARS}
          max={latestSeason}
          onChange={(to) => setRange((r) => coerceRange({ from: r!.from, to }, "to"))}
        />
        <View style={styles.gap} />
        <Stepper
          label="Min starts"
          value={minIndex < 0 ? 5 : MIN_STARTS[minIndex]!}
          min={MIN_STARTS[0]!}
          max={MIN_STARTS[MIN_STARTS.length - 1]!}
          onChange={(next) => {
            // The stepper walks by one; snap to the nearest allowed option so
            // a tap always moves the board.
            const direction = next > minStarts ? 1 : -1;
            const index = Math.min(
              MIN_STARTS.length - 1,
              Math.max(0, (minIndex < 0 ? 1 : minIndex) + direction),
            );
            setMinStarts(MIN_STARTS[index]!);
          }}
        />
      </Card>

      <Card title="Sort">
        <Segmented options={TRACK_SORTS} value={sort} onChange={setSort} />
      </Card>

      {result === undefined ? (
        <Loading label="Loading leaders…" />
      ) : result.status === "locked" ? (
        <ProLock
          title="Other series — Pro"
          pitch="Xfinity and Trucks track-type boards, with the same loop-data metrics."
          detail="Cup stays free, including the full season range."
        />
      ) : result.status === "error" ? (
        <ErrorNote message="Could not reach the server." onRetry={() => void load()} />
      ) : result.board.leaders.length === 0 ? (
        <Card title="No data">
          <Text style={styles.note}>No drivers meet these filters for this track type.</Text>
        </Card>
      ) : (
        <Card
          title={TRACK_TYPES.find((t) => t.value === trackType)?.label ?? trackType}
          right={`${range.from}–${range.to}`}
        >
          <View style={[styles.row, styles.headerRow]}>
            <Text style={styles.rank} />
            <Text style={[styles.name, styles.headerText]}>Driver</Text>
            <Text style={[styles.cell, styles.headerText]}>St</Text>
            <Text style={[styles.cell, styles.headerText]}>W</Text>
            <Text style={[styles.cell, styles.headerText]}>
              {TRACK_SORTS.find((s) => s.value === sort)?.label}
            </Text>
          </View>
          {sortTrackLeaders(result.board.leaders, sort)
            .slice(0, 25)
            .map((row, index) => (
              <View key={row.driverId} style={styles.row}>
                <Text style={styles.rank}>{index + 1}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {row.fullName}
                </Text>
                <Text style={styles.cell}>{row.starts}</Text>
                <Text style={[styles.cell, row.wins > 0 && styles.wins]}>{row.wins}</Text>
                <Text style={[styles.cell, styles.strong]}>{trackMetricText(row, sort)}</Text>
              </View>
            ))}
          <Text style={styles.note}>
            Every column comes from official loop data nobody else surfaces by track type. Adj Pass
            Efficiency: green-flag passing vs the average car at the same running position. Closer:
            closing-lap position change vs expectation.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: 10 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: { borderBottomColor: colors.muted },
  headerText: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  rank: { color: colors.muted, width: 20, fontSize: 12, fontVariant: ["tabular-nums"] },
  name: { color: colors.text, flex: 1, minWidth: 0, fontSize: 13 },
  cell: {
    color: colors.text,
    width: 46,
    fontSize: 12,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  strong: { fontWeight: "700" },
  wins: { color: colors.pos, fontWeight: "700" },
});
