// The Picks tab (2026-09-09 UX realignment): predictions and DFS were two
// buried entries under the old "Pro" tab; here they are one race-weekend
// surface with a Predictions ⇄ DFS switch. Both sub-screens already render
// their own free/Pro states (top-3 + ProLock for predictions, ProLock body
// for DFS), so this only chooses which one shows. The standalone /predictions
// and /dfs routes stay registered so deep links (e.g. from methodology) resolve.
import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Segmented } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { PredictionsScreen } from "../predictions/PredictionsScreen.tsx";
import { DfsScreen } from "../dfs/DfsScreen.tsx";

type Pane = "predictions" | "dfs";

export function PicksScreen() {
  const [pane, setPane] = useState<Pane>("predictions");
  return (
    <View style={styles.wrap}>
      <View style={styles.switch}>
        <Segmented<Pane>
          options={[
            { value: "predictions", label: "Predictions" },
            { value: "dfs", label: "DFS" },
          ]}
          value={pane}
          onChange={setPane}
        />
      </View>
      {pane === "predictions" ? <PredictionsScreen /> : <DfsScreen />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  switch: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
});
