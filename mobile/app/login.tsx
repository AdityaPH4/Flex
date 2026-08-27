import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, spacing, type as t } from "@/theme/tokens";

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      router.replace("/(tabs)/home");
    } catch (err) {
      if (err instanceof ApiError && err.code === "google_account_not_registered") {
        setError("This Google account isn't registered as a TOIT employee. Check with HR if this seems wrong.");
      } else if (err instanceof Error && err.message === "google_sign_in_cancelled") {
        // Person closed the sign-in sheet - not an error worth showing.
      } else {
        setError("Couldn't sign in. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View>
          <Text style={styles.eyebrow}>TOIT EMPLOYEE BENEFITS</Text>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>
            Use the Google account registered with HR to see your benefits.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <PrimaryButton label="Sign in with Google" onPress={onSignIn} loading={loading} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
  },
  eyebrow: {
    ...t.label,
    color: colors.gold,
    marginBottom: spacing.md,
  },
  title: {
    ...t.h1,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...t.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  error: {
    ...t.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
});
