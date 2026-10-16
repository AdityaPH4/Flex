import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../env";

export interface SessionTokenPayload {
  sessionId: string;
  employeeId: string;
  deviceId: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: `${env.sessionTtlDays}d`,
  });
}

export function verifySessionToken(token: string): SessionTokenPayload {
  // Throws if invalid/expired - caller (auth middleware) should catch.
  return jwt.verify(token, env.jwtSecret) as SessionTokenPayload;
}

// --- admin dashboard tokens --------------------------------------------
//
// Deliberately a separate token shape from employee sessions (different
// payload, different claim name) so an employee's session token can never
// be replayed against admin routes even if someone tried. Short-lived
// relative to employee sessions - the shorter TTL limits how long a leaked token
// stays useful.

export interface AdminTokenPayload {
  isAdmin: true;
  email: string;
}

export function signAdminToken(): string {
  return jwt.sign({ isAdmin: true, email: env.adminEmail } satisfies AdminTokenPayload, env.jwtSecret, {
    expiresIn: `${env.adminSessionTtlHours}h`,
  });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as AdminTokenPayload;
  // email check: tokens from the old shared-password days carry none and die here
  if (payload.isAdmin !== true || !env.adminEmail || payload.email !== env.adminEmail) throw new Error("not an admin token");
  return payload;
}

// --- cashier screen tokens ---------------------------------------------
//
// Its own token shape again, so neither an employee session nor an admin
// token can be used on the cashier feed (and a cashier token has no
// sessionId / isAdmin, so it can't be replayed anywhere else either). The
// token also carries a short fingerprint of the cashier password: change
// CASHIER_PASSWORD and every token issued under the old one stops working,
// which is the only way to sign out a lost till tablet.

export interface CashierTokenPayload {
  role: "cashier";
  pwv: string;
}

function cashierPasswordVersion(): string {
  return crypto
    .createHash("sha256")
    .update(`cashier:${env.cashierPassword}`)
    .digest("hex")
    .slice(0, 16);
}

export function signCashierToken(): string {
  return jwt.sign(
    { role: "cashier", pwv: cashierPasswordVersion() } satisfies CashierTokenPayload,
    env.jwtSecret,
    { expiresIn: `${env.cashierSessionTtlDays}d` }
  );
}

export function verifyCashierToken(token: string): CashierTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as CashierTokenPayload;
  if (!env.cashierPassword || payload.role !== "cashier" || payload.pwv !== cashierPasswordVersion()) {
    throw new Error("not a valid cashier token");
  }
  return payload;
}
