// The outlets an employee can pick when recording a payment. Keep in sync
// with OUTLETS in mobile/app/record-benefit.tsx - the app sends one of these
// exact strings as BenefitTransaction.outletName, and the cashier screen
// filters on it to show each till only its own outlet's payments.
// The cashier screen offers only these: just Indiranagar for now (with a single
// outlet the screen skips the "which till" step). Add the others back here when
// their tills come on.
export const OUTLET_NAMES = ["TOIT Indiranagar"];
