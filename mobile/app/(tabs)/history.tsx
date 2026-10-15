import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LogOut } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { api, ApiError } from "@/api/client";
import type { Transaction } from "@/api/types";
import { TransactionRow } from "@/components/TransactionRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { colors, radii, shadows, spacing, type as t } from "@/theme/tokens";

type Row = { kind: "header"; label: string } | { kind: "txn"; txn: Transaction };

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function toRows(transactions: Transaction[]): Row[] {
  const rows: Row[] = [];
  let lastMonth = "";
  for (const txn of transactions) {
    const label = monthLabel(txn.occurredAt);
    if (label !== lastMonth) {
      rows.push({ kind: "header", label });
      lastMonth = label;
    }
    rows.push({ kind: "txn", txn });
  }
  return rows;
}

export default function HistoryScreen() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const { profile, cachedIdentity, logout, isBootstrapping } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const name = profile?.name ?? cachedIdentity?.name ?? "";
  const employeeCode = profile?.employeeCode ?? cachedIdentity?.employeeCode ?? "";

  const onConfirmSignOut = async () => {
    setShowSignOutConfirm(false);
    setLoggingOut(true);
    await logout();
  };

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    try {
      const res = await api.transactions();
      setTransactions(res.transactions);
      setCursor(res.nextCursor);
      setError(false);
    } catch (err) {
      // See home.tsx's identical guard - a 401 means the session is dead
      // (expired/revoked/employee deactivated), not a network blip.
      if (err instanceof ApiError && err.status === 401) {
        await logout();
        return;
      }
      setError(true);
    } finally {
      setLoadingInitial(false);
    }
  }, [logout]);

  useFocusEffect(
    useCallback(() => {
      // See home.tsx's identical guard - without it, this fires before
      // AuthContext's async session restore has set the auth token,
      // failing every cold start with a spurious "couldn't load history".
      if (isBootstrapping) return;
      loadInitial();
    }, [loadInitial, isBootstrapping])
  );

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.transactions({ cursor });
      setTransactions((prev) => [...prev, ...res.transactions]);
      setCursor(res.nextCursor);
    } catch {
      // silently stop paginating on error - the person can pull-to-refresh /
      // reopen the screen to retry
    } finally {
      setLoadingMore(false);
    }
  };

  const rows = toRows(transactions);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Transaction History</Text>
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
        {(name || employeeCode) && (
          <Text style={styles.identity}>
            {name}
            {name && employeeCode ? " · " : ""}
            {employeeCode}
          </Text>
        )}
      </View>

      {!isOnline && <OfflineBanner message="You're offline - showing the most recently loaded history." />}
      {isOnline && error && <OfflineBanner message="Couldn't load history. Pull down to try again." />}

      {loadingInitial ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.goldText} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>No transactions yet.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row, i) => (row.kind === "header" ? `h-${row.label}-${i}` : row.txn.id)}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.goldText} style={{ marginTop: spacing.lg }} /> : undefined}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <Text style={styles.monthHeader}>{item.label}</Text>
            ) : (
              <TransactionRow
                transaction={item.txn}
                onPress={() =>
                  router.push({ pathname: "/transaction-detail", params: { transaction: JSON.stringify(item.txn) } })
                }
              />
            )
          }
        />
      )}

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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...t.h1, color: colors.textPrimary },
  identity: { ...t.caption, color: colors.textMuted },
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
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  monthHeader: { ...t.label, color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.xs },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...t.body, color: colors.textMuted },
});
