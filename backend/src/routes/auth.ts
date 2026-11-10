import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { verifyGoogleIdToken } from "../lib/googleAuth";
import { signSessionToken } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { setLog } from "../lib/eventLog";

export const authRouter = Router();

const googleVerifySchema = z.object({
  idToken: z.string().min(20),
  deviceId: z.string().min(8),
  deviceName: z.string().optional(),
});

authRouter.post("/google/verify", async (req, res) => {
  const parsed = googleVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const { idToken, deviceId, deviceName } = parsed.data;

  let email: string;
  try {
    ({ email } = await verifyGoogleIdToken(idToken));
  } catch {
    return res.status(401).json({ error: "invalid_google_token" });
  }

  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee || !employee.active) {
    // Internal employee-only system: it's fine to say plainly that the
    // Google account isn't registered (an HR/admin-provisioning flow, not
    // public signup).
    setLog(res, { detail: { email } });
    return res.status(404).json({ error: "google_account_not_registered" });
  }

  const session = await prisma.session.create({
    data: { employeeId: employee.id, deviceId, deviceName },
  });
  setLog(res, { actor: "employee", employeeId: employee.id, detail: { deviceName } });

  const token = signSessionToken({
    sessionId: session.id,
    employeeId: employee.id,
    deviceId,
  });

  res.json({ token, sessionExpiresInDays: env.sessionTtlDays });
});

authRouter.post("/logout", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.session.update({
    where: { id: req.auth!.sessionId },
    data: { revokedAt: new Date() },
  });
  res.json({ ok: true });
});
