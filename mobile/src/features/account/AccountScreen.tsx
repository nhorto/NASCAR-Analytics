// Account tab: plan + session actions when signed in, entry points when not.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { signOut, signOutEverywhere } from "../../lib/auth.ts";
import { serverBase } from "../../lib/config.ts";
import { fmtProUntil } from "../../lib/dates.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card, Loading, ProBadge, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

export function AccountScreen() {
  const { viewer, refresh } = useViewer();
  const [busy, setBusy] = useState(false);

  async function runSignOut(everywhere: boolean) {
    setBusy(true);
    const base = await serverBase();
    await (everywhere ? signOutEverywhere(base) : signOut(base));
    await refresh();
    setBusy(false);
  }

  if (viewer.status === "loading") return <Loading />;

  return (
    <Screen>
      {viewer.status === "signed_in" ? (
        <>
          <Card title="Account">
            <Text style={styles.email}>{viewer.me.email}</Text>
            <View style={styles.planRow}>
              {viewer.me.pro ? <ProBadge /> : <Text style={styles.freeChip}>FREE</Text>}
              {viewer.me.pro && viewer.me.proUntil ? (
                <Text style={styles.planDetail}>
                  until {fmtProUntil(viewer.me.proUntil)} ({viewer.me.proSource})
                </Text>
              ) : null}
            </View>
            {viewer.me.verifiedAt === null ? (
              <Text style={styles.warn}>
                Email not verified — check your inbox. Verification is required before upgrading.
              </Text>
            ) : null}
          </Card>
          <Card title="Session">
            <View style={styles.actions}>
              <Button label="Sign out" tone="quiet" disabled={busy} onPress={() => void runSignOut(false)} />
              <Button
                label="Sign out everywhere"
                tone="quiet"
                disabled={busy}
                onPress={() => void runSignOut(true)}
              />
            </View>
            <Text style={styles.note}>
              Subscription management and account deletion live on the web account page for now.
            </Text>
          </Card>
        </>
      ) : (
        <Card title="Account">
          {viewer.status === "offline" ? (
            <Text style={styles.warn}>Server unreachable — check Settings below.</Text>
          ) : (
            <Text style={styles.note}>
              Sign in to sync your plan, or create a free account.
            </Text>
          )}
          <View style={styles.actions}>
            <Button label="Sign in" onPress={() => router.push("/signin")} />
            <Button label="Create account" tone="quiet" onPress={() => router.push("/signup")} />
          </View>
        </Card>
      )}
      <Card title="Settings">
        <Button label="Server & about" tone="quiet" onPress={() => router.push("/settings")} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  email: { color: colors.text, fontSize: 15, fontWeight: "600" },
  planRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  freeChip: {
    color: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  planDetail: { color: colors.muted, fontSize: 12 },
  warn: { color: colors.accent, fontSize: 13, marginTop: 8, lineHeight: 18 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  actions: { gap: 8, marginTop: 10 },
});
