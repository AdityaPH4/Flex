import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "../lib/otp";
import { smsProvider } from "../lib/sms";
import { signSessionToken } from "../lib/jwt";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

const MAX_OTP_ATTEMPTS = 5;

const requestOtpSchema = z.object({
  phone: z.string().min(6).max(20),
});

authRouter.post("/otp/request", async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const { phone } = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { phone } });
  if (!employee || !employee.active) {
    // Internal employee-only system: it's fine to say plainly that the number
    // isn't registered (an HR/admin-provisioning flow, not public signup).
    return res.status(404).json({ error: "phone_not_registered" });
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code, phone);
  const expiresAt = new Date(Date.now() + env.otpTtlSeconds * 1000);

  const otpRequest = await prisma.otpRequest.create({
    data: { phone, codeHash, employeeId: employee.id, expiresAt },
  });

  await smsProvider.sendOtp(phone, code);

  res.json({
    requestId: otpRequest.id,
    expiresInSeconds: env.otpTtlSeconds,
  });
});

const verifyOtpSchema = z.object({
  requestId: z.string().uuid(),
  code: z.string().length(6),
  deviceId: z.string().min(8),
  deviceName: z.string().optional(),
});

authRouter.post("/otp/verify", async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const { requestId, code, deviceId, deviceName } = parsed.data;

  const otpRequest = await prisma.otpRequest.findUnique({ where: { id: requestId } });
  if (!otpRequest || !otpRequest.employeeId) {
    return res.status(400).json({ error: "invalid_request_id" });
  }
  if (otpRequest.consumedAt) {
    return res.status(400).json({ error: "code_already_used" });
  }
  if (otpRequest.expiresAt < new Date()) {
    return res.status(400).json({ error: "code_expired" });
  }
  if (otpRequest.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const ok = verifyOtpCode(code, otpRequest.phone, otpRequest.codeHash);
  if (!ok) {
    await prisma.otpRequest.update({
      where: { id: otpRequest.id },
      data: { attempts: { increment: 1 } },
    });
    return res.status(401).json({ error: "invalid_code" });
  }

  const [, session] = await prisma.$transaction([
    prisma.otpRequest.update({
      where: { id: otpRequest.id },
      data: { consumedAt: new Date() },
    }),
    prisma.session.create({
      data: { employeeId: otpRequest.employeeId, deviceId, deviceName },
    }),
  ]);

  const token = signSessionToken({
    sessionId: session.id,
    employeeId: otpRequest.employeeId,
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
