import React from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { colors, radii, spacing, shadows } from "../theme/tokens";

interface CardProps extends ViewProps {
  tone?: "neutral" | "gold" | "sage";
}

export function Card({ style, tone = "neutral", children, ...rest }: CardProps) {
  return (
    <View style={[styles.base, toneStyles[tone], style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
});

const toneStyles = StyleSheet.create({
  neutral: { backgroundColor: colors.surface },
  gold: { backgroundColor: colors.goldSoft },
  sage: { backgroundColor: colors.sageSoft },
});
