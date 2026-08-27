import React from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

interface CardProps extends ViewProps {
  accent?: boolean; // gold-tinted border, reserved for the one signature card
}

export function Card({ style, accent, children, ...rest }: CardProps) {
  return (
    <View
      style={[styles.base, accent ? styles.accent : undefined, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
  },
  accent: {
    borderColor: colors.goldBorder,
  },
});
