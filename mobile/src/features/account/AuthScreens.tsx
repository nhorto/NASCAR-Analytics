// Sign-in and sign-up against the existing server auth API. Failure copy
// comes from the server's own form errors where available (password rules,
// breached-password refusals) so the two surfaces never disagree about why.
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { requestReset, signIn, signUp, type AuthResult } from "../../lib/auth.ts";
import { serverBase } from "../../lib/config.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

function failureCopy(result: AuthResult & { ok: false }): string {
  if (result.detail) return result.detail;
  switch (result.reason) {
    case "invalid_credentials":
      return "Invalid email or password.";
    case "rate_limited":
      return "Too many attempts — try again later.";
    case "csrf":
      return "Security token mismatch — please try again.";
    case "network":
      return "Could not reach the server.";
    default:
      return "Check your email and password.";
  }
}

function AuthForm({
  mode,
}: {
  mode: "signin" | "signup";
}) {
  const { refresh } = useViewer();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const base = await serverBase();
    const result = await (mode === "signin" ? signIn : signUp)(base, email.trim(), password);
    if (result.ok) {
      await refresh();
      router.back();
    } else {
      setError(failureCopy(result));
    }
    setBusy(false);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    const result = await requestReset(await serverBase(), email.trim());
    setInfo(result.ok || result.reason === "rejected"
      ? "If that email has an account, a reset link is on its way."
      : failureCopy(result as AuthResult & { ok: false }));
    setBusy(false);
  }

  return (
    <Screen>
      <Card title={mode === "signin" ? "Sign in" : "Create account"}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder={mode === "signup" ? "Password (10+ characters)" : "Password"}
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}
        <View style={styles.actions}>
          <Button
            label={mode === "signin" ? "Sign in" : "Create account"}
            disabled={busy || email.trim() === "" || password === ""}
            onPress={() => void submit()}
          />
          {mode === "signin" ? (
            <Button label="Forgot password" tone="quiet" disabled={busy || email.trim() === ""} onPress={() => void reset()} />
          ) : null}
        </View>
        {mode === "signup" ? (
          <Text style={styles.note}>
            You'll get a verification email. Free accounts cover every Cup stat and the live board.
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

export function SignInScreen() {
  return <AuthForm mode="signin" />;
}

export function SignUpScreen() {
  return <AuthForm mode="signup" />;
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  error: { color: colors.neg, fontSize: 13, marginBottom: 8 },
  info: { color: colors.pos, fontSize: 13, marginBottom: 8 },
  actions: { gap: 8 },
  note: { color: colors.muted, fontSize: 12, marginTop: 10, lineHeight: 17 },
});
