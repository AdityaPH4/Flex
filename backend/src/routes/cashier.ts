import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { signCashierToken } from "../lib/jwt";
import { OUTLET_NAMES } from "../lib/outlets";
import { roundMoney } from "../lib/money";
import { startOfDayIST } from "../lib/istDay";
import { requireCashier } from "../middleware/cashierAuth";

// The till-side screen (backend/public/cashier). It shows each payment the
// moment its code is generated on the employee's phone, so the cashier can
// check the amount against the bill and then type the code into Digitory.
// Read-only: nothing here verifies, consumes or changes a code or a payment -
// same as the code itself (see the ReconciliationCode model comment).
export const cashierRouter = Router();

// The live board only ever holds payments this young; anything older is still
// listed under "All Transactions". Sent to the screen as `windowSeconds` so
// the two sides can't drift apart. Also how far back a freshly opened screen
// (no cursor yet) or one that was offline for a while looks.
const LIVE_WINDOW_MS = 10 * 60 * 1000;

// Cap on one day's list. A day at one outlet is a few hundred rows at most;
// this only stops a runaway query, and the response says when it kicked in.
const MAX_TRANSACTIONS = 1000;

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides first so a length difference can't leak through an early return.
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Login throttle: a shared password is guessable if nothing slows guessing
// down. In-memory and per client IP (server.ts trusts Caddy's
// X-Forwarded-For, so req.ip is the real address) - a restart simply resets
// it, which is fine for what it's guarding.
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;
const failedLogins = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

function pruneFailedLogins(now: number) {
  if (failedLogins.size < 500) return;
  for (const [key, entry] of failedLogins) {
    if (entry.lockedUntil <= now && now - entry.firstAt > FAILED_LOGIN_WINDOW_MS) {
      failedLogins.delete(key);
    }
  }
}

const loginSchema = z.object({ password: z.string().min(1).max(200) });

cashierRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body" });
  }
  if (!env.cashierPassword) {
    return res.status(503).json({ error: "cashier_screen_not_configured" });
  }

  const now = Date.now();
  const key = req.ip ?? "unknown";
  pruneFailedLogins(now);
  const entry = failedLogins.get(key);
  if (entry && entry.lockedUntil > now) {
    return res.status(429).json({
      error: "too_many_attempts",
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    });
  }

  if (!constantTimeEquals(parsed.data.password, env.cashierPassword)) {
    const current =
      entry && now - entry.firstAt <= FAILED_LOGIN_WINDOW_MS
        ? entry
        : { count: 0, firstAt: now, lockedUntil: 0 };
    current.count += 1;
    failedLogins.set(
      key,
      current.count >= MAX_FAILED_LOGINS
        ? { count: 0, firstAt: now, lockedUntil: now + LOCKOUT_MS }
        : current
    );
    return res.status(401).json({ error: "invalid_password" });
  }

  failedLogins.delete(key);
  res.json({ token: signCashierToken(), expiresInDays: env.cashierSessionTtlDays });
});

cashierRouter.get("/outlets", requireCashier, (_req, res) => {
  res.json({ outlets: OUTLET_NAMES });
});

const paymentsQuerySchema = z.object({
  outlet: z.string().trim().min(1).max(120).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// One row per generated code (= one "OTP generated" event), newest first.
// The screen polls this about once a second, passing `since` = the previous
// response's serverTime minus a minute of overlap and de-duplicating by id on
// its side - the overlap is what stops a row from being missed if it commits
// a moment after a later one (or after a poll).
cashierRouter.get("/payments", requireCashier, async (req, res) => {
  const parsed = paymentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const { outlet, since, limit } = parsed.data;

  // Taken before the query so the next poll's overlap covers anything that
  // commits while this one is running.
  const serverTime = new Date();
  const windowStart = new Date(serverTime.getTime() - LIVE_WINDOW_MS);
  // Never look back further than the board holds: a poll after a long gap
  // (screen asleep, connection down) must not drag in payments that have
  // already aged out.
  const from = since && new Date(since) > windowStart ? new Date(since) : windowStart;

  const codes = await prisma.reconciliationCode.findMany({
    where: {
      createdAt: { gt: from },
      transaction: {
        is: { status: "confirmed", ...(outlet ? { outletName: outlet } : {}) },
      },
    },
    include: { transaction: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const payments = codes.flatMap((c) => {
    const t = c.transaction;
    if (!t) return [];
    const allowanceAmount = Number(t.amount);
    const cashAmount = t.cashAmount != null ? Number(t.cashAmount) : 0;
    return [
      {
        id: c.id,
        transactionId: t.id,
        code: c.code,
        employeeName: c.employeeName,
        employeeCode: c.employeeCode,
        outlet: t.outletName,
        billNo: t.billNo,
        allowanceAmount,
        cashAmount,
        totalAmount: roundMoney(allowanceAmount + cashAmount),
        createdAt: c.createdAt.toISOString(),
      },
    ];
  });

  res.set("Cache-Control", "no-store");
  res.json({
    serverTime: serverTime.toISOString(),
    windowSeconds: LIVE_WINDOW_MS / 1000,
    payments,
  });
});

const transactionsQuerySchema = z.object({
  outlet: z.string().trim().min(1).max(120).optional(),
});

// Every payment recorded since midnight IST, newest first - what the "All
// Transactions" tab lists and searches. Unlike /payments this also includes a
// payment that never got a code (the employee's app saved it but couldn't
// generate one), so the cashier can still see it; `code` is null for those.
// Voided payments are left out, same as the live feed.
cashierRouter.get("/transactions", requireCashier, async (req, res) => {
  const parsed = transactionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const { outlet } = parsed.data;

  const serverTime = new Date();
  const dayStart = startOfDayIST(serverTime);

  const rows = await prisma.benefitTransaction.findMany({
    where: {
      status: "confirmed",
      createdAt: { gte: dayStart },
      ...(outlet ? { outletName: outlet } : {}),
    },
    include: {
      employee: { select: { name: true, employeeCode: true } },
      reconciliationCodes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_TRANSACTIONS + 1,
  });

  const truncated = rows.length > MAX_TRANSACTIONS;
  const transactions = rows.slice(0, MAX_TRANSACTIONS).map((t) => {
    // Name and code as they were when the code was issued, so a row matches
    // the card the cashier saw; fall back to the employee record if none.
    const issued = t.reconciliationCodes[0];
    const allowanceAmount = Number(t.amount);
    const cashAmount = t.cashAmount != null ? Number(t.cashAmount) : 0;
    return {
      id: t.id,
      code: issued?.code ?? null,
      employeeName: issued?.employeeName ?? t.employee.name,
      employeeCode: issued?.employeeCode ?? t.employee.employeeCode,
      outlet: t.outletName,
      billNo: t.billNo,
      allowanceAmount,
      cashAmount,
      totalAmount: roundMoney(allowanceAmount + cashAmount),
      createdAt: t.createdAt.toISOString(),
    };
  });

  res.set("Cache-Control", "no-store");
  res.json({
    serverTime: serverTime.toISOString(),
    dayStart: dayStart.toISOString(),
    truncated,
    transactions,
  });
});
