// Root layout: dark tab bar mirroring the web app's, wrapped in the viewer/
// entitlement provider. Non-tab routes are registered with href: null.
import { Tabs } from "expo-router";
import { Text } from "react-native";
import type { ColorValue } from "react-native";
import { ViewerProvider } from "../lib/viewer.tsx";
import { colors } from "../ui/theme.ts";

function icon(glyph: string) {
  return ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 17 }}>{glyph}</Text>;
}

export default function RootLayout() {
  return (
    <ViewerProvider>
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
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("⌂") }} />
        <Tabs.Screen name="live" options={{ title: "Live", tabBarIcon: icon("●") }} />
        <Tabs.Screen name="drivers" options={{ title: "Drivers", tabBarIcon: icon("⛑") }} />
        <Tabs.Screen name="pro" options={{ title: "Pro", tabBarIcon: icon("★") }} />
        <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("○") }} />
        <Tabs.Screen name="stats" options={{ href: null, title: "Standings" }} />
        <Tabs.Screen name="driver/[id]" options={{ href: null, title: "Driver" }} />
        <Tabs.Screen name="signin" options={{ href: null, title: "Sign in" }} />
        <Tabs.Screen name="signup" options={{ href: null, title: "Create account" }} />
        <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      </Tabs>
    </ViewerProvider>
  );
}
