// Head-to-head compare. The free/Pro line is exactly the web's (WS-G): free
// gets two drivers, one season, Cup only; Pro gets four slots, a season
// range, and drivers from any series. The extra slots and the other series
// render visibly locked rather than missing, so a free viewer can see what
// Pro buys without any Pro data reaching the device — the series JSON gate
// refuses those reads server-side anyway.
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { serverBase } from "../../lib/config.ts";
import { usePro } from "../../lib/viewer.tsx";
import { Button, Card, Loading, Screen, Segmented, Stepper } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchDrivers, fetchDriverSeasons, type DriverSummary, type SeasonStatsRow } from "../drivers/api.ts";
import { fetchLatestSeason } from "../stats/api.ts";
import { ProLock } from "../pro/ProLock.tsx";
import { aggregateSeasons, coerceRange, compareTable, type ComparePick } from "./model.ts";

const SERIES_OPTIONS = [
  { value: "1", label: "Cup" },
  { value: "2", label: "Xfinity" },
  { value: "3", label: "Trucks" },
] as const;

const SERIES_NAMES: Record<string, string> = { "1": "Cup", "2": "Xfinity", "3": "Trucks" };

/** How far back the season steppers reach — the dataset predates it, but a
 *  stepper is not the control for a 70-year walk. */
const RANGE_YEARS = 20;

interface Slot {
  seriesId: number;
  driver: DriverSummary;
  seasons: SeasonStatsRow[];
}

export function CompareScreen() {
  const pro = usePro();
  const slotCount = pro ? 4 : 2;
  const [latestSeason, setLatestSeason] = useState<number | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [slots, setSlots] = useState<Array<Slot | null>>([null, null, null, null]);
  const [picking, setPicking] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const season = await fetchLatestSeason(await serverBase());
      setLatestSeason(season);
      if (season !== null) setRange({ from: season, to: season });
    })();
  }, []);

  const setSlot = useCallback((index: number, slot: Slot | null) => {
    setSlots((current) => current.map((existing, i) => (i === index ? slot : existing)));
  }, []);

  if (latestSeason === null || range === null) return <Loading />;

  if (picking !== null)
    return (
      <DriverPicker
        pro={pro}
        onCancel={() => setPicking(null)}
        onPick={async (seriesId, driver) => {
          const base = await serverBase();
          const seasons = (await fetchDriverSeasons(base, driver.driverId, seriesId)) ?? [];
          setSlot(picking, { seriesId, driver, seasons });
          setPicking(null);
        }}
      />
    );

  // Losing Pro mid-session must actually take the Pro view away: drop the
  // extra slots, drop any non-Cup driver already picked, and collapse the
  // season range back to one year. Nothing here is a data leak (a free viewer
  // is entitled to every Cup season it aggregates), but a downgraded account
  // showing a Pro-shaped comparison until the next tap is a lie about state.
  const active = slots.slice(0, slotCount).map((slot) => (pro || slot?.seriesId === 1 ? slot : null));
  const view = pro ? range : { from: range.to, to: range.to };

  const picks: ComparePick[] = active.flatMap((slot, index) => {
    if (!slot) return [];
    const stats = aggregateSeasons(slot.seasons, view.from, view.to);
    return stats ? [{ key: `${index}`, name: slot.driver.fullName, stats }] : [];
  });
  const table = picks.length > 0 ? compareTable(picks) : [];
  const rangeLabel = view.from === view.to ? String(view.from) : `${view.from}–${view.to}`;

  return (
    <Screen>
      <Card title="Drivers" right={`${picks.length}/${slotCount}`}>
        {active.map((slot, index) => (
          <View key={index} style={styles.slotRow}>
            <Pressable style={styles.slot} onPress={() => setPicking(index)}>
              <Text style={slot ? styles.slotName : styles.slotEmpty} numberOfLines={1}>
                {slot
                  ? `${slot.driver.fullName}${slot.seriesId === 1 ? "" : ` (${SERIES_NAMES[String(slot.seriesId)]})`}`
                  : `Driver ${String.fromCharCode(65 + index)}…`}
              </Text>
            </Pressable>
            {slot ? (
              <Pressable onPress={() => setSlot(index, null)} style={styles.clearSlot}>
                <Text style={styles.clearGlyph}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!pro ? (
          <View style={styles.lockedSlots}>
            <Text style={styles.lockedText}>🔒 Two more slots, season ranges, and Xfinity/Trucks drivers with Pro</Text>
          </View>
        ) : null}
      </Card>

      <Card title="Seasons" right={rangeLabel}>
        {pro ? (
          <>
            <Stepper
              label="From"
              value={range.from}
              min={latestSeason - RANGE_YEARS}
              max={latestSeason}
              onChange={(from) => setRange((r) => coerceRange({ from, to: r!.to }, "from"))}
            />
            <View style={styles.spacer} />
            <Stepper
              label="To"
              value={range.to}
              min={latestSeason - RANGE_YEARS}
              max={latestSeason}
              onChange={(to) => setRange((r) => coerceRange({ from: r!.from, to }, "to"))}
            />
          </>
        ) : (
          <Stepper
            label="Season"
            value={view.to}
            min={latestSeason - RANGE_YEARS}
            max={latestSeason}
            onChange={(season) => setRange({ from: season, to: season })}
          />
        )}
      </Card>

      {picks.length === 0 ? (
        <Card title="Head-to-head">
          <Text style={styles.note}>
            Pick {slotCount === 2 ? "two drivers" : "up to four drivers"} and a season to compare
            raw pace, loop data, and the proprietary metrics side by side.
          </Text>
        </Card>
      ) : (
        <Card title="Head-to-head" right={rangeLabel}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.metric, styles.headerText]}>Metric</Text>
            {picks.map((pick) => (
              <Text key={pick.key} style={[styles.value, styles.headerText]} numberOfLines={1}>
                {pick.name.split(" ").at(-1)}
              </Text>
            ))}
          </View>
          {table.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.metric}>{row.label}</Text>
              {row.cells.map((cell, index) => (
                <Text key={index} style={[styles.value, cell.best && styles.best]}>
                  {cell.text}
                </Text>
              ))}
            </View>
          ))}
          <Text style={styles.note}>
            Adj Pass Efficiency is green-flag passing against the average car at the same running
            position; Closer is closing-lap position change against expectation. Both weight by the
            races that actually had loop data.
          </Text>
        </Card>
      )}

      {!pro ? (
        <ProLock
          title="Deep tools"
          pitch="Compare up to four drivers, across series and across a season range."
          detail="Free compare stays at two Cup drivers in one season."
        />
      ) : null}
    </Screen>
  );
}

function DriverPicker({
  pro,
  onPick,
  onCancel,
}: {
  pro: boolean;
  onPick: (seriesId: number, driver: DriverSummary) => void;
  onCancel: () => void;
}) {
  const [seriesId, setSeriesId] = useState("1");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriverSummary[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setResults(undefined);
      const found = await fetchDrivers(await serverBase(), query, Number(seriesId));
      if (!cancelled) setResults(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, seriesId]);

  return (
    <Screen>
      <Card title="Pick a driver">
        <Segmented
          options={SERIES_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            locked: !pro && option.value !== "1",
          }))}
          value={seriesId}
          onChange={setSeriesId}
        />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Search drivers…"
          placeholderTextColor={colors.muted}
        />
        <Button label="Cancel" tone="quiet" onPress={onCancel} />
      </Card>
      <Card title="Results">
        {results === undefined ? (
          <Text style={styles.note}>Searching…</Text>
        ) : results === null ? (
          <Text style={styles.note}>Could not load drivers for this series.</Text>
        ) : results.length === 0 ? (
          <Text style={styles.note}>No drivers match “{query}”.</Text>
        ) : (
          results.slice(0, 40).map((driver) => (
            <Pressable
              key={driver.driverId}
              style={styles.resultRow}
              onPress={() => onPick(Number(seriesId), driver)}
            >
              <Text style={styles.slotName} numberOfLines={1}>
                {driver.fullName}
              </Text>
              <Text style={styles.resultDetail}>
                {driver.firstSeason}–{driver.lastSeason}
              </Text>
            </Pressable>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  slotRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  slot: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  slotName: { color: colors.text, fontSize: 14 },
  slotEmpty: { color: colors.muted, fontSize: 14 },
  clearSlot: { padding: 6 },
  clearGlyph: { color: colors.muted, fontSize: 14 },
  lockedSlots: { marginTop: 2 },
  lockedText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  spacer: { height: 10 },
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
  metric: { color: colors.text, flex: 1, minWidth: 0, fontSize: 13 },
  value: {
    color: colors.text,
    width: 58,
    fontSize: 13,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  best: { color: colors.accent, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 10,
    fontSize: 15,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 9,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultDetail: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
});
