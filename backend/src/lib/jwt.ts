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
// relative to employee sessions since it's a shared password for now (see
// ADMIN_PASSWORD in .env) - the shorter TTL limits how long a leaked token
// stays useful.

export interface AdminTokenPayload {
  isAdmin: true;
}

export function signAdminToken(): string {
  return jwt.sign({ isAdmin: true } satisfies AdminTokenPayload, env.jwtSecret, {
    expiresIn: `${env.adminSessionTtlHours}h`,
  });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret) as AdminTokenPayload;
  if (payload.isAdmin !== true) throw new Error("not an admin token");
  return payload;
}
