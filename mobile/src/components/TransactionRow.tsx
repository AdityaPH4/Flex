import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { UtensilsCrossed } from "lucide-react-native";
import { colors, radii, spacing, shadows, type as t } from "../theme/tokens";
import { formatMoney } from "../utils/money";
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

export function TransactionRow({
  transaction,
  onPress,
}: {
  transaction: Transaction;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.row} onPress={onPress}>
      <View style={styles.iconBox}>
        <UtensilsCrossed size={18} color={colors.goldText} />
      </View>
      <View style={styles.nameBlock}>
        <Text style={styles.outlet}>{transaction.outlet}</Text>
        <Text style={styles.day}>{formatRelativeDay(transaction.occurredAt)}</Text>
      </View>
      <View style={styles.otpBlock}>
        {transaction.status === "void" ? (
          <Text style={styles.day}>Rejected</Text>
        ) : transaction.reconciliationCode ? (
          <Text style={styles.otp}>{transaction.reconciliationCode}</Text>
        ) : null}
      </View>
      <View style={styles.amountBlock}>
        <Text style={[styles.amount, transaction.status === "void" && { textDecorationLine: "line-through", color: colors.textMuted }]}>{formatMoney(transaction.amount)}</Text>
        {transaction.cashAmount ? (
          <Text style={styles.cashNote}>+{formatMoney(transaction.cashAmount)} cash</Text>
        ) : null}
      </View>
    </Wrapper>
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
    backgroundColor: colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  nameBlock: {
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
  // Fixed width (not flex) so the OTP column lines up the same way on every
  // row, regardless of how long the outlet name or the amount next to it
  // is - codes are always 6 digits, so a fixed width is exact, not a guess.
  otpBlock: {
    width: 72,
    alignItems: "center",
  },
  otp: {
    ...t.bodyMedium,
    fontWeight: "700",
    color: colors.goldText,
    letterSpacing: 1,
  },
  amountBlock: {
    alignItems: "flex-end",
  },
  amount: {
    ...t.bodyMedium,
    color: colors.textPrimary,
  },
  cashNote: {
    ...t.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
});
