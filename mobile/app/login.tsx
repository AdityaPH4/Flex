import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/api/client";
import { PrimaryButton } from "@/components/PrimaryButton";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { colors, spacing, type as t, fontFamily } from "@/theme/tokens";

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
          // Google's own button only offers fixed size tiers (no custom
          // pixel height) - rendered intrinsically narrower here, then
          // visually scaled up by the wrapping view below (see
          // styles.scaledButton), so the final on-screen size is bigger
          // than Google's native "large" rendering without needing a
          // pixel-height option that doesn't exist. `width` here controls
          // the final box width independently of the scale factor (final
          // width = this width * the scale); the scale factor alone
          // controls the final text/logo/height size. 200 is Google's
          // documented minimum - kept deliberately narrow so the scaled
          // result (200*1.4=280) still fits inside the content area's
          // padding even on a ~320px-wide screen, since the scale transform
          // doesn't reserve extra layout space for the visual overflow it
          // creates (unlike width, which Google's own layout does respect).
          google.accounts.id.renderButton(node, {
            theme: "filled_blue",
            size: "large",
            width: 200,
            shape: "pill",
            text: "signin_with",
          });
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
        <InstallAppBanner />

        <Text style={styles.brandName}>TREAT</Text>
        <Text style={styles.brandTagline}>Employee Spending Allowances app</Text>
        <Text style={styles.subtitle}>Sign in using your registered company Google account</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Platform.OS === "web" ? (
          <View style={styles.webButtonWrap}>
            {/* Always mounted, never swapped out for <PrimaryButton> - the
                renderButton effect above only ever fires once (its deps never
                change), so if this node were unmounted (e.g. while loading)
                and later remounted, Google's button would never come back,
                permanently stranding the person with no way to sign in.
                Loading state is shown as an overlay on top instead. */}
            <View style={styles.scaledButton}>
              <View ref={webButtonRef} />
            </View>
            {loading && (
              <View style={styles.loadingOverlay}>
                <PrimaryButton label="Signing in..." onPress={() => {}} loading disabled />
              </View>
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
  webButtonWrap: {
    alignItems: "center",
    width: "100%",
    paddingVertical: spacing.lg,
    position: "relative",
  },
  // transform doesn't reserve extra layout space for the scaled-up result,
  // so the wrap above adds vertical padding as breathing room for it.
  scaledButton: { transform: [{ scale: 1.4 }] },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
    paddingTop: spacing.xxxl,
    gap: spacing.lg,
  },
  brandName: {
    ...t.heroNumber,
    fontSize: 46,
    lineHeight: 50,
    color: colors.textPrimary,
  },
  brandTagline: {
    fontFamily: fontFamily.displayMedium,
    fontSize: 20,
    color: colors.goldText,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...t.body,
    fontSize: 17,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  error: {
    ...t.caption,
    color: colors.danger,
  },
});
