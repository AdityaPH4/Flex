// Rounds to the nearest cent/paisa - use before sending a user-entered
// amount to the backend, since plain float arithmetic (e.g. 19.1 - 5.05) can
// land a few billionths off a clean 2-decimal value.
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// Always shows exactly 2 decimal places so amounts are unambiguous (₹100.00,
// not ₹100 for a whole rupee and ₹99.5 for a half one on the next row).
export function formatMoney(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
