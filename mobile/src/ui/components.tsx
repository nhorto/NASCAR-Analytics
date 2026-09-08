// The handful of shared building blocks. Static styles only — no repeating
// animations (house rule: they peg GPUs and this is a race-day app).
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "./theme.ts";

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={styles.screen}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function Card({ title, right, children }: { title?: string; right?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? (
        <View style={styles.cardHeader}>
          <View style={styles.cardTick} />
          <Text style={styles.cardTitle}>{title}</Text>
          {right ? <Text style={styles.cardRight}>{right}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.mutedText}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  tone = "accent",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "quiet";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === "quiet" && styles.buttonQuiet, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonText, tone === "quiet" && styles.buttonQuietText]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A row of mutually exclusive options — the DK/FD toggle, track types, sort
 * keys. Locked options render dimmed with a padlock and do not fire onChange,
 * which is how a Pro-only choice states itself on a free account.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string; locked?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => !option.locked && onChange(option.value)}
            style={[styles.segment, on && styles.segmentOn, option.locked && styles.segmentLocked]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {option.locked ? `${option.label} 🔒` : option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled value stepper for bounded numbers (season range, min starts). */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable
        onPress={() => value > min && onChange(value - 1)}
        style={[styles.stepperButton, value <= min && styles.buttonDisabled]}
      >
        <Text style={styles.stepperGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable
        onPress={() => value < max && onChange(value + 1)}
        style={[styles.stepperButton, value >= max && styles.buttonDisabled]}
      >
        <Text style={styles.stepperGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

export function ProBadge() {
  return (
    <View style={styles.proBadge}>
      <Text style={styles.proBadgeText}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 14, gap: 12, paddingBottom: 48 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  cardTick: { width: 4, height: 11, backgroundColor: colors.accent, borderRadius: 2 },
  cardTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    flex: 1,
  },
  cardRight: { color: colors.muted, fontSize: 12 },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  mutedText: { color: colors.muted, fontSize: 13 },
  errorText: { color: colors.neg, fontSize: 14, textAlign: "center" },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  buttonQuiet: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#0a0c10", fontWeight: "700", fontSize: 14 },
  buttonQuietText: { color: colors.text },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, paddingVertical: 7, borderRadius: 7, alignItems: "center" },
  segmentOn: { backgroundColor: colors.accent },
  segmentLocked: { opacity: 0.45 },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  segmentTextOn: { color: "#0a0c10" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepperLabel: { color: colors.muted, fontSize: 12, flex: 1 },
  stepperButton: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    width: 32,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperGlyph: { color: colors.text, fontSize: 16, fontWeight: "700" },
  stepperValue: {
    color: colors.text,
    fontSize: 14,
    width: 46,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  proBadge: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "center",
  },
  proBadgeText: { color: "#0a0c10", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
});
