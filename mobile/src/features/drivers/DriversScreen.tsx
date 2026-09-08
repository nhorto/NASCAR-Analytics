// Cup driver index with client-side search (the API also accepts ?q= but a
// loaded list filters instantly with no round trip).
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { serverBase } from "../../lib/config.ts";
import { useReload } from "../../lib/reload.ts";
import { ErrorNote, Loading, Screen } from "../../ui/components.tsx";
import { colors } from "../../ui/theme.ts";
import { fetchDrivers, type DriverSummary } from "./api.ts";
import { driverListRows } from "./model.ts";

export function DriversScreen() {
  const [drivers, setDrivers] = useState<DriverSummary[] | null | undefined>(undefined);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setDrivers(await fetchDrivers(await serverBase(), ""));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (drivers === undefined || drivers === null) void load();
    }, [drivers, load]),
  );
  const { refreshing, onRefresh } = useReload(load);

  if (drivers === undefined) return <Loading label="Loading drivers…" />;
  if (drivers === null)
    return (
      <Screen>
        <ErrorNote message="Could not reach the server." onRetry={() => void load()} />
      </Screen>
    );

  const rows = driverListRows(drivers, filter);
  return (
    <Screen scroll={false}>
      <TextInput
        style={styles.search}
        placeholder="Search drivers"
        placeholderTextColor={colors.muted}
        value={filter}
        onChangeText={setFilter}
        autoCorrect={false}
        accessibilityLabel="Search drivers"
      />
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.driverId)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter.trim() === "" ? "No drivers found." : `No drivers match "${filter}".`}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/driver/${item.driverId}`)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.line}`}
          >
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.line}>{item.line}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    margin: 14,
    marginBottom: 6,
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  list: { paddingHorizontal: 14, paddingBottom: 48, flexGrow: 1 },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  line: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chev: { color: colors.muted, fontSize: 20 },
});
