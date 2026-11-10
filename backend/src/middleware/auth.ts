import type { Request, Response, NextFunction } from "express";
import { verifySessionToken } from "../lib/jwt";
import { prisma } from "../db";
import { setLog } from "../lib/eventLog";

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

  // Admin tokens (signAdminToken) are signed with this same JWT_SECRET but
  // carry a different, sessionId-less payload shape - verifySessionToken's
  // signature check alone can't tell them apart (both verify fine). Without
  // this, an admin token sent here would pass verification and then crash
  // the lookup below (Prisma rejects an `id: undefined` filter outright)
  // instead of cleanly being rejected as the wrong kind of token.
  if (typeof payload.sessionId !== "string") {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }

  // The signature is good, so this is that employee even if the checks below refuse them.
  setLog(res, { actor: "employee", employeeId: payload.employeeId });

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
