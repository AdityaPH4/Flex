import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { Plus, Trash2, X } from "lucide-react-native";
import { api, ApiError } from "@/api/client";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radii, spacing, type as t } from "@/theme/tokens";

interface ItemRow {
  id: string;
  name: string;
  amount: string; // kept as string while editing, parsed on submit
}

export default function RecordBenefitScreen() {
  const router = useRouter();
  const [outletName, setOutletName] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ id: "1", name: "", amount: "" }]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const updateItem = (id: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { id: Crypto.randomUUID(), name: "", amount: "" }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  };

  const canSubmit = total > 0 && items.every((it) => it.name.trim().length > 0);

  const onConfirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.recordTransaction({
        amount: Math.round(total),
        outletName: outletName.trim() || undefined,
        items: items.map((it) => ({ name: it.name.trim(), amount: parseFloat(it.amount) || 0 })),
        notes: notes.trim() || undefined,
        idempotencyKey: Crypto.randomUUID(),
      });
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_balance") {
        setError("This would go over your remaining balance for the month.");
      } else {
        setError("Couldn't save this right now. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Text style={styles.title}>Record Benefit</Text>
          <Pressable onPress={() => router.back()} style={styles.closeButton}>
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View>
            <Text style={styles.fieldLabel}>Outlet</Text>
            <TextInput
              value={outletName}
              onChangeText={setOutletName}
              placeholder="e.g. TOIT Indiranagar"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>

          <View>
            <Text style={styles.fieldLabel}>Items</Text>
            <Card style={{ gap: spacing.md }}>
              {items.map((item, i) => (
                <View key={item.id} style={styles.itemRow}>
                  <TextInput
                    value={item.name}
                    onChangeText={(v) => updateItem(item.id, { name: v })}
                    placeholder="Item name"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.input, styles.itemNameInput]}
                  />
                  <TextInput
                    value={item.amount}
                    onChangeText={(v) => updateItem(item.id, { amount: v.replace(/[^0-9.]/g, "") })}
                    placeholder="₹0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={[styles.input, styles.itemAmountInput]}
                  />
                  {items.length > 1 && (
                    <Pressable onPress={() => removeItem(item.id)} style={styles.removeButton}>
                      <Trash2 size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable onPress={addItem} style={styles.addItemRow}>
                <Plus size={16} color={colors.gold} />
                <Text style={styles.addItemText}>Add item</Text>
              </Pressable>
            </Card>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth remembering about this one"
              placeholderTextColor={colors.textMuted}
              multiline
              style={[styles.input, styles.notesInput]}
            />
          </View>

          <Card style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₹{total.toLocaleString("en-IN")}</Text>
          </Card>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label="Confirm Benefit"
            onPress={onConfirm}
            loading={submitting}
            disabled={!canSubmit}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
  },
  title: { ...t.h1, color: colors.textPrimary },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  fieldLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase", marginBottom: spacing.sm },
  input: {
    ...t.body,
    color: colors.textPrimary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  itemRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  itemNameInput: { flex: 2 },
  itemAmountInput: { flex: 1 },
  removeButton: { padding: spacing.xs },
  addItemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.xs },
  addItemText: { ...t.bodyMedium, color: colors.gold },
  notesInput: { minHeight: 72, textAlignVertical: "top" },
  totalCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...t.h2, color: colors.textSecondary },
  totalValue: { ...t.h1, color: colors.gold },
  error: { ...t.caption, color: colors.danger, textAlign: "center" },
  footer: { padding: spacing.lg },
});
