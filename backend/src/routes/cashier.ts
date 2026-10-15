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

// The till-side screen (backend/public/cashier). It shows each bill the moment
// an employee pays (part of) it from their phone, with every payer's OTP, so the
// cashier can check the amounts against the bill and type the codes into
// Digitory. Read-only: nothing here verifies, consumes or changes a payment.
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

// A bill can be paid by several employees (a table splitting one bill, each
// from their own allowance). The cashier sees ONE card per bill number with
// every payer on it, so the live feed is a list of bills, not of payments.
// How far back a bill's other payers are looked up once any of them is new -
// a bill is never paid across more than a service, this just bounds the query.
const BILL_LOOKBACK_MS = 12 * 60 * 60 * 1000;

// One entry per bill that had a payment since `since` (newest activity first).
// The screen polls this about once a second, passing `since` = the previous
// response's serverTime minus a minute of overlap and replaces a bill's card
// whenever it comes back again (a new payer makes the whole bill come back) -
// the overlap is what stops a row from being missed if it commits a moment
// after a later one (or after a poll).
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
  // (screen asleep, connection down) must not drag in bills that have
  // already aged out.
  const from = since && new Date(since) > windowStart ? new Date(since) : windowStart;
  const outletFilter = outlet ? { outletName: outlet } : {};

  const touched = await prisma.benefitTransaction.findMany({
    where: { status: "confirmed", createdAt: { gt: from }, billNo: { not: null }, ...outletFilter },
    select: { outletName: true, billNo: true },
    distinct: ["outletName", "billNo"],
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const rows = touched.length
    ? await prisma.benefitTransaction.findMany({
        where: {
          status: "confirmed",
          createdAt: { gt: new Date(serverTime.getTime() - BILL_LOOKBACK_MS) },
          OR: touched.map((b) => ({ outletName: b.outletName, billNo: b.billNo })),
        },
        include: {
          employee: { select: { name: true, employeeCode: true } },
          // The OTP the employee's app generated for this payment (the cashier
          // types it into Digitory); null for the second or so before it exists.
          reconciliationCodes: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const bills = new Map<string, typeof rows>();
  for (const t of rows) {
    const key = `${t.outletName ?? ""}|${t.billNo}`;
    bills.set(key, [...(bills.get(key) ?? []), t]);
  }

  const payments = [...bills.entries()]
    .map(([id, list]) => {
      const payers = list.map((t) => {
        const allowanceAmount = Number(t.amount);
        const cashAmount = t.cashAmount != null ? Number(t.cashAmount) : 0;
        return {
          id: t.id,
          employeeName: t.employee.name,
          employeeCode: t.employee.employeeCode,
          code: t.reconciliationCodes[0]?.code ?? null,
          allowanceAmount,
          cashAmount,
          totalAmount: roundMoney(allowanceAmount + cashAmount),
          createdAt: t.createdAt.toISOString(),
        };
      });
      const sum = (f: (p: (typeof payers)[number]) => number) => roundMoney(payers.reduce((n, p) => n + f(p), 0));
      return {
        id,
        billNo: list[0].billNo,
        outlet: list[0].outletName,
        allowanceAmount: sum((p) => p.allowanceAmount),
        cashAmount: sum((p) => p.cashAmount),
        totalAmount: sum((p) => p.totalAmount),
        createdAt: payers[0].createdAt, // first payer
        lastAt: payers[payers.length - 1].createdAt, // latest payer: what the 10 minutes run from
        payments: payers,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));

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

// Every payment recorded since midnight IST, newest first, one row per
// employee payment - what the "All Transactions" tab lists and searches. A
// payment whose app never got an OTP is still listed (`code` is null).
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
    const allowanceAmount = Number(t.amount);
    const cashAmount = t.cashAmount != null ? Number(t.cashAmount) : 0;
    return {
      id: t.id,
      code: t.reconciliationCodes[0]?.code ?? null,
      employeeName: t.employee.name,
      employeeCode: t.employee.employeeCode,
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
