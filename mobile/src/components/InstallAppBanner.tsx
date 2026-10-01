import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Download } from "lucide-react-native";
import { useInstallPrompt } from "../pwa/useInstallPrompt";
import { colors, radii, spacing, shadows, type as t } from "../theme/tokens";

// Only ever renders on Android/desktop Chrome once Chrome itself signals the
// site is installable (canInstall) - never on iOS, since iOS Safari has no
// install API for any website to hook into at all, so there's nothing this
// could trigger there.
export function InstallAppBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.iconBox}>
        <Download size={18} color={colors.goldText} />
      </View>
      <Text style={styles.text}>Install TREAT for quick, full-screen access</Text>
      <Pressable onPress={promptInstall} style={styles.button}>
        <Text style={styles.buttonText}>Install</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.goldSoft,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  text: {
    ...t.caption,
    color: colors.textPrimary,
    flex: 1,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  buttonText: {
    ...t.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
});
