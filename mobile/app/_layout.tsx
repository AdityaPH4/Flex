import React, { useEffect, useCallback } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useFonts as useInterFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import {
  useFonts as useSpaceGroteskFonts,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { AuthProvider } from "@/auth/AuthContext";
import { colors } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {
  // no-op if already handled
});

export default function RootLayout() {
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [spaceGroteskLoaded] = useSpaceGroteskFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });

  const fontsReady = interLoaded && spaceGroteskLoaded;

  const onLayoutRootView = useCallback(async () => {
    if (fontsReady) {
      await SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  useEffect(() => {
    onLayoutRootView();
  }, [onLayoutRootView]);

  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="record-benefit" options={{ presentation: "modal" }} />
          <Stack.Screen name="transaction-detail" options={{ presentation: "modal" }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
