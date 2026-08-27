import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radii, spacing, type as t } from "../theme/tokens";

interface Props {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}

export function QuickAction({ icon: Icon, label, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View style={styles.iconCircle}>
        <Icon size={20} color={colors.textPrimary} />
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
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...t.caption,
    color: colors.textSecondary,
  },
});
