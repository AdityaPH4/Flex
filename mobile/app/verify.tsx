import React, { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, spacing, type as t } from "@/theme/tokens";

export default function VerifyScreen() {
  const router = useRouter();
  const { requestId, phone, expiresInSeconds } = useLocalSearchParams<{
    requestId: string;
    phone: string;
    expiresInSeconds: string;
  }>();
  const { verifyOtp, requestOtp } = useAuth();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(Number(expiresInSeconds ?? 300));
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const onVerify = async (candidate: string) => {
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(currentRequestId, candidate);
      router.replace("/(tabs)/home");
    } catch {
      setError("That code didn't match. Check the code and try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setError(null);
    try {
      const res = await requestOtp(phone);
      setCurrentRequestId(res.requestId);
      setSecondsLeft(res.expiresInSeconds);
      setCode("");
    } catch {
      setError("Couldn't resend the code. Try again in a moment.");
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View>
          <Text style={styles.eyebrow}>VERIFICATION CODE</Text>
          <Text style={styles.title}>Enter the 6-digit code</Text>
          <Text style={styles.subtitle}>Sent to {phone}</Text>

          <Pressable onPress={() => inputRef.current?.focus()}>
            <View style={styles.codeRow}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={[styles.codeBox, i < code.length && styles.codeBoxFilled]}>
                  <Text style={styles.codeDigit}>{code[i] ?? ""}</Text>
                </View>
              ))}
            </View>
          </Pressable>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/[^0-9]/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6) onVerify(digits);
            }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            style={styles.hiddenInput}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable onPress={onResend} disabled={secondsLeft > 0} style={styles.resendWrap}>
            <Text style={[styles.resend, secondsLeft > 0 && styles.resendDisabled]}>
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            </Text>
          </Pressable>
        </View>

        <PrimaryButton
          label="Verify"
          onPress={() => onVerify(code)}
          loading={loading}
          disabled={code.length < 6}
        />
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
  eyebrow: { ...t.label, color: colors.gold, marginBottom: spacing.md },
  title: { ...t.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...t.body, color: colors.textSecondary, marginBottom: spacing.xl },
  codeRow: { flexDirection: "row", gap: spacing.sm },
  codeBox: {
    width: 44,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxFilled: { borderColor: colors.goldBorder },
  codeDigit: { ...t.h1, color: colors.textPrimary },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  error: { ...t.caption, color: colors.danger, marginTop: spacing.lg },
  resendWrap: { marginTop: spacing.xl },
  resend: { ...t.bodyMedium, color: colors.gold },
  resendDisabled: { color: colors.textMuted },
});
