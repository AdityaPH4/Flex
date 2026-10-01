import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReceiptText, History as HistoryIcon, Wallet, TrendingDown } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { api } from "@/api/client";
import type { CurrentBalance, Transaction } from "@/api/types";
import { Card } from "@/components/Card";
import { QuickAction } from "@/components/QuickAction";
import { TransactionRow } from "@/components/TransactionRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { colors, radii, spacing, type as t } from "@/theme/tokens";

export default function HomeScreen() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const { isBootstrapping } = useAuth();

  const [balance, setBalance] = useState<CurrentBalance | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Distinguishes "first ever load on this screen" from "already showed
  // data once, now quietly refreshing in the background" - only the first
  // one should show a full loading state. A slow network/busy server (a
  // queued request can genuinely take a few seconds under heavy concurrent
  // load) should look like "working, just taking a moment", never like a
  // blank, broken screen.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bal, txns] = await Promise.all([api.currentBalance(), api.transactions()]);
      setBalance(bal);
      setRecent(txns.transactions.slice(0, 3));
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setHasLoadedOnce(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // AuthContext's own session-restore is async (reads storage, then
      // calls setAuthToken) - React fires a child's effects before its
      // parent's, so on a cold start this screen's effect would otherwise
      // run BEFORE that token is set, sending an unauthenticated request
      // that fails with a spurious "couldn't load" error every time. Wait
      // for bootstrap to finish; the dependency change re-fires this once
      // it does.
      if (isBootstrapping) return;
      load();
    }, [load, isBootstrapping])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!hasLoadedOnce) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingFill}>
          <ActivityIndicator color={colors.goldText} size="large" />
          <Text style={styles.loadingText}>Loading your benefits…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
      >
        <View style={styles.brandRow}>
          <Text style={styles.brandName}>TREAT</Text>
          <View style={styles.versionBadge}>
            <Text style={styles.versionBadgeText}>v1</Text>
          </View>
        </View>

        <InstallAppBanner />

        {!isOnline && <OfflineBanner message="You're offline. Showing your last known balance." />}
        {isOnline && loadError && (
          <OfflineBanner message="Couldn't reach the server. Pull down to try again." />
        )}

        <Card tone="gold" style={styles.heroCard}>
          <Text style={styles.heroLabel}>Remaining this month</Text>
          <Text style={styles.heroNumber}>
            ₹{balance ? balance.remaining.toLocaleString("en-IN") : "—"}
          </Text>
        </Card>

        <View style={styles.statsRow}>
          <Card tone="sage" style={styles.statCard}>
            <View style={styles.statIconRow}>
              <Wallet size={18} color={colors.sageText} />
            </View>
            <Text style={styles.statValue}>
              ₹{balance ? balance.allowance.toLocaleString("en-IN") : "—"}
            </Text>
            <Text style={styles.statLabel}>Monthly allowance</Text>
          </Card>
          <Card tone="neutral" style={styles.statCard}>
            <View style={styles.statIconRow}>
              <TrendingDown size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.statValue}>
              ₹{balance ? balance.used.toLocaleString("en-IN") : "—"}
            </Text>
            <Text style={styles.statLabel}>Used</Text>
          </Card>
        </View>

        <View style={styles.quickActionsRow}>
          <QuickAction
            icon={ReceiptText}
            label="Add Payment"
            tone="gold"
            onPress={() => router.push("/record-benefit")}
          />
          <QuickAction icon={HistoryIcon} label="History" tone="sage" onPress={() => router.push("/(tabs)/history")} />
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
  loadingFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingText: { ...t.body, color: colors.textSecondary },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandName: { ...t.h1, color: colors.textPrimary, letterSpacing: 1 },
  versionBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  versionBadgeText: { ...t.label, color: colors.goldText, textTransform: "uppercase" },
  heroCard: { gap: spacing.sm },
  heroLabel: { ...t.label, color: colors.goldText, textTransform: "uppercase" },
  heroNumber: { ...t.heroNumber, color: colors.goldText },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, gap: spacing.xs },
  statIconRow: { marginBottom: spacing.xs },
  statValue: { ...t.h2, color: colors.textPrimary },
  statLabel: { ...t.caption, color: colors.textMuted },
  quickActionsRow: { flexDirection: "row", gap: spacing.md },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { ...t.h2, color: colors.textPrimary },
  sectionLink: { ...t.caption, color: colors.goldText },
  emptyText: { ...t.body, color: colors.textMuted },
  rowDivider: { height: 1, backgroundColor: colors.surfaceBorder },
});
