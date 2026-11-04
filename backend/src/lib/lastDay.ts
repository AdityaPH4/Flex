import { roundMoney } from "./money";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// "8th of the month = 8/30 of the allowance" is how the business states the
// rule, so the denominator is a flat 30 whatever the month; capped at the full
// allowance (a 31st last day doesn't give 31/30).
const PRORATION_DAYS = 30;

/** First instant after the last working day ends (midnight IST). `lwd` is a @db.Date, i.e. UTC midnight of that date. */
export function lastDayEnds(lwd: Date): Date {
  return new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth(), lwd.getUTCDate() + 1) - IST_OFFSET_MS);
}

/** The allowance the employee may actually use in the given period: prorated only in the month of their last working day. */
export function effectiveAllowance(allowance: number, lwd: Date | null, year: number, month: number, used = 0): number {
  if (!lwd || lwd.getUTCFullYear() !== year || lwd.getUTCMonth() + 1 !== month) return allowance;
  // `used` is only for display: after a revoke the stored allowance equals what was
  // used, and prorating that again would show an allowance below the amount used.
  return Math.max(used, roundMoney((allowance * Math.min(lwd.getUTCDate(), PRORATION_DAYS)) / PRORATION_DAYS));
}

/** True once the wallet is over: past the end of its valid-to day or of the last working day, whichever is earlier. */
export function walletEnded(validTo: Date | null, lwd: Date | null, at = new Date()): boolean {
  return [validTo, lwd].some((d) => d && at >= lastDayEnds(d));
}
