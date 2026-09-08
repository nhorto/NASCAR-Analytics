// The one locked/upsell treatment, shared by the Pro hub and every Pro
// screen, so a free viewer meets the same card wherever they land.
//
// Two things this deliberately does NOT do:
//   - It never links out to the web checkout. Apple guideline 3.1.1 forbids
//     it, and the WS-J plan names that as out of scope. Until the RevenueCat
//     adapter replaces the stub in lib/purchases.ts (owner steps J1/J2) the
//     button states its own unavailability instead of lying about it.
//   - It never decides entitlement. `pro` comes from usePro() ← GET /api/me,
//     so a web/Stripe purchase or an owner grant unlocks these screens with no
//     app update (D21).
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { purchasesClient } from "../../lib/purchases.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

export function ProLock({
  title,
  pitch,
  detail,
}: {
  title: string;
  pitch: string;
  detail?: string;
}) {
  const { viewer } = useViewer();
  const purchases = purchasesClient();
  const signedIn = viewer.status === "signed_in";

  return (
    <Card title={title}>
      <View style={styles.lockRow}>
        <Text style={styles.lockGlyph}>🔒</Text>
        <Text style={styles.pitch}>{pitch}</Text>
      </View>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <View style={styles.cta}>
        <Button
          label={purchases.available ? "Start free trial" : "Purchases coming to the app"}
          onPress={() => {}}
          disabled={!purchases.available}
        />
      </View>
      <Text style={styles.note}>
        {signedIn
          ? "Already Pro on another device? Pro from any purchase unlocks here automatically."
          : "Already Pro? Sign in and everything unlocks here too."}
      </Text>
      {!signedIn ? (
        <View style={styles.cta}>
          <Button label="Sign in" tone="quiet" onPress={() => router.push("/signin")} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  lockRow: { flexDirection: "row", gap: 8 },
  lockGlyph: { fontSize: 14, lineHeight: 20 },
  pitch: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  cta: { marginTop: 12 },
  note: { color: colors.muted, fontSize: 12, marginTop: 10, lineHeight: 17 },
});
