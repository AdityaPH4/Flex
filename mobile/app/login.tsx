import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, spacing, type as t } from "@/theme/tokens";

export default function LoginScreen() {
  const router = useRouter();
  const { requestOtp } = useAuth();
  const [phone, setPhone] = useState("+91");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    setError(null);
    setLoading(true);
    try {
      const { requestId, expiresInSeconds } = await requestOtp(phone.trim());
      router.push({
        pathname: "/verify",
        params: { requestId, phone: phone.trim(), expiresInSeconds: String(expiresInSeconds) },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "phone_not_registered") {
        setError("This number isn't registered as a TOIT employee. Check with HR if this seems wrong.");
      } else {
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <View>
            <Text style={styles.eyebrow}>TOIT EMPLOYEE BENEFITS</Text>
            <Text style={styles.title}>Sign in with your phone</Text>
            <Text style={styles.subtitle}>
              We'll text a one-time code to verify it's really you.
            </Text>

            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 90000 00000"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              autoFocus
              style={styles.input}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <PrimaryButton
            label="Send code"
            onPress={onContinue}
            loading={loading}
            disabled={phone.trim().length < 8}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
  input: {
    ...t.body,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 17,
  },
  error: {
    ...t.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
});
