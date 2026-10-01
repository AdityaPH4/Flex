import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { X, ChevronDown } from "lucide-react-native";
import { api, ApiError } from "@/api/client";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { colors, radii, spacing, shadows, type as t } from "@/theme/tokens";

interface Split {
  allowance: number; // portion actually deducted from the monthly allowance
  cash: number; // portion paid separately, outside the benefit system
}

const OUTLETS = ["TOIT Indiranagar", "TOIT Bagmane", "TOIT Pune"];

function formatCode(code: string): string {
  // "123456" -> "123 456" - easier to read aloud and easier for the cashier
  // to hold in their head while typing it into Digitory.
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export default function RecordBenefitScreen() {
  const router = useRouter();
  const [outletName, setOutletName] = useState("");
  const [outletPickerOpen, setOutletPickerOpen] = useState(false);
  const outletFieldRef = useRef<View>(null);
  const [outletFieldRect, setOutletFieldRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [amount, setAmount] = useState(""); // final amount from the bill, incl. GST/taxes
  const [billNo, setBillNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set once the person picks "Pay Remaining by Cash" on the over-balance
  // popup - reviewed on-screen before they confirm again. Stays set through
  // a successful submit so the result screen can mention both amounts too.
  const [split, setSplit] = useState<Split | null>(null);
  const [pendingRemaining, setPendingRemaining] = useState(0); // captured right before the split prompt opens
  const [showSplitPrompt, setShowSplitPrompt] = useState(false);
  const [showConfirmPrompt, setShowConfirmPrompt] = useState(false);

  // Checked once, the moment this screen opens (from Home's "Add Payment" or
  // the tab bar's "+") - if there's nothing left this month, say so right
  // away instead of letting them fill out a form that can never go through.
  const [checkingBalance, setCheckingBalance] = useState(true);
  const [allowanceExhausted, setAllowanceExhausted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const balance = await api.currentBalance();
        if (!cancelled && balance.remaining <= 0) setAllowanceExhausted(true);
      } catch {
        // Can't check right now (e.g. offline) - don't block them; the
        // normal insufficient_balance handling on submit still applies.
      } finally {
        if (!cancelled) setCheckingBalance(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the payment is recorded, we switch this screen from the form into
  // showing the code generated for that specific transaction.
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const total = parseFloat(amount) || 0;

  const canSubmit = total > 0;
  const [outletError, setOutletError] = useState(false);

  const fetchCode = useCallback(async (forTransactionId: string) => {
    setCodeLoading(true);
    setCodeError(null);
    try {
      const res = await api.createReconciliationCode({ transactionId: forTransactionId });
      setCode(res.code);
    } catch {
      setCodeError("Payment recorded, but couldn't generate a code. Please contact support.");
    } finally {
      setCodeLoading(false);
    }
  }, []);

  // Tapping "Confirm Payment" needs to know up front whether this amount is
  // over the remaining balance, so the *first* popup shown is the right
  // one - the balance/cash choice before the final confirm, not after it.
  const onConfirmPress = async () => {
    if (!outletName.trim()) {
      setOutletError(true);
      return;
    }
    if (split) {
      // Already resolved earlier - go straight to reviewing the split.
      setShowConfirmPrompt(true);
      return;
    }
    try {
      const balance = await api.currentBalance();
      if (Math.round(total) > balance.remaining) {
        if (balance.remaining <= 0) {
          setError("This would go over your remaining balance for the month.");
          return;
        }
        setPendingRemaining(balance.remaining);
        setShowSplitPrompt(true);
        return;
      }
    } catch {
      // Can't check right now - fall through to the normal confirm; the
      // actual submit still enforces the real limit server-side either way.
    }
    setShowConfirmPrompt(true);
  };

  const submitTransaction = async (spendAmount: number, cashAmount?: number) => {
    const result = await api.recordTransaction({
      amount: spendAmount,
      cashAmount,
      outletName: outletName.trim() || undefined,
      billNo: billNo.trim() || undefined,
      notes: notes.trim() || undefined,
      idempotencyKey: Crypto.randomUUID(),
    });
    setTransactionId(result.transaction.id);
    await fetchCode(result.transaction.id);
  };

  const onConfirm = async () => {
    // Dismiss now, before the network call, so the keyboard is fully closed
    // and the layout has settled by the time the result view (and its Done
    // button) appears - otherwise the button can render mid keyboard-close
    // animation and a tap lands where it used to be, not where it is now.
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      if (split) {
        // Already resolved on a previous attempt - submit the reviewed split
        // directly, no need to try the full amount again.
        await submitTransaction(split.allowance, split.cash);
        return;
      }

      try {
        await submitTransaction(Math.round(total));
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "insufficient_balance")) throw err;

        const balance = await api.currentBalance();
        if (balance.remaining <= 0) {
          setError("This would go over your remaining balance for the month.");
          return;
        }
        setPendingRemaining(balance.remaining);
        setShowSplitPrompt(true);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_balance") {
        // The pre-computed split itself got rejected - balance must have
        // changed underneath us (e.g. another device). The atomic check is
        // still what's protecting correctness here; just have them retry.
        setSplit(null);
        setError("Your balance changed just now - please review the amount and try again.");
      } else if (err instanceof ApiError && err.code === "wallet_not_valid") {
        setError("Your benefit wallet isn't active right now - contact HR if this seems wrong.");
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
          <Text style={styles.title}>{transactionId ? "Payment Recorded" : "Add Payment"}</Text>
          <Pressable onPress={() => router.back()} style={styles.closeButton}>
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {checkingBalance ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.goldText} />
          </View>
        ) : transactionId ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
            <Card tone="gold" style={styles.codeCard}>
              {codeLoading && !code ? (
                <ActivityIndicator color={colors.goldText} />
              ) : code ? (
                <>
                  <Text style={styles.codeLabel}>GIVE THIS CODE TO THE CASHIER</Text>
                  <Text style={styles.codeValue}>{formatCode(code)}</Text>
                  <Text style={styles.codeSummary}>
                    {split
                      ? `₹${split.allowance.toLocaleString("en-IN")} allowance + ₹${split.cash.toLocaleString("en-IN")} cash`
                      : `₹${total.toLocaleString("en-IN")}`}
                    {outletName.trim() ? ` · ${outletName.trim()}` : ""}
                  </Text>
                </>
              ) : (
                <Text style={styles.codeError}>{codeError}</Text>
              )}
            </Card>
          </ScrollView>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
            <View
              ref={outletFieldRef}
              style={styles.outletField}
              onLayout={() => {
                outletFieldRef.current?.measureInWindow((x, y, width, height) => {
                  setOutletFieldRect({ x, y, width, height });
                });
              }}
            >
              <Text style={styles.fieldLabel}>
                Outlet{outletError && <Text style={styles.requiredAsterisk}> *</Text>}
              </Text>
              <Pressable
                onPress={() => {
                  outletFieldRef.current?.measureInWindow((x, y, width, height) => {
                    setOutletFieldRect({ x, y, width, height });
                    setOutletPickerOpen(true);
                  });
                }}
                style={[styles.input, styles.selectInput, outletError && styles.inputError]}
              >
                <Text style={outletName ? styles.selectValue : styles.selectPlaceholder}>
                  {outletName || "Select Outlet"}
                </Text>
                <ChevronDown size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <View>
              <Text style={styles.fieldLabel}>Final Amount</Text>
              <TextInput
                value={amount}
                onChangeText={(v) => {
                  setAmount(v.replace(/[^0-9.]/g, ""));
                  setSplit(null); // stale once the amount changes
                }}
                placeholder="₹0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>

            <View>
              <Text style={styles.fieldLabel}>Bill No.</Text>
              <TextInput
                value={billNo}
                onChangeText={(v) => setBillNo(v.replace(/[^0-9]/g, ""))}
                placeholder="Enter the bill/receipt number"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                style={styles.input}
              />
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

            {split ? (
              <Card tone="gold" style={{ gap: spacing.sm }}>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>From Allowance</Text>
                  <Text style={styles.totalValue}>₹{split.allowance.toLocaleString("en-IN")}</Text>
                </View>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>By Cash</Text>
                  <Text style={styles.totalValue}>₹{split.cash.toLocaleString("en-IN")}</Text>
                </View>
              </Card>
            ) : (
              <Card tone="gold" style={styles.totalCard}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₹{total.toLocaleString("en-IN")}</Text>
              </Card>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        )}

        <Modal visible={outletPickerOpen} transparent animationType="fade" onRequestClose={() => setOutletPickerOpen(false)}>
          <Pressable style={styles.dropdownBackdrop} onPress={() => setOutletPickerOpen(false)}>
            <View
              style={[
                styles.dropdown,
                { position: "absolute", top: outletFieldRect.y + outletFieldRect.height, left: outletFieldRect.x, width: outletFieldRect.width },
              ]}
            >
              {OUTLETS.map((outlet) => (
                <Pressable
                  key={outlet}
                  onPress={() => {
                    setOutletName(outlet);
                    setOutletPickerOpen(false);
                    setOutletError(false);
                  }}
                  style={styles.dropdownOption}
                >
                  <Text style={styles.dropdownOptionText}>{outlet}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

        <ConfirmDialog
          visible={showConfirmPrompt}
          title="Confirm Amount"
          amountRows={
            split
              ? [
                  { label: "From Allowance", value: `₹${split.allowance.toLocaleString("en-IN")}` },
                  { label: "By Cash", value: `₹${split.cash.toLocaleString("en-IN")}` },
                ]
              : [{ value: `₹${total.toLocaleString("en-IN")}` }]
          }
          actions={[
            {
              label: "Confirm",
              onPress: () => {
                setShowConfirmPrompt(false);
                onConfirm();
              },
            },
            { label: "Cancel", variant: "secondary", onPress: () => setShowConfirmPrompt(false) },
          ]}
        />

        <ConfirmDialog
          visible={allowanceExhausted}
          title="Allowance Used Up"
          message="Your allowance for this month is over."
          actions={[{ label: "OK", onPress: () => router.back() }]}
        />

        <ConfirmDialog
          visible={showSplitPrompt}
          title="Over Your Balance"
          message="This would go over your remaining balance for the month."
          actions={[
            {
              label: "Pay Remaining by Cash",
              onPress: () => {
                setShowSplitPrompt(false);
                setSplit({ allowance: pendingRemaining, cash: Math.round(total) - pendingRemaining });
                setShowConfirmPrompt(true);
              },
            },
            { label: "Cancel", variant: "secondary", onPress: () => setShowSplitPrompt(false) },
          ]}
        />

        {!checkingBalance && !allowanceExhausted && (
          <View style={styles.footer}>
            {transactionId ? (
              <PrimaryButton
                label="Done"
                loading={closing}
                onPress={() => {
                  if (closing) return;
                  setClosing(true);
                  router.back();
                }}
              />
            ) : (
              <PrimaryButton
                label="Confirm Payment"
                onPress={onConfirmPress}
                loading={submitting}
                disabled={!canSubmit}
              />
            )}
          </View>
        )}
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
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.row,
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  fieldLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase", marginBottom: spacing.sm },
  requiredAsterisk: { color: colors.danger },
  input: {
    ...t.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputError: { borderColor: colors.danger },
  selectInput: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  selectValue: { ...t.body, color: colors.textPrimary },
  selectPlaceholder: { ...t.body, color: colors.textMuted },
  outletField: {},
  dropdownBackdrop: { flex: 1 },
  dropdown: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: "hidden",
    ...shadows.card,
  },
  dropdownOption: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  dropdownOptionText: { ...t.body, color: colors.textPrimary },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  notesInput: { minHeight: 72, textAlignVertical: "top" },
  totalCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { ...t.h2, color: colors.textSecondary },
  totalValue: { ...t.h1, color: colors.goldText },
  error: { ...t.caption, color: colors.danger, textAlign: "center" },
  footer: { padding: spacing.lg },
  codeCard: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  codeLabel: { ...t.label, color: colors.textSecondary, textTransform: "uppercase" },
  codeValue: { ...t.heroNumber, color: colors.goldText, letterSpacing: 4 },
  codeSummary: { ...t.bodyMedium, color: colors.textPrimary, textAlign: "center", marginTop: spacing.xs },
  codeError: { ...t.body, color: colors.danger, textAlign: "center" },
});
