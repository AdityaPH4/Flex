/**
 * TOIT Employee Benefits - design tokens.
 *
 * Direction: "premium benefit voucher", not "crypto wallet". Dark, warm,
 * restrained. One signature accent (warm gold) instead of the neon-green
 * that fintech/crypto dashboards default to - gold reads as "membership /
 * voucher" rather than "trading app", and ties back to TOIT's food & hospitality
 * context. Everything else stays quiet neutral warm-greys so the gold means
 * something when it appears (balance, primary actions, the benefit card).
 */

export const colors = {
  // Backgrounds - warm near-black, not pure #000 (flatter, less harsh on OLED glare)
  bg: "#111010",
  bgElevated: "#1A1817",
  card: "#1E1B19",
  cardBorder: "rgba(255,255,255,0.07)",

  // Text
  textPrimary: "#F5F1EC",
  textSecondary: "#A79E93",
  textMuted: "#736A60",

  // Signature accent - warm gold. Used sparingly: balance figure, primary CTA,
  // active nav state, the benefit-ID card border.
  gold: "#D4A24C",
  goldSoft: "rgba(212,162,76,0.14)",
  goldBorder: "rgba(212,162,76,0.35)",

  // Status
  success: "#7FA980",
  danger: "#C9705E",

  // Overlays
  scrim: "rgba(0,0,0,0.55)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

// Space Grotesk for the big numerals (distinct geometric character, reads well
// at large sizes) + Inter for everything else (neutral, highly legible body text).
export const fontFamily = {
  display: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_500Medium",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemibold: "Inter_600SemiBold",
};

export const type = {
  heroNumber: { fontFamily: fontFamily.display, fontSize: 48, letterSpacing: -0.5 },
  h1: { fontFamily: fontFamily.display, fontSize: 24 },
  h2: { fontFamily: fontFamily.displayMedium, fontSize: 18 },
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 21 },
  bodyMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 15 },
  label: { fontFamily: fontFamily.bodyMedium, fontSize: 12, letterSpacing: 0.4 },
  caption: { fontFamily: fontFamily.body, fontSize: 12, lineHeight: 16 },
};
