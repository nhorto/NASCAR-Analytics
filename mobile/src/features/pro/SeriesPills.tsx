// Cup / Xfinity / Trucks selector shown on Stats, Drivers and Live (2026-09-09
// UX realignment). Cup is always selectable; Xfinity/Trucks carry a lock for
// free viewers and a locked tap opens the shared upsell sheet instead of
// switching to a series the server would 403. A Pro viewer selects any series
// and the screens re-fetch with ?series=N.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SERIES, seriesRequiresPro, useSeries, type SeriesId } from "../../lib/series.tsx";
import { usePro } from "../../lib/viewer.tsx";
import { useUpsell } from "./UpsellSheet.tsx";
import { colors } from "../../ui/theme.ts";

export function SeriesPills() {
  const { series, setSeries } = useSeries();
  const pro = usePro();
  const upsell = useUpsell();

  const onPress = (id: SeriesId) => {
    if (seriesRequiresPro(id) && !pro) {
      upsell(`${SERIES.find((s) => s.id === id)?.label} is a Pro series.`);
      return;
    }
    setSeries(id);
  };

  return (
    <View style={styles.row}>
      {SERIES.map((s) => {
        const on = s.id === series;
        const locked = seriesRequiresPro(s.id) && !pro;
        return (
          <Pressable
            key={s.id}
            onPress={() => onPress(s.id)}
            style={[styles.pill, on && styles.pillOn]}
            accessibilityRole="button"
            accessibilityLabel={locked ? `${s.label}, Pro only` : s.label}
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.text, on && styles.textOn]} numberOfLines={1}>
              {s.short}
              {locked ? " 🔒" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 7 },
  pill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { color: colors.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  textOn: { color: "#0a0c10", fontWeight: "700" },
});
