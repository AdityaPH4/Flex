import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radii, spacing, shadows, type as t } from "../theme/tokens";

interface Props {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: "gold" | "sage";
}

export function QuickAction({ icon: Icon, label, onPress, tone = "gold" }: Props) {
  const iconColor = tone === "gold" ? colors.goldText : colors.sageText;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View style={[styles.iconCircle, tone === "gold" ? styles.iconCircleGold : styles.iconCircleSage]}>
        <Icon size={20} color={iconColor} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  iconCircleGold: {
    backgroundColor: colors.goldSoft,
  },
  iconCircleSage: {
    backgroundColor: colors.sageSoft,
  },
  label: {
    ...t.caption,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
