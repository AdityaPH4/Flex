import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";
import { PrimaryButton } from "@/components/PrimaryButton";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { colors, spacing, type as t } from "@/theme/tokens";

// The native Google Sign-In package has no real web implementation (see
// AuthContext.tsx) - on web, sign-in instead goes through Google's own
// Identity Services JS SDK directly, loaded here and used only on web.
// This is the standard, fully-supported way "Sign in with Google" works on
// any ordinary website - no App Store, no native module, no Apple/Google
// account needed beyond the existing Web OAuth client ID this app already
// has configured for the backend to verify tokens against.
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGoogleIdentityScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gis_script_failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gis_script_failed"));
    document.head.appendChild(script);
  });
}

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithGoogle, signInWithGoogleIdToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webButtonRef = useRef<View>(null);

  const handleSignInError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "google_account_not_registered") {
      setError("This Google account isn't registered as a TOIT employee. Check with HR if this seems wrong.");
    } else if (err instanceof Error && err.message === "google_sign_in_cancelled") {
      // Person closed the sign-in sheet - not an error worth showing.
    } else {
      setError("Couldn't sign in. Check your connection and try again.");
    }
  };

  const onWebCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setLoading(true);
      try {
        await signInWithGoogleIdToken(credential);
        router.replace("/(tabs)/home");
      } catch (err) {
        handleSignInError(err);
      } finally {
        setLoading(false);
      }
    },
    [signInWithGoogleIdToken, router]
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled) return;
        const google = (window as any).google;
        google.accounts.id.initialize({
          client_id: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
          callback: (response: { credential: string }) => onWebCredential(response.credential),
        });
        const node = webButtonRef.current as unknown as HTMLElement | null;
        if (node) {
          google.accounts.id.renderButton(node, { theme: "outline", size: "large", width: 320 });
        }
      })
      .catch(() => setError("Couldn't load Google Sign-In. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [onWebCredential]);

  const onSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      router.replace("/(tabs)/home");
    } catch (err) {
      handleSignInError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={{ gap: spacing.lg }}>
          <InstallAppBanner />

          <Text style={styles.eyebrow}>TOIT EMPLOYEE BENEFITS</Text>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>
            Use the Google account registered with HR to see your benefits.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {Platform.OS === "web" ? (
          <View style={styles.webButtonWrap}>
            {loading ? (
              <PrimaryButton label="Signing in..." onPress={() => {}} loading disabled />
            ) : (
              // Google's own script renders its real button into this node -
              // see the useEffect above. Left empty until then.
              <View ref={webButtonRef} />
            )}
          </View>
        ) : (
          <PrimaryButton label="Sign in with Google" onPress={onSignIn} loading={loading} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  webButtonWrap: { alignItems: "center" },
  content: {
    flex: 1,
    justifyContent: "space-between",
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
  },
  eyebrow: {
    ...t.label,
    color: colors.goldText,
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
