import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { signAdminToken } from "../lib/jwt";
import { requireAdmin } from "../middleware/adminAuth";
import { listCurrentBalancesForActiveEmployees } from "../lib/period";

export const adminRouter = Router();

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const loginSchema = z.object({ password: z.string().min(1) });

adminRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body" });
  }
  if (!env.adminPassword || !constantTimeEquals(parsed.data.password, env.adminPassword)) {
    return res.status(401).json({ error: "invalid_password" });
  }
  const token = signAdminToken();
  res.json({ token, expiresInHours: env.adminSessionTtlHours });
});

adminRouter.use(requireAdmin);

// High-level numbers for the top of the dashboard: how many active
// employees, and the sum of allowance/used/remaining across all of them for
// the current month.
adminRouter.get("/overview", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  const totals = balances.reduce(
    (acc, b) => ({
      allowance: acc.allowance + b.allowance,
      used: acc.used + b.used,
      remaining: acc.remaining + b.remaining,
    }),
    { allowance: 0, used: 0, remaining: 0 }
  );
  const now = new Date();
  res.json({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    activeEmployeeCount: balances.length,
    totals,
  });
});

// One row per active employee with their current balance - the main table.
adminRouter.get("/employees", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  res.json({ employees: balances });
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

// Every transaction across every employee, newest first - for spotting
// spend patterns and for cross-checking against Digitory's own records.
adminRouter.get("/transactions", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const { limit, cursor } = parsed.data;

  const rows = await prisma.benefitTransaction.findMany({
    include: { employee: true, outlet: true },
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    transactions: page.map((t) => ({
      id: t.id,
      employeeName: t.employee.name,
      employeeCode: t.employee.employeeCode,
      outlet: t.outlet?.name ?? t.outletName ?? "—",
      amount: t.amount,
      occurredAt: t.occurredAt,
      status: t.status,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

// The Digitory reconciliation codes, newest first - lets an admin cross-
// reference "who does this code in Digitory's export belong to?" without
// needing direct database access.
adminRouter.get("/reconciliation-codes", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query" });
  }
  const { limit, cursor } = parsed.data;

  const rows = await prisma.reconciliationCode.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    codes: page.map((c) => ({
      id: c.id,
      code: c.code,
      employeeName: c.employeeName,
      employeeCode: c.employeeCode,
      context: c.context,
      createdAt: c.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

const reconcileSchema = z.object({
  rows: z
    .array(
      z.object({
        code: z.string().min(1),
        amount: z.number().optional(),
        date: z.string().optional(),
        outlet: z.string().optional(),
      })
    )
    .min(1)
    .max(5000),
});

// Matches an admin-uploaded Digitory export (already parsed into rows by the
// browser - this endpoint never touches file uploads or CSV parsing itself)
// against our own ReconciliationCode table. Every row comes back tagged
// matched/unmatched so the dashboard can flag anything Digitory has that we
// never generated - a typo, a stale/reused code, or worth a closer look.
//
// This does NOT know or care what Digitory's real column names are - the
// browser is responsible for mapping whatever headers Digitory exports onto
// {code, amount, date, outlet} before sending it here. See public/admin/app.js.
adminRouter.post("/reconcile", async (req, res) => {
  const parsed = reconcileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  // Codes are always stored as 6-digit, zero-padded strings (see
  // generateNumericCode in routes/me.ts). Spreadsheet tools frequently treat
  // a numeric-looking column as a number and silently drop leading zeros on
  // export/re-import, so normalize incoming codes the same way before
  // comparing - otherwise a genuine match like "012345" vs "12345" would be
  // wrongly flagged as unmatched.
  const normalize = (code: string) => code.trim().padStart(6, "0");
  const rows = parsed.data.rows.map((r) => ({ ...r, code: normalize(r.code) }));

  const found = await prisma.reconciliationCode.findMany({
    where: { code: { in: rows.map((r) => r.code) } },
  });
  const foundByCode = new Map(found.map((f) => [f.code, f]));

  const results = rows.map((row) => {
    const match = foundByCode.get(row.code);
    return {
      code: row.code,
      amount: row.amount ?? null,
      date: row.date ?? null,
      outlet: row.outlet ?? null,
      matched: Boolean(match),
      employeeName: match?.employeeName ?? null,
      employeeCode: match?.employeeCode ?? null,
      generatedAt: match?.createdAt ?? null,
    };
  });

  const matchedCount = results.filter((r) => r.matched).length;
  res.json({
    results,
    summary: { total: results.length, matched: matchedCount, unmatched: results.length - matchedCount },
  });
});
