import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  reconciliationCodeTtlSeconds: Number(process.env.RECONCILIATION_CODE_TTL_SECONDS ?? 300),

  // Google Sign-In: the "Web application" OAuth client ID from Google Cloud
  // Console (not the Android client) - used as the audience when verifying
  // ID tokens from the mobile app. See lib/googleAuth.ts.
  googleClientId: required("GOOGLE_CLIENT_ID"),

  port: Number(process.env.PORT ?? 4000),

  // Admin dashboard: a single shared password for now (see README - this is
  // a deliberate MVP shortcut, not left required() so the app still boots
  // for people who haven't set it up yet; the login route itself rejects
  // all attempts if it's unset, so the dashboard just stays inaccessible
  // rather than the whole server refusing to start).
  // The one person allowed into the admin dashboard (verified through Google;
  // she then sets her own password). Empty = nobody can sign in.
  adminEmail: (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
  // Testing-phase tools in the admin dashboard (the "Update balance" tab).
  // Leave unset in production: the tab disappears and its endpoint 404s.
  testTools: process.env.ENABLE_TEST_TOOLS === "true",
  adminSessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12),

  // Cashier screen (/cashier): same idea as the admin dashboard - one shared
  // password, and the screen simply stays locked if it's unset. Changing it
  // signs every cashier device out (see lib/jwt.ts).
  cashierPassword: process.env.CASHIER_PASSWORD ?? "",
  cashierSessionTtlDays: Number(process.env.CASHIER_SESSION_TTL_DAYS ?? 14),
};
