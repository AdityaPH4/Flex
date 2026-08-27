import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { getOrCreatePeriod } from "../lib/period";
import { recordBenefitSpend, InsufficientBalanceError } from "../lib/spend";
import type { Prisma } from "@prisma/client";

type TransactionWithOutlet = Prisma.BenefitTransactionGetPayload<{ include: { outlet: true } }>;

export const meRouter = Router();
meRouter.use(requireAuth);

function publicEmployeeView(employee: {
  id: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
}) {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    photoUrl: employee.photoUrl,
    designation: employee.designation,
    department: employee.department,
  };
}

meRouter.get("/", async (req: AuthedRequest, res) => {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: req.auth!.employeeId },
    include: { homeOutlet: true, role: true },
  });
  res.json({
    ...publicEmployeeView(employee),
    role: employee.role.name,
    homeOutlet: employee.homeOutlet?.name ?? null,
  });
});

meRouter.get("/benefits/current", async (req: AuthedRequest, res) => {
  const period = await getOrCreatePeriod(prisma, req.auth!.employeeId);
  res.json({
    year: period.year,
    month: period.month,
    allowance: period.allowance,
    used: period.used,
    remaining: period.allowance - period.used,
  });
});

const listTransactionsQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

meRouter.get("/benefits/transactions", async (req: AuthedRequest, res) => {
  const parsed = listTransactionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
  }
  const { year, month, limit, cursor } = parsed.data;

  const where: any = { employeeId: req.auth!.employeeId };
  if (year && month) {
    where.period = { year, month };
  }

  const rows = await prisma.benefitTransaction.findMany({
    where,
    include: { outlet: true },
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    transactions: page.map((t: TransactionWithOutlet) => ({
      id: t.id,
      outlet: t.outlet?.name ?? t.outletName ?? "TOIT",
      amount: t.amount,
      items: t.items,
      occurredAt: t.occurredAt,
      notes: t.notes,
      status: t.status,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

const createTransactionSchema = z.object({
  amount: z.number().int().positive(),
  outletId: z.string().uuid().optional(),
  outletName: z.string().max(120).optional(),
  items: z
    .array(z.object({ name: z.string().max(80), amount: z.number().nonnegative() }))
    .optional(),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(280).optional(),
  idempotencyKey: z.string().min(8).max(128),
});

// Employee self-entry: "I already used my benefit at the outlet, recording it now."
// Identity comes only from req.auth.employeeId - there is no employeeId field
// accepted in the body, so this can never be used to spend someone else's balance.
meRouter.post("/benefits/transactions", async (req: AuthedRequest, res) => {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  try {
    const txn = await recordBenefitSpend({
      employeeId: req.auth!.employeeId,
      amount: body.amount,
      items: body.items,
      outletId: body.outletId ?? null,
      outletName: body.outletName ?? null,
      notes: body.notes ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      idempotencyKey: body.idempotencyKey,
    });
    const period = await getOrCreatePeriod(prisma, req.auth!.employeeId, txn.occurredAt);
    res.status(201).json({
      transaction: {
        id: txn.id,
        amount: txn.amount,
        occurredAt: txn.occurredAt,
      },
      balance: {
        allowance: period.allowance,
        used: period.used,
        remaining: period.allowance - period.used,
      },
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return res.status(409).json({ error: "insufficient_balance" });
    }
    throw err;
  }
});

const reconciliationCodeSchema = z.object({
  context: z.string().max(120).optional(),
});

function generateNumericCode(): string {
  // 6 digits, human-readable - this gets read aloud and typed into Digitory
  // by hand, so it needs to be short and unambiguous, not cryptographically
  // opaque. It is NOT a secret and NOT a security boundary - see the
  // ReconciliationCode model comment for why.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Issues a short numeric code and stores it against the authenticated
// employee for later reconciliation against Digitory's own records.
//
// This endpoint does NOT verify, consume, or authorize anything - it only
// records "this code was generated for this employee at this time". Digitory
// performs the actual payment once the cashier types the code in there; nothing
// in this app calls Digitory and nothing in Digitory calls back here.
meRouter.post("/benefits/reconciliation-code", async (req: AuthedRequest, res) => {
  const parsed = reconciliationCodeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: req.auth!.employeeId },
  });
  const expiresAt = new Date(Date.now() + env.reconciliationCodeTtlSeconds * 1000);

  // Unique-constraint retry: astronomically unlikely with 1,000,000 possible
  // codes, but cheap to guard against rather than assume away.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.reconciliationCode.create({
        data: {
          code: generateNumericCode(),
          employeeId: employee.id,
          employeeName: employee.name,
          employeeCode: employee.employeeCode,
          context: parsed.data.context ?? "Benefit redemption",
          expiresAt,
        },
      });
      return res.status(201).json({
        code: created.code,
        expiresAt: created.expiresAt,
        expiresInSeconds: env.reconciliationCodeTtlSeconds,
      });
    } catch (err: any) {
      if (err?.code === "P2002") continue; // unique constraint hit - retry with a new code
      throw err;
    }
  }
  res.status(500).json({ error: "could_not_generate_code" });
});
