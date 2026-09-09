// Root layout (2026-09-09 UX realignment): five intent-named tabs — Home,
// Live, Picks, Stats, Account — with real icons and a red dot on Live when a
// race is on track. The old "Pro" junk-drawer tab is gone: Pro is now inline
// lock states plus one shared upsell sheet (UpsellProvider). Non-tab routes
// are registered with href: null. Navigation is identical for free and Pro
// viewers; only lock treatments differ.
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { ViewerProvider } from "../lib/viewer.tsx";
import { SeriesProvider } from "../lib/series.tsx";
import { LiveStatusProvider, useLiveStatus } from "../lib/liveStatus.tsx";
import { UpsellProvider } from "../features/pro/UpsellSheet.tsx";
import { colors } from "../ui/theme.ts";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Screen readers otherwise announce "Home, tab, 1 of 15" — expo-router counts
 * the ten `href: null` routes that live in this navigator so pushed screens
 * (drivers, compare, settings…) keep the tab bar visible. Those routes are not
 * tabs, so an explicit label states the real position (2026-09-09 drive, #4).
 */
const TAB_COUNT = 5;
function tabLabel(name: string, index: number): string {
  return `${name}, tab ${index} of ${TAB_COUNT}`;
}

function icon(outline: IoniconName, filled: IoniconName) {
  return ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? filled : outline} size={size} color={color} />
  );
}

function TabsWithLive() {
  const live = useLiveStatus();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700", letterSpacing: 1 },
        tabBarStyle: { backgroundColor: "#0d1016", borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: icon("home-outline", "home"),
          tabBarAccessibilityLabel: tabLabel("Home", 1),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: "Live",
          tabBarIcon: icon("radio-outline", "radio"),
          tabBarAccessibilityLabel: tabLabel("Live", 2),
          // Red dot when a race is on track — the app mirror of the web's livedot.
          tabBarBadge: live ? "" : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.neg, minWidth: 8, maxHeight: 8, borderRadius: 4 },
        }}
      />
      <Tabs.Screen
        name="picks"
        options={{
          title: "Picks",
          tabBarIcon: icon("podium-outline", "podium"),
          tabBarAccessibilityLabel: tabLabel("Picks", 3),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: "Stats",
          tabBarIcon: icon("stats-chart-outline", "stats-chart"),
          tabBarAccessibilityLabel: tabLabel("Stats", 4),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: icon("person-circle-outline", "person-circle"),
          tabBarAccessibilityLabel: tabLabel("Account", 5),
        }}
      />

      {/* Non-tab routes: reachable by navigation, not shown in the bar. */}
      <Tabs.Screen name="drivers" options={{ href: null, title: "Drivers" }} />
      <Tabs.Screen name="predictions" options={{ href: null, title: "Predictions" }} />
      <Tabs.Screen name="methodology" options={{ href: null, title: "How it works" }} />
      <Tabs.Screen name="dfs" options={{ href: null, title: "DFS" }} />
      <Tabs.Screen name="compare" options={{ href: null, title: "Compare" }} />
      <Tabs.Screen name="tracks" options={{ href: null, title: "Track types" }} />
      <Tabs.Screen name="driver/[id]" options={{ href: null, title: "Driver" }} />
      <Tabs.Screen name="signin" options={{ href: null, title: "Sign in" }} />
      <Tabs.Screen name="signup" options={{ href: null, title: "Create account" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <ViewerProvider>
      <SeriesProvider>
        <LiveStatusProvider>
          <UpsellProvider>
            <TabsWithLive />
          </UpsellProvider>
        </LiveStatusProvider>
      </SeriesProvider>
    </ViewerProvider>
  );
}
