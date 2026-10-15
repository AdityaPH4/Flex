// Plain JS subtraction/addition on numbers converted from Decimal (e.g.
// `allowance - used`) can land a few quintillionths off a clean 2-decimal
// value (7000 - 6987.66 = 12.340000000000146, not 12.34) - harmless for
// display (toLocaleString rounds it away) but fatal once that exact value
// round-trips back to the client and gets resubmitted: it fails the
// multipleOf(0.01) check on the way back in. Round every derived money
// value before it goes into a JSON response so clients only ever see - and
// echo back - clean values.
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
