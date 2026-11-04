import { prisma } from "../db";
import { getOrCreatePeriod } from "./period";
import { effectiveAllowance, walletEnded } from "./lastDay";
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Transaction would exceed the remaining benefit balance.");
    this.name = "InsufficientBalanceError";
  }
}

export class WalletNotValidError extends Error {
  constructor() {
    super("This employee's wallet is not valid for the given date.");
    this.name = "WalletNotValidError";
  }
}

export class EmployeeInactiveError extends Error {
  constructor() {
    super("This employee is no longer active.");
    this.name = "EmployeeInactiveError";
  }
}

export interface RecordSpendInput {
  employeeId: string;
  amount: number; // rupees, up to 2 decimal places, > 0 - the portion deducted from the allowance
  cashAmount?: number; // rupees, up to 2 decimal places - paid outside the benefit system, never checked/enforced
  billNo?: string | null; // the outlet's own bill/receipt number, entered by the employee
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
  if (!(input.amount > 0)) {
    throw new Error("amount must be a positive number");
  }

  const lookupDb = existingTx ?? prisma;
  const existing = await lookupDb.benefitTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  const run = async (tx: Db) => {
    // A separate, earlier guard - not part of the atomic balance UPDATE below.
    // The validity window doesn't shift under concurrent requests the way a
    // numeric balance does, so it doesn't need that same atomicity treatment.
    const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    // requireAuth only checks this once, at the very start of the request -
    // re-check here too, since a roster reimport's leaver pass can deactivate
    // this employee while this exact request is still in flight (between
    // auth and this write), with no other mechanism cutting the request off.
    if (!employee.active) {
      throw new EmployeeInactiveError();
    }
    const spendAt = input.occurredAt ?? new Date();
    if (
      (employee.walletValidFrom && spendAt < employee.walletValidFrom) ||
      walletEnded(employee.walletValidTo, employee.lastWorkingDay, spendAt)
    ) {
      throw new WalletNotValidError();
    }

    const period = await getOrCreatePeriod(tx, input.employeeId, input.occurredAt);

    // Still one atomic statement: the leaving-employee proration only tightens
    // the ceiling (LEAST), it never needs a separate read-then-write.
    const cap = effectiveAllowance(Number(period.allowance), employee.lastWorkingDay, period.year, period.month);
    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "BenefitPeriod"
      SET used = used + ${input.amount}, "updatedAt" = now()
      WHERE id = ${period.id} AND used + ${input.amount} <= LEAST(allowance, ${cap})
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
        cashAmount: input.cashAmount ?? null,
        billNo: input.billNo ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
  };

  if (existingTx) return run(existingTx);
  return prisma.$transaction((tx: Prisma.TransactionClient) => run(tx));
}
