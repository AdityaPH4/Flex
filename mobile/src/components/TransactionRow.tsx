import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { UtensilsCrossed } from "lucide-react-native";
import { colors, radii, spacing, type as t } from "../theme/tokens";
import type { Transaction } from "../api/types";

function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isSameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isSameDay) return "Today";
  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>
        <UtensilsCrossed size={18} color={colors.textPrimary} />
      </View>
      <View style={styles.middle}>
        <Text style={styles.outlet}>{transaction.outlet}</Text>
        <Text style={styles.day}>{formatRelativeDay(transaction.occurredAt)}</Text>
      </View>
      <Text style={styles.amount}>₹{transaction.amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  middle: {
    flex: 1,
  },
  outlet: {
    ...t.bodyMedium,
    color: colors.textPrimary,
  },
  day: {
    ...t.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  amount: {
    ...t.bodyMedium,
    color: colors.textPrimary,
  },
});
