import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsOnline } from "@/api/useIsOnline";
import { api } from "@/api/client";
import type { Transaction } from "@/api/types";
import { TransactionRow } from "@/components/TransactionRow";
import { OfflineBanner } from "@/components/OfflineBanner";
import { colors, spacing, type as t } from "@/theme/tokens";

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
  const isOnline = useIsOnline();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    try {
      const res = await api.transactions();
      setTransactions(res.transactions);
      setCursor(res.nextCursor);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

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
        <Text style={styles.title}>Transaction History</Text>
      </View>

      {!isOnline && <OfflineBanner message="You're offline - showing the most recently loaded history." />}
      {isOnline && error && <OfflineBanner message="Couldn't load history. Pull down to try again." />}

      {loadingInitial ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.gold} />
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
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.lg }} /> : undefined}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <Text style={styles.monthHeader}>{item.label}</Text>
            ) : (
              <TransactionRow transaction={item.txn} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { ...t.h1, color: colors.textPrimary },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  monthHeader: { ...t.label, color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.xs },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...t.body, color: colors.textMuted },
});
