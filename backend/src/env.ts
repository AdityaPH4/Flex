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
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
  reconciliationCodeTtlSeconds: Number(process.env.RECONCILIATION_CODE_TTL_SECONDS ?? 300),
  smsProvider: process.env.SMS_PROVIDER ?? "console",
  port: Number(process.env.PORT ?? 4000),

  // Admin dashboard: a single shared password for now (see README - this is
  // a deliberate MVP shortcut, not left required() so the app still boots
  // for people who haven't set it up yet; the login route itself rejects
  // all attempts if it's unset, so the dashboard just stays inaccessible
  // rather than the whole server refusing to start).
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminSessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12),
};
