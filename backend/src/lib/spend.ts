import { prisma } from "../db";
import { getOrCreatePeriod } from "./period";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Transaction would exceed the remaining benefit balance.");
    this.name = "InsufficientBalanceError";
  }
}

export interface RecordSpendInput {
  employeeId: string;
  amount: number; // whole rupees, > 0
  items?: unknown;
  outletId?: string | null;
  outletName?: string | null;
  notes?: string | null;
  occurredAt?: Date;
  idempotencyKey: string;
}

/**
 * Records a benefit spend against the employee's *current* month period,
 * enforcing the balance limit atomically at the database level.
 *
 * Why this is safe under concurrency: the balance check and the increment
 * happen in a single SQL UPDATE (`used + amount <= allowance`), which Postgres
 * evaluates and applies as one atomic operation on the row. Two simultaneous
 * requests for the same employee cannot both succeed past the limit - the
 * second one to reach Postgres will simply fail the WHERE clause and update
 * zero rows, because the first one's increment is already committed to that
 * row by the time the second's UPDATE runs.
 *
 * Idempotency: if a BenefitTransaction with this idempotencyKey already
 * exists, we return it as-is instead of spending again. This makes client
 * retries (e.g. a request that succeeded but the response was lost on a flaky
 * connection) safe to resend verbatim.
 */
export async function recordBenefitSpend(input: RecordSpendInput, existingTx?: Db) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive integer");
  }

  const lookupDb = existingTx ?? prisma;
  const existing = await lookupDb.benefitTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const run = async (tx: Db) => {
    const period = await getOrCreatePeriod(tx, input.employeeId, input.occurredAt);

    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "BenefitPeriod"
      SET used = used + ${input.amount}, "updatedAt" = now()
      WHERE id = ${period.id} AND used + ${input.amount} <= allowance
      RETURNING id
    `;

    if (updated.length === 0) {
      throw new InsufficientBalanceError();
    }

    return tx.benefitTransaction.create({
      data: {
        employeeId: input.employeeId,
        periodId: period.id,
        outletId: input.outletId ?? null,
        outletName: input.outletName ?? null,
        amount: input.amount,
        items: input.items as any,
        occurredAt: input.occurredAt ?? new Date(),
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
  };

  if (existingTx) return run(existingTx);
  return prisma.$transaction((tx: Prisma.TransactionClient) => run(tx));
}
