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

// One row per active employee with their current balance - the main table.
adminRouter.get("/employees", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  res.json({ employees: balances });
});

// Persistent "this month's roster changes" - unlike the joiners/leavers echoed
// back from a single /employees/import call (which only reflect that one
// upload and only exist in the browser tab that ran it), this is derived
// straight from the Employee table so it survives a page reload and shows up
// even if nobody in the current session ran the import themselves. Joiners =
// created this calendar month (the only way an Employee row is created is
// via import, so this is exactly "new wallet_no first seen this month").
// Leavers = currently inactive whose record was last touched this calendar
// month (the only thing that ever sets active:false is the import's
// roster-diff, so this is exactly "present last import, absent from the most
// recent one, this month").
adminRouter.get("/employees/roster-changes", async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // If nothing in the table predates this month, there's no genuine "last
  // month's roster" to compare against - every employee only looks like a
  // joiner because the table itself is new (e.g. it was cleared and fully
  // reimported), not because they actually joined this month. In that case,
  // report no changes at all rather than a misleading "everyone is new".
  const hasPriorData = await prisma.employee.findFirst({
    where: { createdAt: { lt: monthStart } },
    select: { id: true },
  });
  if (!hasPriorData) {
    return res.json({ joiners: [], leavers: [] });
  }

  const [joiners, leavers] = await Promise.all([
    prisma.employee.findMany({
      where: { createdAt: { gte: monthStart } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.employee.findMany({
      where: { active: false, updatedAt: { gte: monthStart } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  res.json({
    joiners: joiners.map((e) => ({ employeeCode: e.employeeCode, name: e.name })),
    leavers: leavers.map((e) => ({ employeeCode: e.employeeCode, name: e.name })),
  });
});

// Tries a few common spreadsheet date formats before giving up - dates here
// are informational only (see schema.prisma comment on the wallet_* fields),
// so a row is never rejected just because a date didn't parse.
function parseFlexibleDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // DD-MMM-YYYY or DD/MM/YYYY or DD-MM-YYYY
  const dmy = trimmed.match(/^(\d{1,2})[-/]([A-Za-z]{3,9}|\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const monthNum = /^\d+$/.test(m) ? Number(m) - 1 : new Date(`${m} 1, 2000`).getMonth();
    const date = new Date(Number(y), monthNum, Number(d));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseFlexibleBoolean(raw: string | undefined): boolean {
  if (!raw) return false;
  return ["1", "true", "yes", "y"].includes(raw.trim().toLowerCase());
}

// CSV export of every active employee, in the exact same column shape as
// /employees/import expects - the starting template an admin edits (e.g.
// just the `amount` column for whoever's allowance changed) and re-uploads
// next month. Mirrors the wallet system's own "Register Master-Wallet"
// upload format so HR never has to maintain two different file shapes.
adminRouter.get("/employees/export", async (_req, res) => {
  const balances = await listCurrentBalancesForActiveEmployees(prisma);
  res.json({
    employees: balances.map((b) => ({
      wallet_no: b.employeeCode,
      ref_no: b.designation ?? b.roleName,
      amount: b.allowance,
      limit: b.walletLimit ?? "",
      customer_name: b.name,
      phone_number: b.phone ?? "",
      email_id: b.email,
      enable_otp: b.otpEnabled ? "1" : "0",
      valid_from: b.walletValidFrom ? b.walletValidFrom.toISOString().slice(0, 10) : "",
      valid_to: b.walletValidTo ? b.walletValidTo.toISOString().slice(0, 10) : "",
      Grade: b.grade ?? "",
      DOJ: b.dateOfJoining ? b.dateOfJoining.toISOString().slice(0, 10) : "",
      "Cost Center": b.homeOutlet ?? "",
    })),
  });
});

// Every column is required, no exceptions - an explicit decision (see
// CLAUDE.md) that the import is all-or-nothing: a file missing any field on
// any row is rejected in full, rather than silently applying a partial
// month's data. See the pre-validation pass in the route handler below.
const importRowSchema = z.object({
  wallet_no: z.string().trim().min(1),
  customer_name: z.string().trim().min(1),
  email_id: z.string().trim().email(),
  ref_no: z.string().trim().min(1),
  amount: z.coerce.number().int().positive(),
  phone_number: z.string().trim().min(1),
  "Cost Center": z.string().trim().min(1),
  // Not z.coerce.number() alone - an empty cell would coerce to Number("") = 0,
  // which passes .nonnegative() silently instead of being caught as missing.
  // Preprocess (not .pipe(z.string()...)) so this still accepts a real
  // number too - re-importing this endpoint's own /export output sends
  // limit as an actual number, not a string.
  limit: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : val),
    z.coerce.number().int().nonnegative()
  ),
  enable_otp: z.string().trim().min(1),
  valid_from: z.string().trim().min(1),
  valid_to: z.string().trim().min(1),
  Grade: z.string().trim().min(1),
  DOJ: z.string().trim().min(1),
});

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
});

// Monthly bulk import, matching the wallet system's own "Register
// Master-Wallet" upload format exactly (see schema.prisma's wallet_* fields
// for the full mapping). Creates or updates employees by wallet_no
// (= employeeCode) and sets each one's CURRENT month's allowance. Never
// touches `used` on an existing period - only ever the allowance figure.
// Role and Outlet are found-or-created by name (ref_no / Cost Center) rather
// than rejected when unmatched - this file is the source of truth for those
// names, not our seed data.
//
// All-or-nothing: every column is required on every row (see
// importRowSchema), and the whole file is validated BEFORE any database
// write happens. If even one row is missing one field, nothing is imported -
// the admin gets back exactly which row(s)/field(s) are missing so they can
// fix the file and re-upload, rather than the system silently applying a
// partial month's data.
adminRouter.post("/employees/import", async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const validationIssues: { row: number; wallet_no: string | null; field: string; message: string }[] = [];
  const validatedRows: z.infer<typeof importRowSchema>[] = [];
  parsed.data.rows.forEach((raw, index) => {
    const row = importRowSchema.safeParse(raw);
    if (!row.success) {
      const walletNo = typeof raw.wallet_no === "string" && raw.wallet_no.trim() ? raw.wallet_no.trim() : null;
      for (const issue of row.error.issues) {
        validationIssues.push({
          row: index + 1, // 1-indexed data row, matching how the admin counts rows in their spreadsheet (header excluded)
          wallet_no: walletNo,
          field: String(issue.path[0] ?? "(unknown)"),
          message: issue.message,
        });
      }
    } else {
      validatedRows.push(row.data);
    }
  });

  if (validationIssues.length > 0) {
    return res.status(400).json({
      error: "missing_required_fields",
      message: "Can't upload - some rows are missing required fields. Fix the file and re-upload.",
      issues: validationIssues,
    });
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // HR re-uploads the ENTIRE roster every time (confirmed, not a delta) - so
  // "who was active before this import" doubles as "last month's roster",
  // and anyone missing from this upload has left. Snapshotted before any
  // writes below.
  const previouslyActive = await prisma.employee.findMany({ where: { active: true } });
  const uploadedCodes = new Set(validatedRows.map((r) => r.wallet_no));

  // Fetched once and matched case-insensitively - the wallet upload's ref_no/
  // Cost Center casing can vary between rows/months for what's meant to be
  // the same role or outlet ("Crew" vs "CREW"), and an exact-match upsert
  // would silently create a duplicate for every casing variant.
  const [existingRoles, existingOutlets] = await Promise.all([prisma.role.findMany(), prisma.outlet.findMany()]);
  const roleByName = new Map(existingRoles.map((r) => [r.name.toLowerCase(), r]));
  const outletByName = new Map(existingOutlets.map((o) => [o.name.toLowerCase(), o]));

  // Every result row echoes back the full set of import columns (not just
  // wallet_no/status/error) so the dashboard can show exactly what was - or
  // would have been - saved, without a separate lookup.
  type ImportResultRow = {
    wallet_no: string;
    ref_no: string | null;
    amount: number | null;
    limit: number | null;
    customer_name: string | null;
    phone_number: string | null;
    email_id: string | null;
    enable_otp: boolean | null;
    valid_from: string | null;
    valid_to: string | null;
    Grade: string | null;
    DOJ: string | null;
    "Cost Center": string | null;
    status: "created" | "updated" | "error";
    error?: string;
  };
  const results: ImportResultRow[] = [];

  for (const data of validatedRows) {
    const costCenter = data["Cost Center"];

    try {
      let role = roleByName.get(data.ref_no.toLowerCase());
      if (!role) {
        role = await prisma.role.create({ data: { name: data.ref_no, monthlyAllowance: data.amount } });
        roleByName.set(data.ref_no.toLowerCase(), role);
      }

      let outletId: string | null = null;
      if (costCenter) {
        let outlet = outletByName.get(costCenter.toLowerCase());
        if (!outlet) {
          outlet = await prisma.outlet.create({ data: { name: costCenter } });
          outletByName.set(costCenter.toLowerCase(), outlet);
        }
        outletId = outlet.id;
      }

      const existing = await prisma.employee.findUnique({ where: { employeeCode: data.wallet_no } });
      const employeeFields = {
        name: data.customer_name,
        email: data.email_id.toLowerCase(),
        phone: data.phone_number || null,
        designation: data.ref_no,
        roleId: role.id,
        homeOutletId: outletId,
        walletLimit: data.limit ?? null,
        otpEnabled: parseFlexibleBoolean(data.enable_otp),
        grade: data.Grade || null,
        dateOfJoining: parseFlexibleDate(data.DOJ),
        walletValidFrom: parseFlexibleDate(data.valid_from),
        walletValidTo: parseFlexibleDate(data.valid_to),
        // Being present in ANY upload means active, full stop - this is what
        // lets a previously-deactivated employee (a false-positive leaver, or
        // someone who genuinely rejoined) come back to life simply by
        // reappearing in the next roster upload, rather than staying stuck
        // inactive forever once marked as a leaver.
        active: true,
      };
      const employee = await prisma.employee.upsert({
        where: { employeeCode: data.wallet_no },
        create: { employeeCode: data.wallet_no, ...employeeFields },
        update: employeeFields,
      });

      await prisma.benefitPeriod.upsert({
        where: { employeeId_year_month: { employeeId: employee.id, year, month } },
        create: { employeeId: employee.id, year, month, allowance: data.amount, used: 0 },
        update: { allowance: data.amount },
      });

      results.push({
        wallet_no: data.wallet_no,
        ref_no: data.ref_no,
        amount: data.amount,
        limit: data.limit ?? null,
        customer_name: data.customer_name,
        phone_number: data.phone_number || null,
        email_id: data.email_id.toLowerCase(),
        enable_otp: parseFlexibleBoolean(data.enable_otp),
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        Grade: data.Grade || null,
        DOJ: data.DOJ || null,
        "Cost Center": costCenter || null,
        status: existing ? "updated" : "created",
      });
    } catch {
      results.push({
        wallet_no: data.wallet_no,
        ref_no: data.ref_no,
        amount: data.amount,
        limit: data.limit ?? null,
        customer_name: data.customer_name,
        phone_number: data.phone_number || null,
        email_id: data.email_id,
        enable_otp: parseFlexibleBoolean(data.enable_otp),
        valid_from: data.valid_from || null,
        valid_to: data.valid_to || null,
        Grade: data.Grade || null,
        DOJ: data.DOJ || null,
        "Cost Center": costCenter || null,
        status: "error",
        error: "Could not save this row.",
      });
    }
  }

  // Anyone active before this import but absent from it entirely has left -
  // deactivate them (this is what already gates login, see requireAuth) and
  // call it out explicitly rather than silently dropping them off the table.
  const leaverEmployees = previouslyActive.filter((e) => !uploadedCodes.has(e.employeeCode));
  if (leaverEmployees.length > 0) {
    await prisma.employee.updateMany({
      where: { id: { in: leaverEmployees.map((e) => e.id) } },
      data: { active: false },
    });
  }
  const leavers = leaverEmployees.map((e) => ({ employeeCode: e.employeeCode, name: e.name }));

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  res.json({ results, summary, leavers });
});

// The Digitory reconciliation codes, newest first - lets an admin cross-
// reference "who does this code in Digitory's export belong to?" without
// needing direct database access.
adminRouter.get("/reconciliation-codes", async (req, res) => {
  const listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().uuid().optional(),
  });
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

/*
 * SUPERSEDED - kept for reference, not deleted (may come back).
 *
 * This matched an uploaded export against our own 6-digit ReconciliationCode
 * table. The real wallet ledger export has no code column at all - it
 * identifies employees by Wallet #, so reconciliation below now matches on
 * that instead. The in-app "read this code to the cashier" flow (see
 * routes/me.ts, ReconciliationCode model) is untouched by this - only the
 * admin-side matching mechanism changed.
 *
 * const reconcileSchema = z.object({
 *   rows: z
 *     .array(
 *       z.object({
 *         code: z.string().min(1),
 *         amount: z.number().optional(),
 *         date: z.string().optional(),
 *         outlet: z.string().optional(),
 *       })
 *     )
 *     .min(1)
 *     .max(5000),
 * });
 *
 * adminRouter.post("/reconcile", async (req, res) => {
 *   const parsed = reconcileSchema.safeParse(req.body);
 *   if (!parsed.success) {
 *     return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
 *   }
 *   const normalize = (code) => code.trim().padStart(6, "0");
 *   const rows = parsed.data.rows.map((r) => ({ ...r, code: normalize(r.code) }));
 *   const found = await prisma.reconciliationCode.findMany({
 *     where: { code: { in: rows.map((r) => r.code) } },
 *   });
 *   const foundByCode = new Map(found.map((f) => [f.code, f]));
 *   const results = rows.map((row) => {
 *     const match = foundByCode.get(row.code);
 *     return {
 *       code: row.code,
 *       amount: row.amount ?? null,
 *       date: row.date ?? null,
 *       outlet: row.outlet ?? null,
 *       matched: Boolean(match),
 *       employeeName: match?.employeeName ?? null,
 *       employeeCode: match?.employeeCode ?? null,
 *       generatedAt: match?.createdAt ?? null,
 *     };
 *   });
 *   const matchedCount = results.filter((r) => r.matched).length;
 *   res.json({
 *     results,
 *     summary: { total: results.length, matched: matchedCount, unmatched: results.length - matchedCount },
 *   });
 * });
 */

/*
 * SUPERSEDED - kept for reference, not deleted (may come back).
 *
 * This matched an uploaded wallet-ledger export by employeeCode (= Wallet #),
 * which was itself a stand-in for code-based matching adopted only because
 * the real ledger sample we had at the time carried no OTP column. Digitory's
 * ledger export is now expected to carry an OTP column (the same code
 * generated in routes/me.ts's "read this code to the cashier" flow), so
 * matching goes back to that code - see the active handler below.
 *
 * const ledgerRowSchema = z.object({
 *   walletNo: z.string().trim().min(1),
 *   event: z.string().optional(),
 *   transactionId: z.string().optional(),
 *   paymentName: z.string().optional(),
 *   amount: z.number().optional(),
 *   balance: z.number().optional(),
 *   dateTime: z.string().optional(),
 *   user: z.string().optional(),
 *   status: z.string().optional(),
 * });
 *
 * const reconcileSchema = z.object({
 *   rows: z.array(ledgerRowSchema).min(1).max(5000),
 * });
 *
 * adminRouter.post("/reconcile", async (req, res) => {
 *   const parsed = reconcileSchema.safeParse(req.body);
 *   if (!parsed.success) {
 *     return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
 *   }
 *   const rows = parsed.data.rows;
 *   const employees = await prisma.employee.findMany({
 *     where: { employeeCode: { in: rows.map((r) => r.walletNo) } },
 *   });
 *   const employeeByCode = new Map(employees.map((e) => [e.employeeCode, e]));
 *   const results = rows.map((row) => {
 *     const employee = employeeByCode.get(row.walletNo);
 *     return {
 *       walletNo: row.walletNo,
 *       matched: Boolean(employee),
 *       employeeName: employee?.name ?? null,
 *       employeeCode: employee?.employeeCode ?? null,
 *     };
 *   });
 *   const matchedCount = results.filter((r) => r.matched).length;
 *   res.json({ results, summary: { total: results.length, matched: matchedCount, unmatched: results.length - matchedCount } });
 * });
 */

const ledgerRowSchema = z.object({
  otp: z.string().trim().min(1),
  walletNo: z.string().trim().optional(),
  event: z.string().optional(),
  transactionId: z.string().optional(),
  paymentName: z.string().optional(),
  amount: z.number().optional(),
  balance: z.number().optional(),
  dateTime: z.string().optional(),
  user: z.string().optional(),
  status: z.string().optional(),
});

const reconcileSchema = z.object({
  rows: z.array(ledgerRowSchema).min(1).max(5000),
});

// Matches an admin-uploaded Digitory ledger export against our own
// ReconciliationCode table by OTP (the 6-digit code generated in
// routes/me.ts's "read this code to the cashier" flow) - not by wallet
// number. A row only counts as reconciled if BOTH the code matches AND the
// ledger's amount agrees with what we recorded for that transaction
// ("squaring off"); anything else (code not found, code not linked to a
// transaction, or an amount mismatch) is flagged into the unreconciled
// bucket with a specific reason, never silently dropped.
//
// Codes are only unique within the calendar month they were issued in (see
// periodKey on the ReconciliationCode model), so which month's codes to
// search is taken from each ledger ROW's own Date Time - not from today's
// date - since reconciliation typically happens after the month it covers
// has already ended. If a row's date doesn't parse, we fall back to a
// bare-code lookup and only accept it if that's unambiguous (exactly one
// match across all months); otherwise it's flagged rather than guessed.
adminRouter.post("/reconcile", async (req, res) => {
  const parsed = reconcileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }
  const rows = parsed.data.rows;

  const rowPeriods = rows.map((row) => {
    const parsedDate = parseFlexibleDate(row.dateTime);
    return parsedDate ? `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}` : null;
  });

  const codes = [...new Set(rows.map((r) => r.otp.trim()))];
  const found = await prisma.reconciliationCode.findMany({
    where: { code: { in: codes } },
    include: { transaction: true },
  });
  const byExactKey = new Map(found.map((f) => [`${f.code}|${f.periodKey}`, f]));
  const byCodeOnly = new Map<string, typeof found>();
  for (const f of found) {
    if (!byCodeOnly.has(f.code)) byCodeOnly.set(f.code, []);
    byCodeOnly.get(f.code)!.push(f);
  }

  const results = rows.map((row, i) => {
    const otp = row.otp.trim();
    const period = rowPeriods[i];

    let match: (typeof found)[number] | null = null;
    let reason: string | null = null;
    if (period) {
      match = byExactKey.get(`${otp}|${period}`) ?? null;
      if (!match) reason = "OTP not found in our system for that month.";
    } else {
      const candidates = byCodeOnly.get(otp) ?? [];
      if (candidates.length === 0) reason = "OTP not found in our system.";
      else if (candidates.length > 1) {
        reason = "Ambiguous OTP - the ledger row's date didn't parse and this code matches more than one month.";
      } else match = candidates[0];
    }

    let reconciled = false;
    if (match) {
      if (!match.transaction) {
        reason = "Code found but not linked to a specific transaction - can't verify amount.";
      } else if (row.amount == null) {
        reason = "Ledger row has no amount to compare.";
      } else if (Math.round(row.amount) !== match.transaction.amount) {
        reason = `Amount mismatch: ledger ₹${row.amount} vs our system ₹${match.transaction.amount}.`;
      } else {
        reconciled = true;
      }
    }

    return {
      otp,
      walletNo: row.walletNo ?? null,
      event: row.event ?? null,
      amount: row.amount ?? null,
      balance: row.balance ?? null,
      dateTime: row.dateTime ?? null,
      user: row.user ?? null,
      status: row.status ?? null,
      reconciled,
      reason,
      employeeName: match?.employeeName ?? null,
      employeeCode: match?.employeeCode ?? null,
      ourAmount: match?.transaction?.amount ?? null,
    };
  });

  const reconciled = results.filter((r) => r.reconciled);
  const unreconciled = results.filter((r) => !r.reconciled);
  res.json({
    reconciled,
    unreconciled,
    summary: { total: results.length, reconciled: reconciled.length, unreconciled: unreconciled.length },
  });
});
