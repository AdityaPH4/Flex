import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Hash, ReceiptText, History as HistoryIcon } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { api } from "@/api/client";
import type { CurrentBalance, Transaction } from "@/api/types";
import { Card } from "@/components/Card";
import { QuickAction } from "@/components/QuickAction";
import { TransactionRow } from "@/components/TransactionRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { colors, spacing, type as t } from "@/theme/tokens";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const router = useRouter();
  const { profile, cachedIdentity } = useAuth();
  const isOnline = useIsOnline();

  const [balance, setBalance] = useState<CurrentBalance | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const displayName = (profile?.name ?? cachedIdentity?.name ?? "").split(" ")[0];

  const load = useCallback(async () => {
    try {
      const [bal, txns] = await Promise.all([api.currentBalance(), api.transactions()]);
      setBalance(bal);
      setRecent(txns.transactions.slice(0, 3));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
      >
        <Text style={styles.greeting}>
          {greeting()}, {displayName || "there"} 👋
        </Text>

        {!isOnline && <OfflineBanner message="You're offline. Showing your last known balance." />}
        {isOnline && loadError && (
          <OfflineBanner message="Couldn't reach the server. Pull down to try again." />
        )}

        <Card style={styles.heroCard} accent>
          <Text style={styles.heroLabel}>Remaining this month</Text>
          <Text style={styles.heroNumber}>
            ₹{balance ? balance.remaining.toLocaleString("en-IN") : "—"}
          </Text>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>
                ₹{balance ? balance.allowance.toLocaleString("en-IN") : "—"}
              </Text>
              <Text style={styles.heroStatLabel}>Monthly allowance</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>
                ₹{balance ? balance.used.toLocaleString("en-IN") : "—"}
              </Text>
              <Text style={styles.heroStatLabel}>Used</Text>
            </View>
          </View>
        </Card>

        <View style={styles.quickActionsRow}>
          <QuickAction icon={Hash} label="Get Code" onPress={() => router.push("/(tabs)/benefits")} />
          <QuickAction
            icon={ReceiptText}
            label="Record Benefit"
            onPress={() => router.push("/record-benefit")}
          />
          <QuickAction icon={HistoryIcon} label="History" onPress={() => router.push("/(tabs)/history")} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <Text style={styles.sectionLink} onPress={() => router.push("/(tabs)/history")}>
            View All
          </Text>
        </View>

        <Card>
          {recent.length === 0 ? (
            <Text style={styles.emptyText}>No transactions yet this month.</Text>
          ) : (
            recent.map((txn, i) => (
              <View key={txn.id}>
                <TransactionRow transaction={txn} />
                {i < recent.length - 1 && <View style={styles.rowDivider} />}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  greeting: { ...t.h1, color: colors.textPrimary },
  heroCard: { gap: spacing.md },
  heroLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase" },
  heroNumber: { ...t.heroNumber, color: colors.gold },
  heroStatsRow: { flexDirection: "row", marginTop: spacing.sm },
  heroStat: { flex: 1 },
  heroStatValue: { ...t.h2, color: colors.textPrimary },
  heroStatLabel: { ...t.caption, color: colors.textMuted, marginTop: 2 },
  heroStatDivider: { width: 1, backgroundColor: colors.cardBorder, marginHorizontal: spacing.lg },
  quickActionsRow: { flexDirection: "row", gap: spacing.md },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { ...t.h2, color: colors.textPrimary },
  sectionLink: { ...t.caption, color: colors.gold },
  emptyText: { ...t.body, color: colors.textMuted },
  rowDivider: { height: 1, backgroundColor: colors.cardBorder },
});
