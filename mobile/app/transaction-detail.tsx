import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { Card } from "@/components/Card";
import { colors, radii, spacing, shadows, type as t } from "@/theme/tokens";
import type { Transaction } from "@/api/types";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { transaction: raw } = useLocalSearchParams<{ transaction?: string }>();

  let transaction: Transaction | null = null;
  try {
    transaction = raw ? JSON.parse(raw) : null;
  } catch {
    transaction = null;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Transaction Details</Text>
          {transaction && <Text style={styles.subtitle}>{formatDateTime(transaction.occurredAt)}</Text>}
        </View>
        <Pressable onPress={() => router.back()} style={styles.closeButton}>
          <X size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {!transaction ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>Couldn't load this transaction.</Text>
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          <View>
            <Text style={styles.fieldLabel}>Outlet</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyValue}>{transaction.outlet}</Text>
            </View>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Final Amount</Text>
            <View style={styles.readOnlyInput}>
              <Text style={styles.readOnlyValue}>₹{transaction.amount.toLocaleString("en-IN")}</Text>
            </View>
          </View>

          {transaction.reconciliationCode ? (
            <View>
              <Text style={styles.fieldLabel}>OTP</Text>
              <View style={styles.readOnlyInput}>
                <Text style={styles.otpValue}>{transaction.reconciliationCode}</Text>
              </View>
            </View>
          ) : null}

          {transaction.billNo ? (
            <View>
              <Text style={styles.fieldLabel}>Bill No.</Text>
              <View style={styles.readOnlyInput}>
                <Text style={styles.readOnlyValue}>{transaction.billNo}</Text>
              </View>
            </View>
          ) : null}

          {transaction.notes ? (
            <View>
              <Text style={styles.fieldLabel}>Notes</Text>
              <View style={[styles.readOnlyInput, styles.notesBox]}>
                <Text style={styles.readOnlyValue}>{transaction.notes}</Text>
              </View>
            </View>
          ) : null}

          <Card tone="gold" style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{transaction.amount.toLocaleString("en-IN")}</Text>
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: spacing.lg,
  },
  title: { ...t.h1, color: colors.textPrimary },
  subtitle: { ...t.caption, color: colors.textMuted, marginTop: spacing.xs },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  fieldLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase", marginBottom: spacing.sm },
  readOnlyInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  readOnlyValue: { ...t.body, color: colors.textPrimary },
  otpValue: { ...t.bodyMedium, fontWeight: "700", color: colors.goldText, letterSpacing: 2 },
  notesBox: { minHeight: 72 },
  totalCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...t.h2, color: colors.textSecondary },
  totalValue: { ...t.h1, color: colors.goldText },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...t.body, color: colors.textMuted },
});
