import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RefreshCw, UserRound } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { api } from "@/api/client";
import { Card } from "@/components/Card";
import { OfflineBanner } from "@/components/OfflineBanner";
import { colors, radii, spacing, type as t } from "@/theme/tokens";

function formatCode(code: string): string {
  // "123456" -> "123 456" - easier to read aloud and easier for the cashier
  // to hold in their head while typing it into Digitory.
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export default function BenefitsScreen() {
  const { profile, cachedIdentity } = useAuth();
  const isOnline = useIsOnline();

  const name = profile?.name ?? cachedIdentity?.name ?? "";
  const employeeCode = profile?.employeeCode ?? cachedIdentity?.employeeCode ?? "";
  const photoUrl = profile?.photoUrl ?? cachedIdentity?.photoUrl ?? null;

  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generates a fresh code on demand - NOT auto-refreshed like the old QR
  // flow, since this code needs to survive being read aloud and typed into
  // Digitory by a cashier, not scanned instantly. It naturally goes stale
  // after a few minutes (see RECONCILIATION_CODE_TTL_SECONDS on the backend)
  // and the employee can just tap "New code" if they need another one.
  const fetchCode = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.createReconciliationCode();
      setCode(res.code);
      setSecondsLeft(res.expiresInSeconds);
    } catch {
      setCode(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!code) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [code]);

  const isStale = code !== null && secondsLeft <= 0;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.content}>
        <Text style={styles.title}>Employee Benefits</Text>

        {!isOnline && (
          <OfflineBanner message="Offline - show your name and code to staff. A new reference code needs a connection." />
        )}

        <Card accent style={styles.idCard}>
          <View style={styles.avatarWrap}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <UserRound size={32} color={colors.textSecondary} />
              </View>
            )}
          </View>

          <Text style={styles.name}>{name}</Text>
          <Text style={styles.employeeCode}>{employeeCode}</Text>

          <View style={styles.codeArea}>
            {isOnline ? (
              loading && !code ? (
                <ActivityIndicator color={colors.gold} />
              ) : code ? (
                <>
                  <Text style={styles.codeLabel}>GIVE THIS CODE TO THE CASHIER</Text>
                  <Text style={styles.codeValue}>{formatCode(code)}</Text>
                  <Text style={styles.expiry}>
                    {isStale ? "This code has gone stale" : `Valid for ${secondsLeft}s`}
                  </Text>
                  <Pressable onPress={fetchCode} style={styles.newCodeButton}>
                    <RefreshCw size={14} color={colors.gold} />
                    <Text style={styles.newCodeText}>New code</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={fetchCode} style={styles.generateButton}>
                  <Text style={styles.generateText}>Generate a code</Text>
                </Pressable>
              )
            ) : (
              <Text style={styles.offlineNote}>
                Tell staff your name and employee code above while you're offline. A reference
                code for Digitory needs a connection to generate.
              </Text>
            )}
          </View>
        </Card>

        <Text style={styles.footnote}>
          This code is a reference number for Digitory, not a password - it identifies which
          employee used a benefit so it can be reconciled later. This screen only ever shows
          your own information.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  title: { ...t.h1, color: colors.textPrimary },
  idCard: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.xs },
  avatarWrap: { marginBottom: spacing.md },
  avatar: { width: 72, height: 72, borderRadius: radii.pill },
  avatarFallback: {
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  name: { ...t.h2, color: colors.textPrimary },
  employeeCode: { ...t.body, color: colors.textSecondary, letterSpacing: 1 },
  codeArea: { marginTop: spacing.xl, alignItems: "center", minHeight: 160, justifyContent: "center", gap: spacing.sm },
  codeLabel: { ...t.label, color: colors.textMuted, textTransform: "uppercase" },
  codeValue: { ...t.heroNumber, color: colors.gold, letterSpacing: 4 },
  expiry: { ...t.caption, color: colors.textMuted },
  newCodeButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm, padding: spacing.sm },
  newCodeText: { ...t.bodyMedium, color: colors.gold },
  generateButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  generateText: { ...t.bodyMedium, color: colors.bg },
  offlineNote: { ...t.caption, color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  footnote: { ...t.caption, color: colors.textMuted, textAlign: "center" },
});
