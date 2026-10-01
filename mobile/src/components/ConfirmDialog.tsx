import React from "react";
import { View, Text, StyleSheet, Modal } from "react-native";
import { Card } from "./Card";
import { PrimaryButton } from "./PrimaryButton";
import { colors, spacing, type as t } from "../theme/tokens";

interface DialogAction {
  label: string;
  variant?: "primary" | "secondary";
  onPress: () => void;
}

// A themed stand-in for Alert.alert - Alert always renders as the OS's own
// system dialog on native, which looks out of place next to this app's
// custom light/pastel design, and on web react-native-web's Alert.alert is a
// total no-op (does nothing at all), so this is required there, not just
// cosmetic.
export function ConfirmDialog({
  visible,
  title,
  message,
  amountRows,
  actions,
}: {
  visible: boolean;
  title: string;
  message?: string;
  amountRows?: { label?: string; value: string }[];
  actions: DialogAction[];
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.dialogOverlay}>
        <Card style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{title}</Text>
          {message ? <Text style={styles.dialogMessage}>{message}</Text> : null}
          {amountRows?.map((row) => (
            <View key={row.label ?? row.value} style={styles.dialogAmountRow}>
              {row.label ? <Text style={styles.dialogAmountLabel}>{row.label}</Text> : null}
              <Text style={styles.dialogAmount}>{row.value}</Text>
            </View>
          ))}
          <View style={styles.dialogActions}>
            {actions.map((action) => (
              <PrimaryButton
                key={action.label}
                label={action.label}
                variant={action.variant ?? "primary"}
                onPress={action.onPress}
              />
            ))}
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dialogOverlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  dialogCard: { width: "100%", gap: spacing.md, alignItems: "center" },
  dialogTitle: { ...t.h2, color: colors.textPrimary, textAlign: "center" },
  dialogMessage: { ...t.body, color: colors.textSecondary, textAlign: "center" },
  dialogAmountRow: { alignItems: "center" },
  dialogAmountLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase" },
  dialogAmount: { ...t.heroNumber, color: colors.goldText, fontSize: 36 },
  dialogActions: { width: "100%", gap: spacing.sm, marginTop: spacing.xs },
});
