import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { WifiOff } from "lucide-react-native";
import { colors, radii, spacing, type as t } from "../theme/tokens";

export function OfflineBanner({ message }: { message: string }) {
  return (
    <View style={styles.wrap}>
      <WifiOff size={16} color={colors.textSecondary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: {
    ...t.caption,
    color: colors.textSecondary,
    flex: 1,
  },
});
