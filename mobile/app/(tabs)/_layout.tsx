import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Redirect, Tabs, useRouter } from "expo-router";
import { Home, History, Plus } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors, radii, shadows } from "@/theme/tokens";

function RecordActionButton() {
  const router = useRouter();
  return (
    <View style={styles.fabWrap} pointerEvents="box-none">
      <Pressable
        onPress={() => router.push("/record-benefit")}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Plus size={26} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  const { isAuthenticated, isBootstrapping } = useAuth();

  if (!isBootstrapping && !isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.surfaceBorder,
          height: 84,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.goldText,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="record-action"
        options={{
          title: "",
          tabBarIcon: () => null,
          tabBarButton: () => <RecordActionButton />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
          },
        }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabWrap: {
    position: "absolute",
    top: -22,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  fabPressed: {
    opacity: 0.85,
  },
});
