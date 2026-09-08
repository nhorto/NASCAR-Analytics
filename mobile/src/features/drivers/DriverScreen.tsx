// One driver: identity, latest-season stat grid, recent races.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { serverBase } from "../../lib/config.ts";
import { Card, ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchDriverProfile, type DriverProfile } from "./api.ts";
import { profileModel, seasonStatLines } from "./model.ts";

export function DriverScreen({ driverId }: { driverId: number }) {
  const [profile, setProfile] = useState<DriverProfile | null | undefined>(undefined);

  const load = useCallback(async () => {
    setProfile(await fetchDriverProfile(await serverBase(), driverId));
  }, [driverId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (profile === undefined) return <Loading />;
  if (profile === null)
    return (
      <Screen>
        <ErrorNote message="Driver unavailable." onRetry={() => void load()} />
      </Screen>
    );

  const model = profileModel(profile);
  return (
    <Screen>
      <View>
        <Text style={styles.name}>{model.name}</Text>
        <Text style={styles.subtitle}>{model.subtitle}</Text>
      </View>
      {model.latestSeason ? (
        <Card title={`${model.latestSeason.season} season`}>
          <View style={styles.grid}>
            {seasonStatLines(model.latestSeason).map((stat) => (
              <View key={stat.label} style={styles.cell}>
                <Text style={styles.cellValue}>{stat.value}</Text>
                <Text style={styles.cellLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Card title="Recent races">
        {model.recentRaces.length === 0 ? (
          <Text style={styles.empty}>No race log yet.</Text>
        ) : (
          model.recentRaces.map((race) => (
            <View key={race.key} style={styles.raceRow}>
              <Text style={styles.raceLine} numberOfLines={1}>
                {race.line}
              </Text>
              <Text style={styles.raceFinish}>{race.finish}</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "20%", minWidth: 64, paddingVertical: 6 },
  cellValue: { color: colors.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  cellLabel: { color: colors.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  raceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  raceLine: { color: colors.text, fontSize: 13, flex: 1 },
  raceFinish: { color: colors.accent, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  empty: { color: colors.muted, fontSize: 13 },
});
