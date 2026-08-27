import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../lib/jwt";
import { prisma } from "../db";

export interface AuthedRequest extends Request {
  auth?: {
    employeeId: string;
    sessionId: string;
    deviceId: string;
  };
}

/**
 * Populates req.auth.employeeId from the Bearer session token.
 *
 * This is the ONLY source of employee identity for every /api/me/* route.
 * Nothing in the request body or query string is ever trusted for identity -
 * routes must read req.auth.employeeId, never req.body.employeeId.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "missing_token" });
  }

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sessionId },
  });
  if (!session || session.revokedAt) {
    return res.status(401).json({ error: "session_revoked" });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: payload.employeeId },
  });
  if (!employee || !employee.active) {
    return res.status(401).json({ error: "employee_inactive" });
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  req.auth = {
    employeeId: payload.employeeId,
    sessionId: payload.sessionId,
    deviceId: payload.deviceId,
  };
  next();
}
