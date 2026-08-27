import React, { useState } from "react";
import { View, Text, StyleSheet, Image, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UserRound } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsOnline } from "@/api/useIsOnline";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { OfflineBanner } from "@/components/OfflineBanner";
import { colors, radii, spacing, type as t } from "@/theme/tokens";

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value ?? "—"}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, cachedIdentity, logout } = useAuth();
  const isOnline = useIsOnline();
  const [loggingOut, setLoggingOut] = useState(false);

  const name = profile?.name ?? cachedIdentity?.name ?? "";
  const employeeCode = profile?.employeeCode ?? cachedIdentity?.employeeCode ?? "";
  const photoUrl = profile?.photoUrl ?? cachedIdentity?.photoUrl ?? null;

  const confirmLogout = () => {
    Alert.alert("Sign out?", "You'll need to sign in with Google again to sign back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          await logout();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        {!isOnline && <OfflineBanner message="Offline - showing your last synced profile." />}

        <View style={styles.avatarSection}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <UserRound size={36} color={colors.textSecondary} />
            </View>
          )}
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.code}>{employeeCode}</Text>
        </View>

        <Card style={{ gap: spacing.md }}>
          <InfoRow label="Designation" value={profile?.designation ?? null} />
          <View style={styles.divider} />
          <InfoRow label="Department" value={profile?.department ?? null} />
          <View style={styles.divider} />
          <InfoRow label="Role" value={profile?.role ?? null} />
          <View style={styles.divider} />
          <InfoRow label="Home outlet" value={profile?.homeOutlet ?? null} />
        </Card>

        <Text style={styles.footnote}>
          Your employee code can't be edited here. If any of this information is wrong, contact HR.
        </Text>

        <PrimaryButton label="Sign out" onPress={confirmLogout} variant="secondary" loading={loggingOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...t.h1, color: colors.textPrimary },
  avatarSection: { alignItems: "center", gap: spacing.xs, marginVertical: spacing.md },
  avatar: { width: 88, height: 88, borderRadius: radii.pill },
  avatarFallback: {
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  name: { ...t.h1, color: colors.textPrimary, marginTop: spacing.sm },
  code: { ...t.body, color: colors.textSecondary, letterSpacing: 1 },
  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabel: { ...t.body, color: colors.textMuted },
  infoValue: { ...t.bodyMedium, color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.cardBorder },
  footnote: { ...t.caption, color: colors.textMuted, textAlign: "center" },
});
