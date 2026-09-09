// The one Pro upsell surface (2026-09-09 UX realignment). It replaces the old
// "Pro" tab + ProScreen hub: Pro is no longer a place, it is a sheet that any
// locked tap opens. Mounted once at the root; opened from anywhere via the
// useUpsell() hook. Honest about the purchase stub (Apple 3.1.1) until the
// RevenueCat adapter replaces lib/purchases.ts (owner steps J1/J2), and it
// never decides entitlement — a signed-in Pro viewer never sees it because
// nothing locked is shown to them.
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { purchasesClient } from "../../lib/purchases.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

const BENEFITS = [
  "The full prediction board — every driver, not just the top three",
  "DraftKings & FanDuel projections with a lineup scratchpad",
  "Xfinity & Trucks — every stat, board and recap",
  "Compare up to four drivers across series and seasons",
  "Driver alerts on race day",
];

const UpsellContext = createContext<(reason?: string) => void>(() => {});

export function UpsellProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const show = useCallback((why?: string) => {
    setReason(why);
    setOpen(true);
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <UpsellContext.Provider value={value}>
      {children}
      <UpsellSheet open={open} reason={reason} onClose={() => setOpen(false)} />
    </UpsellContext.Provider>
  );
}

/** Open the shared upsell sheet. Pass a one-line reason ("Xfinity is a Pro series"). */
export function useUpsell(): (reason?: string) => void {
  return useContext(UpsellContext);
}

function UpsellSheet({
  open,
  reason,
  onClose,
}: {
  open: boolean;
  reason?: string;
  onClose: () => void;
}) {
  const { viewer } = useViewer();
  const purchases = purchasesClient();
  const signedIn = viewer.status === "signed_in";

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={styles.sheet}>
        <View style={styles.grab} />
        <Text style={styles.title}>
          Loop<Text style={styles.titleAccent}>lab</Text> Pro
        </Text>
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        <View style={styles.list}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefit}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>
        <Button
          label={purchases.available ? "Start free trial" : "Purchases coming to the app"}
          onPress={() => {}}
          disabled={!purchases.available}
        />
        {!signedIn ? (
          <View style={styles.signin}>
            <Button
              label="Already Pro? Sign in"
              tone="quiet"
              onPress={() => {
                onClose();
                router.push("/signin");
              }}
            />
          </View>
        ) : null}
        <Text style={styles.fine}>
          {signedIn
            ? "Entitlement is read from your account — Pro from any purchase unlocks everywhere."
            : "Pro from any purchase — web or app — unlocks on every device you sign in on."}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: "rgba(4,5,8,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 18,
    paddingBottom: 32,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: 1, color: colors.text, textTransform: "uppercase" },
  titleAccent: { color: colors.accent },
  reason: { color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 18 },
  list: { marginTop: 14, marginBottom: 16, gap: 9 },
  benefit: { flexDirection: "row", gap: 9 },
  check: { color: colors.pos, fontWeight: "800", fontSize: 13 },
  benefitText: { color: colors.text, fontSize: 13.5, flex: 1, lineHeight: 19 },
  signin: { marginTop: 9 },
  fine: { color: colors.muted, fontSize: 11.5, marginTop: 12, lineHeight: 16, textAlign: "center" },
});
