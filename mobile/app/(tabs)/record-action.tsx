import React from "react";
import { Redirect } from "expo-router";

// Never actually shown - the tab bar intercepts tabPress on this slot and
// pushes the record-benefit modal instead (see (tabs)/_layout.tsx). This
// file exists only because Expo Router's file-based routing needs a real
// route behind every Tabs.Screen name.
export default function RecordActionScreen() {
  return <Redirect href="/(tabs)/home" />;
}
