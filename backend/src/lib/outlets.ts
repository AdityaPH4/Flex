// The outlets an employee can pick when recording a payment. Keep in sync
// with OUTLETS in mobile/app/record-benefit.tsx - the app sends one of these
// exact strings as BenefitTransaction.outletName, and the cashier screen
// filters on it to show each till only its own outlet's payments.
export const OUTLET_NAMES = ["TOIT Indiranagar", "TOIT Bagmane", "TOIT Pune"];
