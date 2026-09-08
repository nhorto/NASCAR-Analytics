// Settings: which server the app talks to (there is no product domain until
// D2), plus about text. Deliberately small.
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { DEFAULT_SERVER_BASE, serverBase, setServerBase } from "../../lib/config.ts";
import { useViewer } from "../../lib/viewer.tsx";
import { Button, Card, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";

export function SettingsScreen() {
  const { refresh } = useViewer();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void serverBase().then(setValue);
  }, []);

  async function save() {
    const ok = await setServerBase(value);
    setSaved(ok ? "Saved." : "Not a valid http(s) URL.");
    if (ok) await refresh();
  }

  return (
    <Screen>
      <Card title="Server">
        <Text style={styles.note}>
          The server this app reads stats and your account from. Default: {DEFAULT_SERVER_BASE}
        </Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={DEFAULT_SERVER_BASE}
          placeholderTextColor={colors.muted}
        />
        {saved ? <Text style={styles.saved}>{saved}</Text> : null}
        <Button label="Save" onPress={() => void save()} />
      </Card>
      <Card title="About">
        <Text style={styles.note}>
          LoopLab (working name) — NASCAR loop-data analytics. Free: every Cup stat and the live
          race board. Pro: all three series, predictions, DFS projections, deep tools, and driver
          alerts. Terms and privacy are on the web app.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.muted, fontSize: 13, lineHeight: 18, marginBottom: 10 },
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
  saved: { color: colors.pos, fontSize: 12, marginBottom: 8 },
});
