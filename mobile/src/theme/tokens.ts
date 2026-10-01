/**
 * TOIT Employee Benefits - design tokens.
 *
 * Direction: warm, light, "premium benefit voucher" - soft pastel stat cards
 * with generous rounded corners and gentle shadows instead of hairline
 * borders. The brand gold (#D4A24C) survives as the primary accent; a warm
 * sage green joins it as a second accent family so cards can differentiate
 * (allowance vs. used vs. remaining) without reaching for cold, clinical
 * colors - everything stays warm-toned, including the neutrals.
 */

export const colors = {
  // Background - warm cream, not stark white
  bg: "#F7F4EF",
  surface: "#FFFFFF",
  surfaceBorder: "rgba(36,31,26,0.06)",

  // Text - warm near-black instead of pure black
  textPrimary: "#241F1A",
  textSecondary: "#746B60",
  textMuted: "#A79C8E",

  // Signature accent - warm gold. Same hue as before, now paired with a
  // pastel fill for cards (was a transparent border tint on dark bg).
  gold: "#D4A24C",
  goldSoft: "#F8E9C9",
  goldText: "#96662A",

  // Secondary accent - warm sage (not clinical mint), for cards that need to
  // read as distinct from the gold/hero card.
  sageSoft: "#E4EEDD",
  sageText: "#5A7D4E",

  // Status
  success: "#5A8F5E",
  danger: "#C05B4A",

  // Overlays
  scrim: "rgba(36,31,26,0.45)",
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
  sm: 12,
  md: 20,
  lg: 28,
  xl: 32,
  pill: 999,
};

// Soft shadows replace the old hairline-border card style.
export const shadows = {
  card: {
    shadowColor: "#241F1A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  row: {
    shadowColor: "#241F1A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
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
