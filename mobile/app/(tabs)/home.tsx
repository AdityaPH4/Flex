import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReceiptText, History as HistoryIcon, Wallet, TrendingDown, LogOut, CalendarClock } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { api, ApiError } from "@/api/client";
import type { CurrentBalance, Transaction } from "@/api/types";
import { Card } from "@/components/Card";
import { QuickAction } from "@/components/QuickAction";
import { TransactionRow } from "@/components/TransactionRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatMoney } from "@/utils/money";
import { colors, radii, shadows, spacing, type as t } from "@/theme/tokens";

// "2026-10-31" -> "31 Oct 2026". Parsed as UTC so the day never shifts with the phone's timezone.
const formatDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function HomeScreen() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const { isBootstrapping, logout } = useAuth();

  const [balance, setBalance] = useState<CurrentBalance | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
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
    } catch (err) {
      // A 401 here means the session itself is dead (expired, revoked, or
      // the employee was deactivated) - not a network blip. Showing the
      // generic offline banner forever would be misleading and leave the
      // person stuck; sign out and let the auth redirect send them to
      // /login instead.
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        return;
      }
      setLoadError(true);
    } finally {
      setHasLoadedOnce(true);
    }
  }, [logout]);

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

  const onConfirmSignOut = async () => {
    setShowSignOutConfirm(false);
    setLoggingOut(true);
    await logout();
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
          <View style={styles.brandGroup}>
            <Text style={styles.brandName}>TREAT</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionBadgeText}>v1</Text>
            </View>
          </View>
          <Pressable
            onPress={() => setShowSignOutConfirm(true)}
            disabled={loggingOut}
            hitSlop={8}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
          >
            {loggingOut ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <LogOut size={18} color={colors.textMuted} />
            )}
          </Pressable>
        </View>

        <InstallAppBanner />

        {!isOnline && <OfflineBanner message="You're offline. Showing your last known balance." />}
        {isOnline && loadError && (
          <OfflineBanner message="Couldn't reach the server. Pull down to try again." />
        )}

        {balance?.ended ? (
          // Valid-to (or last working) day is over: no wallet to show, only who to ask.
          <Card style={styles.endedCard}>
            <View style={styles.endedIcon}>
              <Wallet size={28} color={colors.textMuted} />
            </View>
            <Text style={styles.endedTitle}>No balance detected</Text>
            <Text style={styles.endedText}>Please contact HR</Text>
          </Card>
        ) : (
          <>
          <Card tone="gold" style={styles.heroCard}>
            <Text style={styles.heroLabel}>Remaining this month</Text>
            <Text style={styles.heroNumber}>
              {balance ? formatMoney(balance.remaining) : "—"}
            </Text>
          </Card>

          <View style={styles.statsRow}>
            <Card tone="sage" style={styles.statCard}>
              <View style={styles.statIconRow}>
                <Wallet size={18} color={colors.sageText} />
              </View>
              <Text style={styles.statValue}>
                {balance ? formatMoney(balance.allowance) : "—"}
              </Text>
              <Text style={styles.statLabel}>Monthly allowance</Text>
            </Card>
            <Card tone="neutral" style={styles.statCard}>
              <View style={styles.statIconRow}>
                <TrendingDown size={18} color={colors.textSecondary} />
              </View>
              <Text style={styles.statValue}>
                {balance ? formatMoney(balance.used) : "—"}
              </Text>
              <Text style={styles.statLabel}>Used</Text>
            </Card>
          </View>

          <View style={styles.quickActionsRow}>
            <View style={styles.quickActions}>
              <QuickAction
                icon={ReceiptText}
                label="Add Payment"
                tone="gold"
                onPress={() => router.push("/record-benefit")}
              />
              <QuickAction icon={HistoryIcon} label="History" tone="sage" onPress={() => router.push("/(tabs)/history")} />
            </View>
            <Card tone="neutral" style={styles.validityCard}>
              <View style={styles.validityHead}>
                <CalendarClock size={16} color={colors.goldText} />
                <Text style={styles.validityTitle}>Validity</Text>
              </View>
              {balance && (balance.validFrom || balance.validTo) ? (
                <>
                  <Text style={styles.validityLine}>
                    <Text style={styles.validityKey}>From </Text>
                    {balance.validFrom ? formatDay(balance.validFrom) : "—"}
                  </Text>
                  <Text style={styles.validityLine}>
                    <Text style={styles.validityKey}>To </Text>
                    {balance.validTo ? formatDay(balance.validTo) : "No end date"}
                  </Text>
                </>
              ) : (
                <Text style={styles.validityLine}>{balance ? "No time limit" : "—"}</Text>
              )}
            </Card>
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
                  <TransactionRow
                    transaction={txn}
                    onPress={() =>
                      router.push({ pathname: "/transaction-detail", params: { transaction: JSON.stringify(txn) } })
                    }
                  />
                  {i < recent.length - 1 && <View style={styles.rowDivider} />}
                </View>
              ))
            )}
          </Card>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={showSignOutConfirm}
        title="Sign out?"
        message="You'll need to sign in with Google again to sign back in."
        actions={[
          { label: "Cancel", variant: "secondary", onPress: () => setShowSignOutConfirm(false) },
          { label: "Sign out", onPress: onConfirmSignOut },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loadingFill: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingText: { ...t.body, color: colors.textSecondary },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandGroup: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandName: { ...t.h1, color: colors.textPrimary, letterSpacing: 1 },
  versionBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  versionBadgeText: { ...t.label, color: colors.goldText, textTransform: "uppercase" },
  signOutButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  signOutButtonPressed: { opacity: 0.7 },
  heroCard: { gap: spacing.sm },
  heroLabel: { ...t.label, color: colors.goldText, textTransform: "uppercase" },
  heroNumber: { ...t.heroNumber, color: colors.goldText },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statCard: { flex: 1, gap: spacing.xs },
  statIconRow: { marginBottom: spacing.xs },
  statValue: { ...t.h2, color: colors.textPrimary },
  statLabel: { ...t.caption, color: colors.textMuted },
  quickActionsRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  quickActions: { flex: 1, flexDirection: "row", gap: spacing.sm },
  validityCard: { flex: 1.15, padding: spacing.md, gap: spacing.xs },
  validityHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  validityTitle: { ...t.label, color: colors.goldText, textTransform: "uppercase" },
  validityLine: { ...t.caption, color: colors.textPrimary },
  validityKey: { color: colors.textMuted },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { ...t.h2, color: colors.textPrimary },
  sectionLink: { ...t.caption, color: colors.goldText },
  emptyText: { ...t.body, color: colors.textMuted },
  rowDivider: { height: 1, backgroundColor: colors.surfaceBorder },
  endedCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl, marginTop: spacing.xxl },
  endedIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  endedTitle: { ...t.h1, color: colors.textPrimary, textAlign: "center" },
  endedText: { ...t.body, color: colors.textSecondary, textAlign: "center" },
});
