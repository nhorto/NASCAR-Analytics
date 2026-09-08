// The Pro hub. Gating reads server entitlement only (usePro ← /api/me):
// locked cards for free viewers, "active, content lands next" for Pro — the
// deep Pro screens (predictions, DFS, tools) are later WS-J stages. The
// paywall is honest about the purchase path: RevenueCat IAP is stubbed until
// owner steps J1/J2, and a web/Stripe purchase already unlocks here because
// entitlement is server-side (D21).
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { purchasesClient } from "../../lib/purchases.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card, ProBadge, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

const FEATURES = [
  { key: "predictions", title: "Race predictions", detail: "Win / top-5 / top-10 probabilities every Thursday, refreshed after qualifying." },
  { key: "dfs", title: "DFS projections", detail: "DraftKings and FanDuel projected points with the printable cheat sheet." },
  { key: "series", title: "Xfinity + Trucks", detail: "Every stat, board, and recap for all three national series." },
  { key: "tools", title: "Deep tools", detail: "CSV exports, full-history filters, compare up to four drivers." },
  { key: "push", title: "Driver alerts", detail: "Pit, caution, stage, and finish alerts for your driver." },
] as const;

export function ProScreen() {
  const { viewer } = useViewer();
  const pro = viewer.status === "signed_in" && viewer.me.pro;
  const purchases = purchasesClient();

  return (
    <Screen>
      {!pro ? (
        <Card title="LoopLab Pro">
          <Text style={styles.pitch}>
            All three series, predictions, DFS projections, deep tools, and driver alerts.
          </Text>
          <View style={styles.ctaRow}>
            <Button
              label={purchases.available ? "Start free trial" : "Purchases coming to the app"}
              onPress={() => {}}
              disabled={!purchases.available}
            />
          </View>
          <Text style={styles.note}>
            {viewer.status === "signed_in"
              ? "Already Pro on the web? This account isn't — Pro from any purchase unlocks here automatically."
              : "Already Pro on the web? Sign in and everything unlocks here too."}
          </Text>
          {viewer.status !== "signed_in" ? (
            <View style={styles.ctaRow}>
              <Button label="Sign in" tone="quiet" onPress={() => router.push("/signin")} />
            </View>
          ) : null}
        </Card>
      ) : (
        <Card title="Pro is active">
          <Text style={styles.pitch}>
            Your Pro features are unlocked. The mobile versions of these screens are rolling out —
            everything below is live on the web today.
          </Text>
        </Card>
      )}
      {FEATURES.map((feature) => (
        <Card key={feature.key}>
          <View style={styles.featureHeader}>
            <Text style={styles.featureTitle}>{feature.title}</Text>
            {pro ? <ProBadge /> : <Text style={styles.lock}>🔒</Text>}
          </View>
          <Text style={styles.featureDetail}>{feature.detail}</Text>
          {pro ? <Text style={styles.soon}>Coming to mobile — available on the web now.</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pitch: { color: colors.text, fontSize: 14, lineHeight: 20 },
  ctaRow: { marginTop: 12 },
  note: { color: colors.muted, fontSize: 12, marginTop: 10, lineHeight: 17 },
  featureHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  featureTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  lock: { fontSize: 14 },
  featureDetail: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  soon: { color: colors.accent, fontSize: 12, marginTop: 8 },
});
